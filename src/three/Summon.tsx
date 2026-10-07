import { useFrame } from '@react-three/fiber';
import { Bloom, ChromaticAberration, EffectComposer, Vignette } from '@react-three/postprocessing';
import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Shader } from './Shader';
import { circle, globe, starPolygon, textRing } from './ornament';

// The summoning stage, in the style of Japanese gacha games: a night sky over a glowing
// summoning circle, an orb of light that changes colour to tease the best card, a light pillar,
// god rays and star sparkles. Timelines drive it through a plain mutable record (`StageFx`), so
// GSAP tweens it without React re-renders.
//
// Bloom only catches HDR values (> 1): card faces are drawn unlit at ≤ 1 and stay crisp, while
// the light effects below are pushed above 1 on purpose.

export type StageFx = {
  bloom: number;
  chroma: number;
  shake: number;
  /** Circle rotation speed (rad/s). */
  spin: number;
  /** 0 → 1: circle, horizon glow and motes brightness. */
  power: number;
  /** Shockwave ring on the circle, 0 → 1 (radius), with its strength. */
  wave: number;
  waveAmp: number;
  pillar: number;
  rays: number;
  /** Orb brightness / presence. */
  orb: number;
  /** Target tint, and how much of a rainbow cycle replaces it (Légendaire). */
  tint: THREE.Color;
  rainbow: number;
  /** Tint actually used this frame (tint + rainbow), computed by <StageDriver>. */
  live: THREE.Color;
  /** Camera push-in towards the stage (world units), for tension. */
  zoom: number;
  /** Camera rise (world units), to keep something high in frame (the orb). */
  lift: number;
  /** 0 → 1: anime speed lines over the whole view. */
  speed: number;
};

export const IDLE_TINT = '#7fe8b8';
export const makeStageFx = (): StageFx => ({
  bloom: 1,
  chroma: 0,
  shake: 0,
  spin: 0.12,
  power: 0.3,
  wave: 0,
  waveAmp: 0,
  pillar: 0,
  rays: 0.15,
  orb: 1,
  tint: new THREE.Color(IDLE_TINT),
  rainbow: 0,
  live: new THREE.Color(IDLE_TINT),
  zoom: 0,
  lift: 0,
  speed: 0,
});

const additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending } as const;
const plainVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const hsv = new THREE.Color();

/** Computes `fx.live` once per frame (tint, or a slow rainbow for the Légendaire). */
function StageDriver({ fx }: { fx: StageFx }) {
  useFrame(({ clock }) => {
    fx.live.copy(fx.tint);
    if (fx.rainbow > 0) fx.live.lerp(hsv.setHSL((clock.elapsedTime * 0.25) % 1, 0.9, 0.62), fx.rainbow);
  });
  return null;
}

// ---------------------------------------------------------------- sky

const skyFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uTint;
  uniform float uPower;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
  void main() {
    vec2 uv = vUv;
    // Deep night at the top, a luminous blue horizon behind the circle.
    vec3 top = vec3(0.004, 0.005, 0.005);
    vec3 mid = vec3(0.012, 0.017, 0.015);
    vec3 hor = vec3(0.035, 0.065, 0.052);
    vec3 col = mix(hor, mid, smoothstep(0.34, 0.6, uv.y));
    col = mix(col, top, smoothstep(0.6, 1.0, uv.y));
    col = mix(vec3(0.008, 0.01, 0.009), col, smoothstep(0.18, 0.34, uv.y));
    // Nebula drifting slowly, catching the tint.
    float n = fbm(uv * vec2(4.0, 2.4) + vec2(uTime * 0.012, -uTime * 0.004));
    float n2 = fbm(uv * vec2(7.0, 4.0) - vec2(uTime * 0.008, 0.0));
    vec3 neb = mix(vec3(0.05, 0.08, 0.07), uTint * 0.3, 0.25);
    col += neb * smoothstep(0.5, 0.95, n) * (0.5 + 0.5 * n2) * smoothstep(0.3, 0.7, uv.y) * (0.8 + uPower * 0.6);
    // Horizon glow behind the circle.
    float d = length((uv - vec2(0.5, 0.33)) * vec2(1.4, 3.2));
    col += uTint * exp(-d * 3.2) * (0.04 + uPower * 0.22);
    // Stars, twinkling.
    vec2 g = uv * vec2(180.0, 100.0);
    vec2 id = floor(g);
    float h = hash(id);
    vec2 f = fract(g) - 0.5 - (vec2(hash(id + 1.7), hash(id + 3.1)) - 0.5) * 0.6;
    float s = step(0.982, h) * (1.0 - smoothstep(0.0, 0.12, length(f)));
    s *= 0.55 + 0.45 * sin(uTime * (1.0 + h * 3.0) + h * 60.0);
    col += vec3(0.9, 0.95, 0.92) * s * smoothstep(0.32, 0.7, uv.y) * (1.0 + step(0.997, h) * 2.0);
    gl_FragColor = vec4(col, 1.0);
  }
`;

function Sky({ fx }: { fx: StageFx }) {
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uTint: { value: new THREE.Color() }, uPower: { value: 0 } }), []);
  useFrame((_, dt) => {
    uniforms.uTime.value += Math.min(dt, 0.1);
    uniforms.uTint.value.copy(fx.live);
    uniforms.uPower.value = fx.power;
  });
  return (
    <mesh position={[0, 3, -16]} renderOrder={-10}>
      <planeGeometry args={[64, 36]} />
      <Shader vertexShader={plainVertex} fragmentShader={skyFragment} uniforms={uniforms} depthWrite={false} />
    </mesh>
  );
}

// ---------------------------------------------------------------- floor + summoning circle

const floorFragment = /* glsl */ `
  uniform vec3 uTint;
  uniform float uPower;
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float d = length(p);
    vec3 col = vec3(0.007, 0.009, 0.008) + uTint * exp(-d * 3.0) * (0.06 + uPower * 0.2);
    float a = (1.0 - smoothstep(0.55, 1.0, d));
    gl_FragColor = vec4(col, a);
  }
`;

/** The circle's two layers, drawn once: an outer ring of text and ticks, an inner star + globe. */
function circleTextures() {
  const S = 1024;
  const C = S / 2;
  const make = (draw: (g: CanvasRenderingContext2D) => void) => {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d')!;
    g.strokeStyle = '#fff';
    g.fillStyle = '#fff';
    g.lineCap = 'round';
    draw(g);
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 8;
    return t;
  };
  const outer = make((g) => {
    g.lineWidth = 7;
    circle(g, C, C, 500);
    g.lineWidth = 3;
    circle(g, C, C, 486);
    textRing(g, 'WIKIPÉDIA · L’ENCYCLOPÉDIE LIBRE · SAVOIR PARTAGÉ · ', C, C, 462, '600 30px "Crimson Pro", Georgia, serif');
    g.lineWidth = 2;
    circle(g, C, C, 436);
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      const len = i % 8 === 0 ? 26 : i % 2 === 0 ? 14 : 8;
      g.lineWidth = i % 8 === 0 ? 4 : 2;
      g.beginPath();
      g.moveTo(C + Math.cos(a) * 436, C + Math.sin(a) * 436);
      g.lineTo(C + Math.cos(a) * (436 - len), C + Math.sin(a) * (436 - len));
      g.stroke();
    }
    // Eight small medallions around the ring.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const x = C + Math.cos(a) * 392;
      const y = C + Math.sin(a) * 392;
      g.lineWidth = 3;
      circle(g, x, y, 22);
      g.lineWidth = 2;
      starPolygon(g, x, y, 16, 5, 2, a);
    }
  });
  const inner = make((g) => {
    g.lineWidth = 4;
    starPolygon(g, C, C, 350, 8, 3);
    g.lineWidth = 3;
    circle(g, C, C, 350);
    circle(g, C, C, 262);
    textRing(g, 'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩ ', C, C, 240, '500 26px "Crimson Pro", Georgia, serif');
    g.lineWidth = 3;
    circle(g, C, C, 216);
    g.lineWidth = 2;
    starPolygon(g, C, C, 216, 6, 2);
    g.lineWidth = 3;
    globe(g, C, C, 120);
  });
  return { outer, inner };
}

const circleFragment = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3 uTint;
  uniform float uPower;
  uniform float uWave;
  uniform float uWaveAmp;
  varying vec2 vUv;
  void main() {
    float m = texture2D(uMap, vUv).a;
    float d = length(vUv - 0.5) * 2.0;
    // Shockwave: a bright band travelling outwards.
    float wave = exp(-pow((d - uWave) * 9.0, 2.0)) * uWaveAmp;
    float lit = m * (0.7 + uPower * 2.2) + m * wave * 6.0 + wave * 0.3;
    vec3 col = mix(uTint, vec3(1.0), 0.25) * lit;
    gl_FragColor = vec4(col, lit);
  }
`;

function SummonCircle({ fx }: { fx: StageFx }) {
  const tex = useMemo(circleTextures, []);
  const outer = useRef<THREE.Mesh>(null);
  const inner = useRef<THREE.Mesh>(null);
  const mk = (map: THREE.Texture) => ({ uMap: { value: map }, uTint: { value: new THREE.Color() }, uPower: { value: 0 }, uWave: { value: 0 }, uWaveAmp: { value: 0 } });
  const uOuter = useMemo(() => mk(tex.outer), [tex]);
  const uInner = useMemo(() => mk(tex.inner), [tex]);
  const floor = useMemo(() => ({ uTint: { value: new THREE.Color() }, uPower: { value: 0 } }), []);
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    if (outer.current) outer.current.rotation.z += fx.spin * dt;
    if (inner.current) inner.current.rotation.z -= fx.spin * 1.6 * dt;
    for (const u of [uOuter, uInner]) {
      u.uTint.value.copy(fx.live);
      u.uPower.value = fx.power;
      u.uWave.value = fx.wave;
      u.uWaveAmp.value = fx.waveAmp;
    }
    floor.uTint.value.copy(fx.live);
    floor.uPower.value = fx.power;
  });
  return (
    <group position={[0, -1.3, -0.4]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh renderOrder={-5}>
        <planeGeometry args={[14, 14]} />
        <Shader vertexShader={plainVertex} fragmentShader={floorFragment} uniforms={floor} transparent depthWrite={false} />
      </mesh>
      <mesh ref={outer} position={[0, 0, 0.002]} renderOrder={-4}>
        <planeGeometry args={[5.4, 5.4]} />
        <Shader vertexShader={plainVertex} fragmentShader={circleFragment} uniforms={uOuter} {...additive} />
      </mesh>
      <mesh ref={inner} position={[0, 0, 0.004]} renderOrder={-4}>
        <planeGeometry args={[5.4, 5.4]} />
        <Shader vertexShader={plainVertex} fragmentShader={circleFragment} uniforms={uInner} {...additive} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------- pillar, rays, motes

const pillarFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uTint;
  uniform float uAmount;
  varying vec2 vUv;
  void main() {
    float x = (vUv.x - 0.5) * 2.0;
    float core = exp(-x * x * 30.0);
    float body = exp(-x * x * 5.0);
    float streaks = 0.6 + 0.4 * sin(vUv.y * 40.0 - uTime * 14.0 + sin(x * 9.0) * 2.0);
    float v = smoothstep(0.0, 0.08, vUv.y) * (1.0 - smoothstep(0.35, 1.0, vUv.y));
    float a = (core * 1.6 + body * 0.4 * streaks) * v * uAmount;
    vec3 col = mix(uTint, vec3(1.0), core * 0.7) * a * 1.6;
    gl_FragColor = vec4(col, a);
  }
`;

function Pillar({ fx }: { fx: StageFx }) {
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uTint: { value: new THREE.Color() }, uAmount: { value: 0 } }), []);
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    uniforms.uTime.value += Math.min(dt, 0.1);
    uniforms.uTint.value.copy(fx.live);
    uniforms.uAmount.value = fx.pillar;
    if (ref.current) ref.current.visible = fx.pillar > 0.002;
  });
  return (
    <mesh ref={ref} position={[0, 3.2, -0.4]} renderOrder={2}>
      <planeGeometry args={[3.2, 9]} />
      <Shader vertexShader={plainVertex} fragmentShader={pillarFragment} uniforms={uniforms} {...additive} />
    </mesh>
  );
}

const raysFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uTint;
  uniform float uAmount;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv - 0.5;
    float r = length(p) * 2.0;
    float a = atan(p.y, p.x);
    float rays = pow(0.5 + 0.5 * sin(a * 14.0 + uTime * 0.35), 5.0) + 0.6 * pow(0.5 + 0.5 * sin(a * 9.0 - uTime * 0.22 + 1.3), 8.0);
    float fall = (1.0 - smoothstep(0.1, 1.0, r)) * smoothstep(0.0, 0.08, r);
    float glow = exp(-r * 8.0);
    float v = (rays * fall * 0.45 + glow * 0.5) * uAmount;
    gl_FragColor = vec4(mix(uTint, vec3(1.0), 0.3) * v, v);
  }
`;

/** God rays fanning out behind the focal point; `y` follows whatever is being shown. */
function Rays({ fx }: { fx: StageFx }) {
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uTint: { value: new THREE.Color() }, uAmount: { value: 0 } }), []);
  const ref = useRef<THREE.Mesh>(null);
  useFrame((_, dt) => {
    uniforms.uTime.value += Math.min(dt, 0.1);
    uniforms.uTint.value.copy(fx.live);
    uniforms.uAmount.value = fx.rays;
    if (ref.current) ref.current.visible = fx.rays > 0.002;
  });
  return (
    <mesh ref={ref} position={[0, 0.3, -2.5]} renderOrder={-3}>
      <planeGeometry args={[13, 13]} />
      <Shader vertexShader={plainVertex} fragmentShader={raysFragment} uniforms={uniforms} {...additive} />
    </mesh>
  );
}

const moteVertex = /* glsl */ `
  attribute float aSeed;
  uniform float uTime;
  uniform float uPower;
  varying float vAlpha;
  void main() {
    vec3 p = position;
    float rise = fract(aSeed * 7.31 + uTime * (0.03 + aSeed * 0.05));
    p.y = -1.3 + rise * 5.5;
    p.x += sin(uTime * 0.6 + aSeed * 40.0) * 0.15;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = (14.0 + aSeed * 22.0) / -mv.z;
    vAlpha = smoothstep(0.0, 0.15, rise) * (1.0 - smoothstep(0.6, 1.0, rise)) * (0.35 + uPower * 0.9);
    gl_Position = projectionMatrix * mv;
  }
`;
const moteFragment = /* glsl */ `
  uniform vec3 uTint;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = exp(-d * d * 30.0) * vAlpha;
    gl_FragColor = vec4(mix(uTint, vec3(1.0), 0.5) * a * 2.0, a);
  }
`;

/** Specks of light rising slowly from the circle. */
function Motes({ fx, count = 160 }: { fx: StageFx; count?: number }) {
  const geo = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * 3.2;
      pos.set([Math.cos(a) * r, 0, -0.4 + Math.sin(a) * r * 0.8], i * 3);
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    return g;
  }, [count]);
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uPower: { value: 0 }, uTint: { value: new THREE.Color() } }), []);
  useFrame((_, dt) => {
    uniforms.uTime.value += Math.min(dt, 0.1);
    uniforms.uPower.value = fx.power;
    uniforms.uTint.value.copy(fx.live);
  });
  return (
    <points geometry={geo} frustumCulled={false}>
      <Shader vertexShader={moteVertex} fragmentShader={moteFragment} uniforms={uniforms} {...additive} />
    </points>
  );
}

// ---------------------------------------------------------------- the orb

const orbCoreVertex = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const orbCoreFragment = /* glsl */ `
  uniform vec3 uTint;
  uniform float uAmount;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    float f = 1.0 - max(dot(vN, vV), 0.0);
    vec3 col = mix(vec3(1.0), uTint, smoothstep(0.0, 0.6, f)) * (0.95 + pow(f, 2.0) * 2.0) * uAmount;
    gl_FragColor = vec4(col, 1.0);
  }
`;
const haloFragment = /* glsl */ `
  uniform vec3 uTint;
  uniform float uAmount;
  varying vec2 vUv;
  void main() {
    float d = length(vUv - 0.5) * 2.0;
    float g = exp(-d * d * 16.0) * 1.0 + exp(-d * 4.5) * 0.3;
    // Four-point flare.
    vec2 p = abs(vUv - 0.5) * 2.0;
    float flare = exp(-p.x * 70.0) * exp(-p.y * 3.2) + exp(-p.y * 70.0) * exp(-p.x * 3.2);
    float a = (g + flare * 0.9) * (1.0 - smoothstep(0.7, 1.0, d)) * uAmount;
    gl_FragColor = vec4(mix(uTint, vec3(1.0), 0.2) * a * 1.25, a);
  }
`;

/** A sphere of light with a halo, a star flare and two orbiting rings. Its group is moved by the timelines. */
export const Orb = forwardRef<THREE.Group, { fx: StageFx }>(function Orb({ fx }, ref) {
  const core = useMemo(() => ({ uTint: { value: new THREE.Color() }, uAmount: { value: 1 } }), []);
  const halo = useMemo(() => ({ uTint: { value: new THREE.Color() }, uAmount: { value: 1 } }), []);
  const ringMat = useMemo(() => new THREE.MeshBasicMaterial({ ...additive, color: new THREE.Color() }), []);
  const rings = useRef<THREE.Group>(null);
  const bob = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    core.uTint.value.copy(fx.live);
    halo.uTint.value.copy(fx.live);
    core.uAmount.value = fx.orb;
    halo.uAmount.value = fx.orb * (0.9 + 0.1 * Math.sin(t * 3.0));
    ringMat.color.copy(fx.live).multiplyScalar(2.2 * fx.orb);
    if (rings.current) {
      rings.current.children[0]!.rotation.set(1.2, t * 0.9, 0.3);
      rings.current.children[1]!.rotation.set(-0.5, -t * 1.3, 1.1);
    }
    if (bob.current) bob.current.position.y = Math.sin(t * 1.4) * 0.06;
  });
  return (
    <group ref={ref}>
      <group ref={bob}>
        <mesh renderOrder={3}>
          <planeGeometry args={[1.9, 1.9]} />
          <Shader vertexShader={plainVertex} fragmentShader={haloFragment} uniforms={halo} {...additive} />
        </mesh>
        <mesh renderOrder={4}>
          <sphereGeometry args={[0.2, 32, 24]} />
          <Shader vertexShader={orbCoreVertex} fragmentShader={orbCoreFragment} uniforms={core} />
        </mesh>
        <group ref={rings}>
          <mesh material={ringMat}>
            <torusGeometry args={[0.36, 0.006, 6, 96]} />
          </mesh>
          <mesh material={ringMat}>
            <torusGeometry args={[0.44, 0.005, 6, 96]} />
          </mesh>
        </group>
      </group>
    </group>
  );
});

// ---------------------------------------------------------------- scene pieces

export function StageBackdrop({ fx, motes = true }: { fx: StageFx; motes?: boolean }) {
  return (
    <>
      <color attach="background" args={['#0a0a0a']} />
      <StageDriver fx={fx} />
      <Sky fx={fx} />
      <Rays fx={fx} />
      <SummonCircle fx={fx} />
      <Pillar fx={fx} />
      {motes && <Motes fx={fx} />}
    </>
  );
}

/** Post FX: bloom on HDR light only, chromatic aberration for the big moments, a soft vignette. */
export function StageEffects({ fx }: { fx: StageFx }) {
  const bloom = useRef<{ intensity: number } | null>(null);
  const chroma = useRef<{ offset: THREE.Vector2 } | null>(null);
  useFrame(() => {
    if (bloom.current) bloom.current.intensity = fx.bloom * 0.75;
    if (chroma.current) chroma.current.offset.set(fx.chroma * 0.01, fx.chroma * 0.005);
  });
  return (
    <EffectComposer multisampling={4}>
      <Bloom ref={bloom as never} intensity={1} luminanceThreshold={1.05} luminanceSmoothing={0.25} mipmapBlur radius={0.6} />
      <ChromaticAberration ref={chroma as never} offset={new THREE.Vector2(0, 0)} radialModulation={false} modulationOffset={0} />
      <Vignette eskil={false} offset={0.32} darkness={0.55} />
    </EffectComposer>
  );
}

type BurstOpts = { gravity?: number; size?: number; life?: number; drag?: number; spread?: number };
export type ParticlesHandle = {
  /** Sparkles flung out from `origin`. */
  burst: (origin: THREE.Vector3, color: string, count: number, power?: number, opts?: BurstOpts) => void;
  /** Sparkles sucked into `target` from a shell of `radius` (charging up). */
  converge: (target: THREE.Vector3, color: string, count: number, radius?: number, life?: number) => void;
  /** Sparkles falling from above the stage (star rain after a big reveal). */
  rain: (color: string, count: number, width?: number) => void;
};

const sparkVertex = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aLife;
  varying vec3 vColor;
  varying float vLife;
  void main() {
    vColor = aColor;
    vLife = aLife;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * clamp(aLife * 2.0, 0.0, 1.0) * 300.0 / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;
const sparkFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vLife;
  void main() {
    if (vLife <= 0.0) discard;
    vec2 p = (gl_PointCoord - 0.5) * 2.0;
    vec2 q = abs(p);
    // Four-point star with a round core.
    float star = exp(-q.x * 10.0) * exp(-q.y * 1.6) + exp(-q.y * 10.0) * exp(-q.x * 1.6);
    float core = exp(-dot(p, p) * 10.0);
    float a = clamp(star * 0.9 + core, 0.0, 1.0) * clamp(vLife * 2.0, 0.0, 1.0);
    gl_FragColor = vec4(vColor * a * 1.9, a);
  }
`;

/** Star sparkles: points with velocity, per-particle gravity and drag, drawn as four-point stars. */
export const Particles = forwardRef<ParticlesHandle>(function Particles(_, ref) {
  const MAX = 1600;
  const state = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(MAX * 3);
    const col = new Float32Array(MAX * 3);
    const size = new Float32Array(MAX);
    const life = new Float32Array(MAX);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.setAttribute('aLife', new THREE.BufferAttribute(life, 1));
    return { g, pos, col, size, life, vel: new Float32Array(MAX * 3), grav: new Float32Array(MAX), drag: new Float32Array(MAX), next: 0 };
  }, []);
  const c = useMemo(() => new THREE.Color(), []);

  const spawn = (p: [number, number, number], v: [number, number, number], hex: string, white: boolean, life: number, size: number, grav: number, drag: number) => {
    const i = state.next++ % MAX;
    state.pos.set(p, i * 3);
    state.vel.set(v, i * 3);
    state.life[i] = life;
    state.size[i] = size;
    state.grav[i] = grav;
    state.drag[i] = drag;
    c.set(white ? '#ffffff' : hex);
    state.col.set([c.r, c.g, c.b], i * 3);
  };
  const touched = () => {
    state.g.attributes.aColor!.needsUpdate = true;
    state.g.attributes.aSize!.needsUpdate = true;
  };

  useImperativeHandle(ref, () => ({
    burst(origin, hex, count, power = 1, o = {}) {
      for (let k = 0; k < count; k++) {
        // Even sphere of directions, flattened towards the camera plane.
        const a = Math.random() * Math.PI * 2;
        const z = Math.random() * 2 - 1;
        const r = Math.sqrt(1 - z * z);
        const sp = (1.2 + Math.random() * 2.8) * power * (o.spread ?? 1);
        // Start spread over a small ball, not one point: a dense additive cluster blooms into a white disc.
        const j = 0.18 * Math.random();
        spawn([origin.x + Math.cos(a) * r * j, origin.y + Math.sin(a) * r * j, origin.z + z * j], [Math.cos(a) * r * sp, Math.sin(a) * r * sp + 0.6, z * sp * 0.4], hex, k % 4 === 0, (o.life ?? 1) * (0.9 + Math.random() * 1.1), (o.size ?? 1) * (0.05 + Math.random() * 0.09), o.gravity ?? 1.4, o.drag ?? 0.975);
      }
      touched();
    },
    converge(target, hex, count, radius = 2.2, life = 0.6) {
      for (let k = 0; k < count; k++) {
        const a = Math.random() * Math.PI * 2;
        const z = (Math.random() * 2 - 1) * 0.5;
        const r = Math.sqrt(1 - z * z);
        const d = radius * (0.6 + Math.random() * 0.5);
        const dir: [number, number, number] = [Math.cos(a) * r, Math.sin(a) * r, z];
        const l = life * (0.8 + Math.random() * 0.4);
        // Starts on the shell, flies straight in, dies on arrival.
        spawn([target.x + dir[0] * d, target.y + dir[1] * d, target.z + dir[2] * d], [(-dir[0] * d) / l, (-dir[1] * d) / l, (-dir[2] * d) / l], hex, k % 3 === 0, l, 0.04 + Math.random() * 0.06, 0, 1);
      }
      touched();
    },
    rain(hex, count, width = 8) {
      for (let k = 0; k < count; k++) {
        spawn([(Math.random() - 0.5) * width, 2.6 + Math.random() * 1.6, -0.5 + Math.random() * 2.5], [(Math.random() - 0.5) * 0.4, -1.2 - Math.random() * 1.8, 0], hex, k % 3 === 0, 2 + Math.random() * 1.5, 0.05 + Math.random() * 0.1, 0.25, 0.995);
      }
      touched();
    },
  }));

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    for (let i = 0; i < MAX; i++) {
      if (state.life[i]! <= 0) continue;
      state.life[i]! -= dt;
      state.vel[i * 3 + 1]! -= state.grav[i]! * dt;
      const d = Math.pow(state.drag[i]!, dt * 60);
      for (let a = 0; a < 3; a++) {
        state.vel[i * 3 + a]! *= d;
        state.pos[i * 3 + a]! += state.vel[i * 3 + a]! * dt;
      }
    }
    state.g.attributes.position!.needsUpdate = true;
    state.g.attributes.aLife!.needsUpdate = true;
  });

  return (
    <points geometry={state.g} frustumCulled={false} renderOrder={10}>
      <Shader vertexShader={sparkVertex} fragmentShader={sparkFragment} {...additive} />
    </points>
  );
});
