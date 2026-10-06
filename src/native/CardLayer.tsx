import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import * as THREE from 'three';
import { CardMesh } from '../three/CardMesh';
import { occluderList, pinList, pinReady, rectOf, subscribePins, type Pin, type Rect } from './pins';

// The card layer: one transparent WebGL canvas over the whole interface that draws only cards,
// each over its HTML anchor (native/pins.ts). The camera is calibrated so that one world unit is
// one CSS pixel on the z = 0 plane: a card at rest covers its anchor exactly, and anything that
// lifts it (hover, a flight) is real perspective. The canvas never takes the pointer.
//
// Cards are clipped to their board (scissor per board), so a card dealt out of a page or lifted at
// the edge never spills over the header; cards in flight are drawn last, above everything.

const FOV = 30;
const LIFT = 26;
const FLIGHT_Z = 220;
/** Cards live within ± this many px of the z = 0 plane (flights, lifts, turns). */
const DEPTH_RANGE = 600;

const shadowTex = (() => {
  const c = document.createElement('canvas');
  c.width = 160;
  c.height = 210;
  const g = c.getContext('2d')!;
  // Only the blurred shadow of a rectangle drawn off-canvas lands on it.
  g.shadowColor = '#000';
  g.shadowBlur = 22;
  g.shadowOffsetX = 1000;
  g.beginPath();
  g.roundRect(30 - 1000, 30, 100, 150, 10);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const plane = new THREE.PlaneGeometry(1, 1);

function PinView({ pin }: { pin: Pin }) {
  const root = useRef<THREE.Group>(null);
  const card = useRef<THREE.Group>(null);
  const shadow = useRef<THREE.Mesh>(null);
  const shadowMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#000', alphaMap: shadowTex, transparent: true, depthWrite: false, opacity: 0 }), []);
  const size = useThree((s) => s.size);
  useFrame((_, delta) => {
    const g = card.current;
    const s = shadow.current;
    const o = root.current;
    if (!g || !s || !o) return;
    const k = 1 - Math.exp(-Math.min(delta, 0.05) * 14);
    pin.hover += (pin.hoverT - pin.hover) * k;
    pin.tilt[0] += (pin.tiltT[0] - pin.tilt[0]) * k;
    pin.tilt[1] += (pin.tiltT[1] - pin.tilt[1]) * k;
    let r: Rect | null;
    let z = 0;
    let turn = pin.spin;
    const f = pin.flight;
    if (f) {
      const to = pin.anchor ? rectOf(pin.anchor.el) : (pin.last ?? f.from);
      const p = f.p;
      r = { x: f.from.x + (to.x - f.from.x) * p, y: f.from.y + (to.y - f.from.y) * p - Math.sin(Math.PI * p) * 40, w: f.from.w + (to.w - f.from.w) * p, h: f.from.h + (to.h - f.from.h) * p };
      z = Math.sin(Math.PI * p) * FLIGHT_Z;
      turn = f.spin0 * (1 - p) + f.turn * p;
    } else r = pin.anchor ? rectOf(pin.anchor.el) : pin.last;
    const show = !!r && r.w > 1 && pin.enter > 0.02;
    o.userData.show = show;
    o.userData.clip = f ? null : pin.clip;
    if (!r || !show) return;
    if (!pin.leaving) pin.last = r;
    const h = pin.hover;
    const out = 1 - pin.enter;
    const x = r.x - size.width / 2 + out * 40 * pin.dir;
    const y = size.height / 2 - r.y;
    g.position.set(x, y, z + h * LIFT);
    g.scale.setScalar(r.w * (1 + h * 0.05) * (0.9 + 0.1 * pin.enter));
    g.rotation.set(-pin.tilt[1] * 0.3 * h, pin.tilt[0] * 0.36 * h + turn + out * (Math.PI / 2) * pin.dir, 0);
    const lift = h + z / 120;
    s.position.set(x + lift * 5, y - 4 - lift * 12, -2);
    s.scale.set(r.w * 1.6 * (1 + lift * 0.08), r.h * 1.4 * (1 + lift * 0.06), 1);
    shadowMat.opacity = (0.3 + Math.min(1, lift) * 0.3) * pin.enter;
  });
  return (
    <group ref={root} userData={{ pin: pin.key }}>
      <mesh ref={shadow} geometry={plane} material={shadowMat} renderOrder={-2} />
      <CardMesh ref={card} card={pin.card} shiny={pin.shiny} res={0.6} onReady={() => pinReady(pin)} />
    </group>
  );
}

/** Keeps the camera at the distance where 1 unit = 1 CSS pixel at z = 0. */
function PixelCamera() {
  const { camera, size } = useThree();
  useLayoutEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    cam.fov = FOV;
    cam.aspect = size.width / size.height;
    cam.position.set(0, 0, size.height / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2)));
    // A tight depth range: a card face sits ~0.1 px above its body, a wide range makes them fight.
    cam.near = Math.max(1, cam.position.z - DEPTH_RANGE);
    cam.far = cam.position.z + DEPTH_RANGE;
    cam.updateProjectionMatrix();
  }, [camera, size]);
  return null;
}

/** Renders board by board (scissored), then the unclipped cards (flights) on top. */
function Passes() {
  useFrame(({ gl, scene, camera, size }) => {
    gl.autoClear = false;
    // Always transparent: this layer lies over the whole interface.
    gl.setClearColor(0x000000, 0);
    gl.setScissorTest(false);
    gl.clear();
    const groups = new Map<HTMLElement | null, THREE.Object3D[]>();
    const all: THREE.Object3D[] = [];
    for (const o of scene.children) {
      if (!o.userData.pin) continue;
      all.push(o);
      const c = (o.userData.clip as HTMLElement | null) ?? null;
      let arr = groups.get(c);
      if (!arr) groups.set(c, (arr = []));
      arr.push(o);
    }
    if (!all.length) return;
    const occ = [...occluderList()].map((e) => ({ el: e, r: e.getBoundingClientRect() }));
    const only = (objs: THREE.Object3D[]) => all.forEach((o) => (o.visible = !!o.userData.show && objs.includes(o)));
    for (const [clip, objs] of groups) {
      if (!clip) continue;
      const r = clip.getBoundingClientRect();
      let bottom = r.bottom;
      // A sheet over the board cuts its cards; the sheet's own cards (clipped to it) stay whole.
      for (const { el, r: o } of occ) if (el !== clip && !el.contains(clip) && o.top < bottom && o.bottom > r.top && o.left <= r.left + 1 && o.right >= r.right - 1) bottom = Math.min(bottom, Math.max(r.top, o.top));
      if (bottom - r.top < 1 || r.width < 1) continue;
      only(objs);
      gl.setScissorTest(true);
      gl.setScissor(r.left, size.height - bottom, r.width, bottom - r.top);
      gl.render(scene, camera);
    }
    const free = groups.get(null);
    gl.setScissorTest(false);
    if (free?.length) {
      gl.clearDepth();
      only(free);
      gl.render(scene, camera);
    }
  }, 1);
  return null;
}

function Pins() {
  const pins = useSyncExternalStore(subscribePins, pinList);
  return (
    <>
      {pins.map((p) => (
        <PinView key={p.key} pin={p} />
      ))}
    </>
  );
}

export function CardLayer() {
  return (
    <Canvas
      className="wme-cardlayer"
      flat
      dpr={[1, 2]}
      gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
      camera={{ fov: FOV, near: 1, far: 10_000, position: [0, 0, 1000] }}
      style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 2 }}
    >
      <PixelCamera />
      <Pins />
      <Passes />
    </Canvas>
  );
}
