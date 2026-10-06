import { useFrame, type ThreeElements } from '@react-three/fiber';
import { forwardRef, useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { CRIMP_BOTTOM, CRIMP_TOP, drawPackBack, drawPackFront, TEAR_V } from './packTexture';
import { toTexture } from './cardTexture';
import { Shader } from './Shader';

// The booster: a foil pouch, puffed in the middle and flat at the crimped ends, printed front and
// back. It's split at the perforation: the body, and the top strip (in its own group, hinged at
// the seam's right end) that the tear peels and then rips away. The shader lights the pillow
// (so the foil catches the light as the pack turns) and draws the glowing tear line.

export const PACK_W = 1.25;
const PACK_H = 2.05;
const BULGE = 0.075;
/** The seam's height in pack coordinates (pack centred on 0). */
export const SEAM_Y = (TEAR_V - 0.5) * PACK_H;

/** Values the timelines tween. */
export type PackFx = {
  /** 0 → 1: how far the tear line has run from the left edge. */
  tear: number;
  tearColor: THREE.Color;
  /** Light leaking from inside the pack (after the rip). */
  glow: number;
  glowColor: THREE.Color;
};
export const makePackFx = (): PackFx => ({ tear: 0, tearColor: new THREE.Color('#ffffff'), glow: 0, glowColor: new THREE.Color('#ffffff') });

/** A slab of the pouch between v0 and v1, positioned in pack coordinates. */
function pouch(v0: number, v1: number) {
  const g = new THREE.PlaneGeometry(PACK_W, (v1 - v0) * PACK_H, 36, Math.max(4, Math.round((v1 - v0) * 60)));
  g.translate(0, ((v0 + v1) / 2 - 0.5) * PACK_H, 0);
  const uv = g.attributes.uv!;
  for (let i = 0; i < uv.count; i++) uv.setY(i, v0 + uv.getY(i) * (v1 - v0));
  return g;
}

const vertex = /* glsl */ `
  uniform float uSide; // +1 front, -1 back
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vV;
  const float PI = 3.14159265;
  // Pillow: full bulge in the body, none at the crimps or the side seams.
  float body(float v) { return smoothstep(${CRIMP_BOTTOM.toFixed(3)}, ${(CRIMP_BOTTOM + 0.1).toFixed(3)}, v) * (1.0 - smoothstep(${(1 - CRIMP_TOP - 0.1).toFixed(3)}, ${(1 - CRIMP_TOP).toFixed(3)}, v)); }
  float height(vec2 uv) { return ${BULGE.toFixed(3)} * pow(sin(PI * uv.x), 0.6) * body(uv.y); }
  void main() {
    vUv = uv;
    vec2 p = uv; // local space: the back mesh is the same slab turned around
    float h = height(p);
    float e = 0.01;
    float dx = (height(p + vec2(e, 0.0)) - height(p - vec2(e, 0.0))) / (2.0 * e * ${PACK_W.toFixed(3)});
    float dy = (height(p + vec2(0.0, e)) - height(p - vec2(0.0, e))) / (2.0 * e * ${PACK_H.toFixed(3)});
    vec3 pos = position + vec3(0.0, 0.0, h);
    vec3 n = normalize(vec3(-dx, -dy, 1.0));
    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    vN = normalize(normalMatrix * n);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const fragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform sampler2D uMask;
  uniform float uHasMask;
  uniform float uTime;
  uniform float uTear;
  uniform vec3 uTearColor;
  uniform float uGlow;
  uniform vec3 uGlowColor;
  uniform float uSide;
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vV;
  vec3 hsv(float h) { return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); }
  void main() {
    vec4 base = texture2D(uMap, vUv);
    if (base.a < 0.5) discard;
    float m = uHasMask > 0.5 ? texture2D(uMask, vUv).r : 0.0;
    vec3 N = normalize(vN);
    vec3 V = normalize(vV);
    vec3 L = normalize(vec3(-0.4, 0.7, 0.8));
    float diff = 0.62 + 0.45 * max(dot(N, L), 0.0);
    float spec = pow(max(dot(reflect(-L, N), V), 0.0), 18.0);
    // Foil: a rainbow-tinted sheen that slides with the view angle, on metallic ink only.
    float ang = dot(N, V);
    vec3 rainbow = hsv(fract(vUv.y * 0.8 + vUv.x * 0.3 + (1.0 - ang) * 3.0 + uTime * 0.04));
    vec3 col = base.rgb * diff;
    col += m * (mix(vec3(1.0, 0.9, 0.7), rainbow, 0.45) * (0.12 + spec * 1.4));
    col += spec * 0.18;
    // Tear line: bright along the torn part of the seam, brightest at the tip.
    float seam = ${TEAR_V.toFixed(3)};
    float x = uSide > 0.0 ? vUv.x : 1.0 - vUv.x;
    float torn = 1.0 - smoothstep(uTear - 0.015, uTear + 0.005, x);
    float line = exp(-abs(vUv.y - seam) * 260.0) * torn * step(0.001, uTear);
    float tip = exp(-length((vec2(x, vUv.y) - vec2(uTear, seam)) * vec2(1.0, 1.7)) * 45.0) * step(0.001, uTear) * step(uTear, 0.999);
    col += uTearColor * (line * 3.0 + tip * 4.0);
    // Light leaking from the open top after the rip.
    col += uGlowColor * uGlow * smoothstep(seam - 0.25, seam, vUv.y) * 1.5;
    gl_FragColor = vec4(col, 1.0);
  }
`;

type Props = {
  fx: PackFx;
  /** The top strip's group (hinged at the seam's right end), for the tear timelines. */
  strip?: (g: THREE.Group | null) => void;
} & Omit<ThreeElements['group'], 'ref'>;

type Tex = { front: THREE.Texture; mask: THREE.Texture; back: THREE.Texture };

export const PackMesh = forwardRef<THREE.Group, Props>(function PackMesh({ fx, strip, ...group }, ref) {
  const [tex, setTex] = useState<Tex | null>(null);
  useEffect(() => {
    let off = false;
    Promise.all([drawPackFront(), drawPackBack()]).then(([f, b]) => {
      if (off) return;
      const mask = new THREE.CanvasTexture(f.mask);
      mask.colorSpace = THREE.NoColorSpace;
      setTex({ front: toTexture(f.face), mask, back: toTexture(b) });
    });
    return () => {
      off = true;
    };
  }, []);

  const geo = useMemo(() => ({ body: pouch(0, TEAR_V), top: pouch(TEAR_V, 1) }), []);
  const mk = (side: 1 | -1) => ({
    uMap: { value: null as THREE.Texture | null },
    uMask: { value: null as THREE.Texture | null },
    uHasMask: { value: 0 },
    uTime: { value: 0 },
    uTear: { value: 0 },
    uTearColor: { value: new THREE.Color() },
    uGlow: { value: 0 },
    uGlowColor: { value: new THREE.Color() },
    uSide: { value: side },
  });
  const uFront = useMemo(() => mk(1), []); // eslint-disable-line react-hooks/exhaustive-deps
  const uBack = useMemo(() => mk(-1), []); // eslint-disable-line react-hooks/exhaustive-deps
  if (tex) {
    uFront.uMap.value = tex.front;
    uFront.uMask.value = tex.mask;
    uFront.uHasMask.value = 1;
    uBack.uMap.value = tex.back;
  }

  useFrame((_, dt) => {
    for (const u of [uFront, uBack]) {
      u.uTime.value += Math.min(dt, 0.1);
      u.uTear.value = fx.tear;
      u.uTearColor.value.copy(fx.tearColor);
      u.uGlow.value = fx.glow;
      u.uGlowColor.value.copy(fx.glowColor);
    }
  });

  const hinge: [number, number, number] = [PACK_W / 2, SEAM_Y, 0];
  return (
    <group ref={ref} {...group}>
      {tex && (
        <>
          <mesh geometry={geo.body}>
            <Shader vertexShader={vertex} fragmentShader={fragment} uniforms={uFront} />
          </mesh>
          <mesh geometry={geo.body} rotation={[0, Math.PI, 0]}>
            <Shader vertexShader={vertex} fragmentShader={fragment} uniforms={uBack} />
          </mesh>
          <group ref={strip} position={hinge}>
            <group position={[-hinge[0], -hinge[1], 0]}>
              <mesh geometry={geo.top}>
                <Shader vertexShader={vertex} fragmentShader={fragment} uniforms={uFront} />
              </mesh>
              <mesh geometry={geo.top} rotation={[0, Math.PI, 0]}>
                <Shader vertexShader={vertex} fragmentShader={fragment} uniforms={uBack} />
              </mesh>
            </group>
          </group>
        </>
      )}
    </group>
  );
});
