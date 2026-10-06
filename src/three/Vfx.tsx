import { useFrame, useThree } from '@react-three/fiber';
import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Shader } from './Shader';
import type { StageFx } from './Summon';

// Impact effects for the big moments: shockwave rings and anamorphic flares (a pool of
// camera-facing quads), and anime speed lines over the whole view (driven by `fx.speed`).
// Everything is additive and HDR (> 1), so the bloom picks it up.

export type VfxHandle = {
  /** A ring of light bursting outwards from `origin`. `size` is the final diameter (world). */
  ring(origin: THREE.Vector3, color: string, opts?: { size?: number; duration?: number; width?: number }): void;
  /** A horizontal lens streak with a hot core. */
  flare(origin: THREE.Vector3, color: string, opts?: { size?: number; duration?: number }): void;
};

const SLOTS = 20;

const quadVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const impactFragment = /* glsl */ `
  uniform float uP;     // 0 → 1 over the effect's life
  uniform float uKind;  // 0 ring, 1 flare
  uniform float uWidth;
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float a;
    if (uKind < 0.5) {
      float r = length(p);
      float R = mix(0.04, 0.95, 1.0 - pow(1.0 - uP, 3.0));
      float w = uWidth * (1.0 - uP * 0.7) + 0.004;
      float ring = exp(-pow((r - R) / w, 2.0));
      // A faint inner glow early on only: on big rings a lasting fill reads as a white disc.
      float fill = exp(-pow(r / (R + 0.001), 2.0) * 3.0) * 0.12 * pow(1.0 - uP, 3.0);
      a = (ring + fill) * pow(1.0 - uP, 1.3);
    } else {
      float streak = exp(-abs(p.y) * 70.0) * exp(-abs(p.x) * 2.2);
      float halo = exp(-abs(p.y) * 14.0) * exp(-abs(p.x) * 5.0) * 0.4;
      float core = exp(-dot(p * vec2(1.0, 3.0), p * vec2(1.0, 3.0)) * 40.0);
      a = (streak * 1.1 + halo * 0.6 + core * 0.8) * (1.0 - uP) * min(uP * 10.0, 1.0);
    }
    // Rings stay just above the bloom threshold (a blurred bright ring fills in as a disc); flares go hot.
    gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.25) * a * (uKind < 0.5 ? 1.25 : 2.2), a);
  }
`;

type Slot = { active: boolean; t: number; dur: number; kind: 0 | 1; size: number; origin: THREE.Vector3; u: Record<string, THREE.IUniform> };

export const Impacts = forwardRef<VfxHandle>(function Impacts(_, ref) {
  const { camera } = useThree();
  const meshes = useRef<(THREE.Mesh | null)[]>([]);
  const slots = useMemo<Slot[]>(
    () =>
      Array.from({ length: SLOTS }, () => ({
        active: false,
        t: 0,
        dur: 1,
        kind: 0,
        size: 1,
        origin: new THREE.Vector3(),
        u: { uP: { value: 0 }, uKind: { value: 0 }, uWidth: { value: 0.08 }, uColor: { value: new THREE.Color() } },
      })),
    [],
  );
  const geo = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  const next = useRef(0);

  const fire = (kind: 0 | 1, origin: THREE.Vector3, color: string, size: number, dur: number, width = 0.08) => {
    const s = slots[next.current++ % SLOTS]!;
    s.active = true;
    s.t = 0;
    s.dur = dur;
    s.kind = kind;
    s.size = size;
    s.origin.copy(origin);
    s.u.uKind!.value = kind;
    s.u.uWidth!.value = width;
    (s.u.uColor!.value as THREE.Color).set(color);
  };

  useImperativeHandle(ref, () => ({
    ring: (origin, color, o = {}) => fire(0, origin, color, o.size ?? 3, o.duration ?? 0.7, o.width ?? 0.08),
    flare: (origin, color, o = {}) => fire(1, origin, color, o.size ?? 2, o.duration ?? 0.6),
  }));

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    slots.forEach((s, i) => {
      const m = meshes.current[i];
      if (!m) return;
      if (!s.active) {
        m.visible = false;
        return;
      }
      s.t += dt;
      const p = Math.min(1, s.t / s.dur);
      s.u.uP!.value = p;
      if (p >= 1) s.active = false;
      m.visible = s.active;
      m.position.copy(s.origin);
      m.quaternion.copy(camera.quaternion);
      if (s.kind === 0) m.scale.set(s.size, s.size, 1);
      else m.scale.set(s.size * 3.2, s.size * 0.9, 1);
    });
  });

  return (
    <>
      {slots.map((s, i) => (
        <mesh
          key={i}
          ref={(m) => {
            meshes.current[i] = m;
          }}
          geometry={geo}
          visible={false}
          renderOrder={20}
          frustumCulled={false}
        >
          <Shader vertexShader={quadVertex} fragmentShader={impactFragment} uniforms={s.u} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
      ))}
    </>
  );
});

// ---- speed lines: a full-view quad in clip space ----
const linesVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const linesFragment = /* glsl */ `
  uniform float uTime;
  uniform float uAmount;
  uniform float uAspect;
  uniform vec3 uColor;
  varying vec2 vUv;
  float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
  void main() {
    vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0) * 2.0;
    float r = length(p);
    float x = (atan(p.y, p.x) / 6.28318 + 0.5) * 220.0;
    float id = floor(x);
    float frame = floor(uTime * 24.0);
    float h = hash(id + frame * 7.13);
    float on = step(0.62, h);
    float thin = 1.0 - smoothstep(0.0, 0.08 + hash(id) * 0.3, abs(fract(x) - 0.5));
    float reach = smoothstep(0.35 + hash(id + 3.0) * 0.4, 1.4, r);
    float a = on * thin * reach * uAmount * 0.85;
    gl_FragColor = vec4(mix(vec3(1.0), uColor, 0.35) * a * 1.6, a);
  }
`;

export function SpeedLines({ fx }: { fx: StageFx }) {
  const { size } = useThree();
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uAmount: { value: 0 }, uAspect: { value: 1 }, uColor: { value: new THREE.Color() } }), []);
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    uniforms.uTime.value += Math.min(dt, 0.1);
    uniforms.uAmount.value = fx.speed;
    uniforms.uAspect.value = size.width / Math.max(size.height, 1);
    uniforms.uColor.value.copy(fx.live);
    if (ref.current) ref.current.visible = fx.speed > 0.01;
  });
  return (
    <mesh ref={ref} frustumCulled={false} renderOrder={30}>
      <planeGeometry args={[2, 2]} />
      <Shader vertexShader={linesVertex} fragmentShader={linesFragment} uniforms={uniforms} transparent depthWrite={false} depthTest={false} blending={THREE.AdditiveBlending} />
    </mesh>
  );
}
