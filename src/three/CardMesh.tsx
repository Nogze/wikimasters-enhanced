import { useFrame, type ThreeElements } from '@react-three/fiber';
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Shader } from './Shader';
import { RARITY_STYLE } from '../lib/rarity';
import type { Card } from '../lib/types';
import { drawCardBack, drawCardFront, toTexture } from './cardTexture';
import { TIERS } from '../lib/cardSpec';

// The 3D card: a rounded slab (edge in the rarity colour), the canvas faces on top, a holo foil
// layer, and an additive halo behind that the timelines drive. Faces are unlit (exactly the
// canvas colours, ≤ 1) so they stay crisp and never bloom; the halo is HDR and does.

const CARD_W = 1;
const CARD_H = 1.4;
const RADIUS = 0.07;
const DEPTH = 0.016;

function roundedShape(w: number, h: number, r: number) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** Shared geometries: face (UVs normalised to 0–1) and the extruded body. */
const shape = roundedShape(CARD_W, CARD_H, RADIUS);
const faceGeo = (() => {
  const g = new THREE.ShapeGeometry(shape, 10);
  const pos = g.attributes.position!;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / CARD_W + 0.5;
    uv[i * 2 + 1] = pos.getY(i) / CARD_H + 0.5;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
})();
const bodyGeo = (() => {
  const g = new THREE.ExtrudeGeometry(shape, { depth: DEPTH, bevelEnabled: false, curveSegments: 10 });
  g.translate(0, 0, -DEPTH / 2);
  return g;
})();
const glowGeo = new THREE.PlaneGeometry(CARD_W * 2.2, CARD_H * 1.85);
// Halos are twice the card's size: they must never catch the pointer (a neighbour's halo, or a
// hovered card's halo pushed forward, would swallow clicks meant for the card beside it).
const NO_HIT = () => {};

let backTexture: Promise<THREE.CanvasTexture> | null = null;
const backTex = () => (backTexture ??= drawCardBack().then(toTexture));

// Foil: one shader, confined by a mask drawn with the face (three/cardTexture.ts): it shines on
// the frame, the foil title bar and the image window, never on the title text or the infobox.
// The view vector is computed per fragment, so the sheen travels across the card as it turns.
const foilVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
const foilFragment = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform float uRainbow;
  uniform vec3 uTint;
  uniform sampler2D uMask;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vNormal;
  vec3 hsv(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
  void main() {
    float m = texture2D(uMask, vUv).r;
    if (m < 0.01) discard;
    vec3 V = normalize(cameraPosition - vWorld);
    float angle = 1.0 - dot(normalize(vNormal), V);
    float sweep = dot(V.xy, vec2(0.9, 0.6));
    float bands = pow(0.5 + 0.5 * sin((vUv.x + vUv.y) * 18.0 + uTime * 1.3 + sweep * 9.0 + angle * 10.0), 6.0);
    vec3 rainbow = hsv(fract(vUv.x * 0.6 + vUv.y * 0.9 + uTime * 0.05 + sweep * 1.6 + angle * 2.0));
    vec3 col = mix(uTint * (0.6 + 0.6 * bands), rainbow, uRainbow);
    float a = m * (0.05 + bands * 0.42) * uIntensity;
    gl_FragColor = vec4(col * a, a);
  }
`;

const glowFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  varying vec2 vUv;
  void main() {
    // p in card units (the card is ±0.5 × ±0.7); the plane reaches ±1.1 × ±1.295.
    vec2 p = (vUv - 0.5) * vec2(2.2, 2.59);
    vec2 q = abs(p) - vec2(0.46, 0.66);
    float dist = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
    float g = exp(-max(dist, 0.0) * 5.0) * uIntensity * smoothstep(0.0, 0.3, -max(abs(p.x) - 1.1, abs(p.y) - 1.295));
    gl_FragColor = vec4(uColor * g * 2.2, g);
  }
`;
const plainVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

/** Values a timeline can tween while the card is on screen. */
export type CardFx = { glow: number; holo: number };

type Props = {
  card: Card | null;
  shiny?: boolean;
  fx?: CardFx;
  /** Called once the front texture is ready (so a reveal can wait for it). */
  onReady?: () => void;
} & Omit<ThreeElements['group'], 'ref'>;

export const CardMesh = forwardRef<THREE.Group, Props>(function CardMesh({ card, shiny = false, fx, onReady, ...group }, ref) {
  const [front, setFront] = useState<THREE.CanvasTexture | null>(null);
  const [mask, setMask] = useState<THREE.CanvasTexture | null>(null);
  const [back, setBack] = useState<THREE.CanvasTexture | null>(null);
  const style = RARITY_STYLE[card?.rarity ?? 'C'];

  useEffect(() => {
    let off = false;
    backTex().then((t) => !off && setBack(t));
    if (card)
      drawCardFront(card, { shiny }).then((c) => {
        if (off) return;
        setFront(toTexture(c.face));
        const m = new THREE.CanvasTexture(c.mask);
        m.colorSpace = THREE.NoColorSpace;
        setMask(m);
        onReady?.();
      });
    return () => {
      off = true;
    };
  }, [card?.id, shiny]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => front?.dispose(), [front]);
  useEffect(() => () => mask?.dispose(), [mask]);

  // Resting foil strength per tier (the mask decides where); shinies always shine in rainbow.
  const rest: number = shiny ? 1 : ({ C: 0, PC: 0.25, R: 0.5, SR: 0.7, UR: 0.85, L: 1 } as const)[card?.rarity ?? 'C'];
  const foilUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uIntensity: { value: rest },
      uRainbow: { value: shiny ? 1 : card?.rarity === 'L' ? 0.5 : 0 },
      uTint: { value: new THREE.Color(card?.rarity === 'L' ? TIERS.L.accent : TIERS[card?.rarity ?? 'C'].color) },
      uMask: { value: null as THREE.Texture | null },
    }),
    [rest, shiny, card?.rarity],
  );
  foilUniforms.uMask.value = mask;
  const glowUniforms = useMemo(() => ({ uColor: { value: new THREE.Color(style.color) }, uIntensity: { value: 0 } }), [style.color]);
  const edgeColor = useMemo(() => new THREE.Color(style.color).multiplyScalar(0.8), [style.color]);

  const t = useRef(0);
  useFrame((_, dt) => {
    t.current += Math.min(dt, 0.1);
    foilUniforms.uTime.value = t.current;
    if (fx) {
      glowUniforms.uIntensity.value = fx.glow;
      foilUniforms.uIntensity.value = Math.max(rest, fx.holo);
    }
  });

  return (
    <group ref={ref} {...group}>
      <mesh geometry={glowGeo} position={[0, 0, -0.05]} renderOrder={-1} raycast={NO_HIT}>
        <Shader vertexShader={plainVertex} fragmentShader={glowFragment} uniforms={glowUniforms} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      {/* Same halo behind the card when it lies face down (planes are one-sided). */}
      <mesh geometry={glowGeo} position={[0, 0, 0.05]} rotation={[0, Math.PI, 0]} renderOrder={-1} raycast={NO_HIT}>
        <Shader vertexShader={plainVertex} fragmentShader={glowFragment} uniforms={glowUniforms} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh geometry={bodyGeo}>
        <meshBasicMaterial color={edgeColor} />
      </mesh>
      {/* Front (faces +z) */}
      <mesh geometry={faceGeo} position={[0, 0, DEPTH / 2 + 0.0008]}>
        <meshBasicMaterial key={front ? 'tex' : 'blank'} map={front} color={front ? '#ffffff' : '#e9edf2'} />
      </mesh>
      {mask && (
        <mesh geometry={faceGeo} position={[0, 0, DEPTH / 2 + 0.0016]}>
          <Shader vertexShader={foilVertex} fragmentShader={foilFragment} uniforms={foilUniforms} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
      )}
      {/* Back (faces −z) */}
      <mesh geometry={faceGeo} position={[0, 0, -DEPTH / 2 - 0.0008]} rotation={[0, Math.PI, 0]}>
        <meshBasicMaterial key={back ? 'tex' : 'blank'} map={back} color={back ? '#ffffff' : '#0b1430'} />
      </mesh>
    </group>
  );
});
