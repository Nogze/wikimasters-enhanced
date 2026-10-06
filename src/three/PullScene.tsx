import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import gsap from 'gsap';
import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { best, RARITY_ORDER, RARITY_STYLE } from '../lib/rarity';
import { sfx } from '../lib/sfx';
import type { Card, Rarity } from '../lib/types';
import { CardMesh, type CardFx } from './CardMesh';
import { makePackFx, PACK_W, PackMesh, SEAM_Y } from './PackMesh';
import { Impacts, SpeedLines, type VfxHandle } from './Vfx';
import { IDLE_TINT, Orb, Particles, type ParticlesHandle, type StageFx } from './Summon';

// Opening a booster, for real: the pack floats over the summoning circle; drag along the
// perforation to tear it (a glowing line follows the finger, foil crinkles), and the top strip
// rips away. An orb of light rises out of the pack and « computes » the best card inside,
// climbing the rarity ladder (white → blue → violet → gold → rainbow) with a bell and a
// shockwave per rung, then bursts; the cards slide out as a face-down stack, the top
// one glowing in its own rarity. Tap: the top card turns (rare ones come forward under god rays
// and spin); tap again: it goes to the tray and the next one waits. After the last, the five line
// up. The pack is only spent once the tear passes a third of the seam (requestPulls).
//
// All motion is GSAP timelines on three.js objects and mutable fx records: no React re-render
// during an animation. The page only hears phases and reveals.

export type Pull = { card: Card; is_shiny: boolean; user_card_id: string; owned_copies: number; is_new: boolean };
export type Phase = 'idle' | 'tearing' | 'opening' | 'reveal' | 'done';
/** Reveal progress: which card is on top of the stack, and whether it's been turned. */
export type PhaseState = { index: number; faceUp: boolean; total: number };

export type PullStageHandle = {
  /** Tears the pack open by itself (button / Space). */
  autoTear(): void;
  /** Reveal phase: turn the top card, or send a turned card to the tray. */
  next(): void;
  /** Reveal phase: turn everything left and line up. */
  skip(): void;
  /** Done: the cards fly away and a new pack drops in. */
  reset(): Promise<void>;
};

type Props = {
  /** Spends a pack. Called once, when the tear is committed. */
  requestPulls: () => Promise<Pull[]>;
  canOpen: boolean;
  onPhase?: (phase: Phase, state: PhaseState) => void;
  onReveal?: (i: number, pull: Pull) => void;
  onFlash?: (strength: number) => void;
};

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const frames = (n: number) => new Promise<void>((r) => { const step = (k: number) => (k <= 0 ? r() : requestAnimationFrame(() => step(k - 1))); step(n); });
/**
 * Background tabs get no animation frames, so a timeline would never end and the opening would
 * hang half-way. If the tab is hidden once a timeline's time is up, jump it to its end (timers
 * still tick in the background, about once a second).
 */
function whenHidden(tl: gsap.core.Timeline | gsap.core.Tween, finish: () => void): () => void {
  const due = performance.now() + (tl.totalDuration() / Math.max(0.01, tl.timeScale())) * 1000 + 400;
  const id = setInterval(() => {
    if (document.hidden && performance.now() > due) {
      clearInterval(id);
      tl.progress(1, true);
      finish();
    }
  }, 500);
  return () => clearInterval(id);
}
const done = (tl: gsap.core.Timeline | gsap.core.Tween) =>
  new Promise<void>((r) => {
    let stop = () => {};
    const end = () => (stop(), r());
    tl.eventCallback('onComplete', end);
    stop = whenHidden(tl, end);
  });
/** Overall pace of the opening's timelines (1 = as authored). */
const SPEED = 1.3;
const rgb = (hex: string) => { const c = new THREE.Color(hex); return { r: c.r, g: c.g, b: c.b }; };
const hypeOf = (p: Pull) => Math.min(1, RARITY_STYLE[p.card.rarity].hype + (p.is_shiny ? 0.35 : 0));

const LADDER: { from: Rarity; color: string }[] = [
  { from: 'C', color: '#dfe8ff' },
  { from: 'R', color: RARITY_STYLE.R.color },
  { from: 'SR', color: RARITY_STYLE.SR.color },
  { from: 'UR', color: RARITY_STYLE.UR.color },
  { from: 'L', color: RARITY_STYLE.L.color },
];
const rank = (r: Rarity) => RARITY_ORDER.length - 1 - RARITY_ORDER.indexOf(r);

const PACK_HOME = new THREE.Vector3(0, 0.12, 0);
const STACK = new THREE.Vector3(0, 0.15, 1.2);
const FRONT = new THREE.Vector3(0, 0.1, 2.0);
/** Where the rarity orb hovers while it climbs the ladder, above the open pack. */
const ORB_UP = new THREE.Vector3(0, 1.3, 0.45);

export const PullScene = forwardRef<PullStageHandle, Props & { stage: StageFx }>(function PullScene({ stage, requestPulls, canOpen, onPhase, onReveal, onFlash }, ref) {
  const { viewport } = useThree();
  const packRoot = useRef<THREE.Group>(null);
  const packSway = useRef<THREE.Group>(null);
  const orb = useRef<THREE.Group>(null);
  const strip = useRef<THREE.Group | null>(null);
  const particles = useRef<ParticlesHandle>(null);
  const vfx = useRef<VfxHandle>(null);
  const cardRefs = useRef<(THREE.Group | null)[]>([]);
  const ready = useRef<Set<number>>(new Set());
  const [pulls, setPulls] = useState<Pull[] | null>(null);
  const packFx = useMemo(makePackFx, []);
  const cardFx = useMemo<CardFx[]>(() => Array.from({ length: 5 }, () => ({ glow: 0, holo: 0 })), []);

  // Mutable state of the machine (no re-renders).
  const m = useRef({
    phase: 'idle' as Phase,
    pulls: null as Pull[] | null,
    pending: null as Promise<Pull[]> | null,
    dragging: false,
    lastCrinkle: 0,
    finishing: false,
    top: 0,
    turned: false,
    busy: false,
    /** A tap that came while busy: played as soon as the current move ends (games buffer input). */
    queued: false,
    /** Phase when the current press began: the release of a tear drag is also a click, and must not skip the orb. */
    downPhase: 'idle' as Phase,
    /** Fast-forwards for the timelines playing now (a tap during an animation jumps to its end). */
    active: new Map<() => void, gsap.core.Timeline>(),
    sway: 1,
  }).current;


  const setPhase = (p: Phase) => {
    m.phase = p;
    // Readable from outside the client (the extension runs in an isolated world): diagnostics.
    document.documentElement.dataset.wcPhase = p;
    onPhase?.(p, { index: m.top, faceUp: m.turned, total: m.pulls?.length ?? 5 });
  };

  const spacing = Math.min(1.24, viewport.width / 5.2);
  const rowSlot = (i: number) => new THREE.Vector3((i - 2) * spacing, 0.0, -Math.abs(i - 2) * 0.1);
  const traySlot = (i: number) => new THREE.Vector3((i - 2) * Math.min(0.56, viewport.width / 10), -1.08, 1.0);

  // ---------------------------------------------------------------- idle sway + hover lean
  useFrame(({ clock, pointer }) => {
    const g = packSway.current;
    if (!g) return;
    const t = clock.elapsedTime;
    const w = m.sway;
    g.position.y = Math.sin(t * 1.4) * 0.05 * w;
    g.rotation.y = (Math.sin(t * 0.5) * 0.22 + pointer.x * 0.35) * w;
    g.rotation.x = (Math.sin(t * 0.7) * 0.04 - pointer.y * 0.18) * w;
  });

  // ---------------------------------------------------------------- tearing
  const toPack = (p: THREE.Vector3) => (packRoot.current ? packRoot.current.worldToLocal(p.clone()) : p.clone());
  const tipWorld = () => {
    const v = new THREE.Vector3(-PACK_W / 2 + packFx.tear * PACK_W, SEAM_Y, 0.02);
    return packRoot.current ? packRoot.current.localToWorld(v) : v;
  };
  const peel = () => {
    const s = strip.current;
    if (!s) return;
    s.rotation.z = -packFx.tear * 0.12;
    s.position.y = SEAM_Y + packFx.tear * 0.035;
  };

  function commit() {
    if (m.pending) return;
    m.pending = requestPulls();
    // A failure is handled where the promise is awaited (finish); avoid an unhandled rejection meanwhile.
    m.pending.catch(() => {});
  }

  function setTear(p: number, speed: number) {
    if (p <= packFx.tear) return;
    packFx.tear = p;
    peel();
    if (p - m.lastCrinkle > 0.035) {
      m.lastCrinkle = p;
      sfx.crinkle(Math.min(1, speed));
      particles.current?.burst(tipWorld(), `#${packFx.tearColor.getHexString()}`, 3, 0.35);
    }
    if (p > 0.33) commit();
  }

  function snapBack() {
    gsap.to(packFx, { tear: 0, duration: 0.45, ease: 'elastic.out(1, 0.5)', onUpdate: peel });
    m.lastCrinkle = 0;
    m.sway = 1;
    setPhase('idle');
  }

  async function finish() {
    if (m.finishing) return;
    m.finishing = true;
    m.dragging = false;
    await done(gsap.to(packFx, { tear: 1, duration: 0.25 * (1 - packFx.tear) + 0.05, ease: 'power1.in', onUpdate: peel }));
    // Trembling while the server answers (usually already there).
    const wait = gsap.to(packSway.current!.rotation, { z: 0.03, duration: 0.05, yoyo: true, repeat: -1 });
    let next: Pull[];
    try {
      next = await m.pending!;
    } catch {
      wait.kill();
      packSway.current!.rotation.z = 0;
      m.pending = null;
      m.finishing = false;
      snapBack();
      return;
    }
    wait.kill();
    packSway.current!.rotation.z = 0;
    await open(next);
  }

  function onDown(e: ThreeEvent<PointerEvent>) {
    m.downPhase = m.phase;
    if (m.phase !== 'idle' || !canOpen || m.busy) return;
    const p = toPack(e.point);
    const nearSeam = Math.abs(p.y - SEAM_Y) < 0.4 && Math.abs(p.x) < PACK_W / 2 + 0.25;
    if (!nearSeam) {
      // A tap on the pack body: it wiggles, as a hint.
      if (Math.abs(p.x) < PACK_W / 2 && Math.abs(p.y) < 1.1) gsap.fromTo(packSway.current!.rotation, { z: 0.06 }, { z: 0, duration: 0.6, ease: 'elastic.out(1, 0.3)' });
      return;
    }
    (e.target as unknown as Element).setPointerCapture?.(e.pointerId);
    m.dragging = true;
    m.sway = 0.25;
    setPhase('tearing');
    setTear(Math.max(0.01, (p.x + PACK_W / 2) / PACK_W), 0.2);
  }
  function onMove(e: ThreeEvent<PointerEvent>) {
    if (!m.dragging) return;
    const p = toPack(e.point);
    const speed = Math.abs(e.nativeEvent.movementX ?? 0) / 25;
    setTear(Math.min(1, Math.max(0, (p.x + PACK_W / 2) / PACK_W)), speed);
    if (packFx.tear >= 0.97) void finish();
  }
  function onUp() {
    if (!m.dragging) return;
    m.dragging = false;
    // Committed (pack already spent): the tear completes on its own. Otherwise it closes again.
    if (m.pending) void finish();
    else snapBack();
  }
  function onTap() {
    // Only presses that started during the opening or the reveal count as taps.
    if (m.downPhase === 'opening' || m.downPhase === 'reveal') void next();
  }

  /** Plays a timeline at the opening's pace; resolves when it ends or is fast-forwarded. */
  function run(tl: gsap.core.Timeline) {
    tl.timeScale(tl.timeScale() * SPEED);
    return new Promise<void>((resolve) => {
      let settled = false;
      let stop = () => {};
      const end = () => {
        if (settled) return;
        settled = true;
        stop();
        m.active.delete(skipToEnd);
        resolve();
      };
      // Jumps to the final state without firing the callbacks on the way (no burst of sounds).
      const skipToEnd = () => {
        tl.progress(1, true);
        end();
      };
      m.active.set(skipToEnd, tl);
      tl.eventCallback('onComplete', end);
      stop = whenHidden(tl, end);
    });
  }
  const hurry = () => [...m.active.keys()].forEach((f) => f());

  // ---------------------------------------------------------------- the rip and the stack
  async function open(next: Pull[]) {
    m.busy = true;
    m.pulls = next;
    ready.current = new Set();
    setPulls(next);
    setPhase('opening');
    await frames(2); // let the cards mount
    const pack = packRoot.current!;
    const s = strip.current!;
    const o = orb.current!;
    const fxv = vfx.current!;
    const sparks = particles.current!;
    const cards = cardRefs.current.slice(0, next.length).filter(Boolean) as THREE.Group[];
    const top = best(next.map((p) => p.card.rarity));
    const hype = RARITY_STYLE[top].hype;
    const big = hype >= 0.55;
    const fast = reduced();
    const n = fast ? 0.3 : 1; // particle budget
    const steps = LADDER.filter((l) => rank(l.from) <= rank(top));
    const seam = pack.localToWorld(new THREE.Vector3(0, SEAM_Y, 0.05));
    const inside = pack.localToWorld(new THREE.Vector3(0, SEAM_Y - 0.75, 0));
    const live = () => `#${stage.live.getHexString()}`;

    // Cards wait inside the pouch, face down (backs to the camera).
    cards.forEach((c, i) => {
      c.position.copy(inside).add(new THREE.Vector3(0, 0, -0.01 - i * 0.004));
      c.rotation.set(0, Math.PI, 0);
      c.scale.setScalar(0.85);
      c.visible = true;
    });
    cardFx.forEach((f) => ((f.glow = 0), (f.holo = 0)));

    const tl = gsap.timeline();

    // 1. Rip: the strip flies off in a blast of foil sparks and light; the pack recoils.
    tl.call(() => {
      sfx.rip();
      onFlash?.(0.4);
      fxv.ring(seam, '#ffffff', { size: 3.2, duration: 0.55, width: 0.06 });
      fxv.flare(seam, '#cfe0ff', { size: 1.6, duration: 0.5 });
      sparks.burst(seam, '#ffe9a8', Math.round(90 * n), 1.3, { size: 1.1 });
      sparks.burst(seam, '#ffffff', Math.round(40 * n), 2.2, { size: 0.6, gravity: 0.6 });
    }, [], 0)
      .to(s.position, { x: s.position.x + 1.6, y: s.position.y + 2.4, z: 1.2, duration: 0.7, ease: 'power3.out' }, 0)
      .to(s.rotation, { z: -3.2, x: 1.6, y: 0.8, duration: 0.7, ease: 'power2.out' }, 0)
      .set(s, { visible: false }, 0.7)
      .to(packFx, { tear: 0, duration: 0.01 }, 0.05)
      .fromTo(stage, { shake: 0.45, speed: 0.6, chroma: 0.25 }, { shake: 0, speed: 0, chroma: 0, duration: 0.6, ease: 'power2.out', immediateRender: false }, 0)
      .fromTo(pack.scale, { x: 1.08, y: 0.93, z: 1.08 }, { x: 1, y: 1, z: 1, duration: 0.6, ease: 'elastic.out(1, 0.35)', immediateRender: false }, 0);

    // 2. The orb rises out of the open pack.
    o.position.copy(seam);
    o.scale.setScalar(0.2);
    stage.orb = 0;
    tl.set(o, { visible: true }, 0.3)
      .to(stage, { orb: 1, duration: 0.3 }, 0.3)
      .to(o.position, { x: ORB_UP.x, y: ORB_UP.y, z: ORB_UP.z, duration: 0.55, ease: 'power3.out' }, 0.3)
      .to(o.scale, { x: 1.15, y: 1.15, z: 1.15, duration: 0.55, ease: 'back.out(1.6)' }, 0.3)
      .to(packFx, { glow: 0.5, duration: 0.3 }, 0.3)
      .call(() => sparks.burst(ORB_UP, '#ffffff', Math.round(30 * n), 0.6, { gravity: 0 }), [], 0.75);

    // 3. It « computes » the rarity: one rung per tier up to the best card inside, each a bell, a
    // pulse, a ring and sparks; between rungs energy streams into the orb, the camera creeps in and
    // the speed lines build. The ladder keeps its own pace (0.5 s a rung on screen).
    const STEP = 0.5 * SPEED;
    const t0 = 0.9;
    steps.forEach((l, k) => {
      const at = t0 + k * STEP;
      tl.to(stage.tint, { ...rgb(l.color), duration: 0.18, ease: 'power2.out' }, at)
        .to(packFx.glowColor, { ...rgb(l.color), duration: 0.18 }, at)
        .to(packFx, { glow: 0.5 + k * 0.25, duration: 0.15 }, at)
        .to(stage, { rays: 0.3 + k * 0.15, power: 0.55 + k * 0.1, zoom: 0.15 + k * 0.14, lift: 0.45, speed: k * 0.14, duration: 0.25, ease: 'power2.out' }, at)
        .call(() => {
          sfx.step(k);
          onFlash?.(0.08 + k * 0.05);
          fxv.ring(ORB_UP, l.color, { size: 1.6 + k * 0.5, duration: 0.6 });
          sparks.burst(ORB_UP, l.color, Math.round((24 + k * 18) * n), 0.7 + k * 0.2, { gravity: 0.3 });
        }, [], at)
        .fromTo(stage, { wave: 0.05, waveAmp: 1 }, { wave: 1.1, waveAmp: 0, duration: 0.75, ease: 'power2.out', immediateRender: false }, at)
        .fromTo(stage, { shake: 0.1 + k * 0.06 }, { shake: 0.02 + k * 0.02, duration: 0.3, immediateRender: false }, at)
        .fromTo(o.scale, { x: 1.7, y: 1.7, z: 1.7 }, { x: 1.15 + k * 0.06, y: 1.15 + k * 0.06, z: 1.15 + k * 0.06, duration: 0.4, ease: 'power3.out', immediateRender: false }, at)
        .fromTo(pack.rotation, { z: 0.04 }, { z: 0, duration: 0.4, ease: 'elastic.out(1, 0.3)', immediateRender: false }, at);
      for (let j = 1; j <= 3; j++) tl.call(() => sparks.converge(ORB_UP, l.color, Math.round((10 + k * 6) * n), 2.2 + k * 0.3, 0.45), [], at + (j * STEP) / 4);
      if (l.from === 'L') tl.to(stage, { rainbow: 1, duration: 0.4 }, at);
    });
    let B = t0 + steps.length * STEP + 0.05;

    // 4. Rare packs: the orb holds its breath (shrinking, trembling, swallowing light) before it blows.
    if (big) {
      const H = 0.6 * SPEED;
      tl.to(stage, { speed: 0.9, zoom: '+=0.35', shake: 0.25, duration: H, ease: 'power2.in' }, B)
        .to(o.scale, { x: 0.85, y: 0.85, z: 0.85, duration: H, ease: 'power2.in' }, B)
        .call(() => {
          sfx.tension(H / SPEED);
          sparks.converge(ORB_UP, live(), Math.round(90 * n), 3, (H / SPEED) * 0.9);
        }, [], B)
        .fromTo(o.position, { x: ORB_UP.x - 0.025 }, { x: ORB_UP.x + 0.025, duration: 0.04, yoyo: true, repeat: Math.round(H / 0.04), ease: 'none', immediateRender: false }, B)
        .set(o.position, { x: ORB_UP.x }, B + H);
      B += H;
    }

    // 5. BOOM: the orb explodes (rings, flare, a storm of sparks), the pillar fires, the camera kicks back.
    const T = B + 0.12;
    tl.to(o.scale, { x: 0.4, y: 0.4, z: 0.4, duration: 0.12, ease: 'power3.in' }, B)
      .call(() => {
        const c = live();
        sfx.summon(hype);
        onFlash?.(0.3 + hype * 0.25);
        fxv.ring(ORB_UP, c, { size: 4, duration: 0.6, width: 0.07 });
        fxv.ring(ORB_UP, '#ffffff', { size: 7, duration: 0.9, width: 0.05 });
        fxv.ring(ORB_UP, c, { size: 11, duration: 1.3, width: 0.04 });
        fxv.flare(ORB_UP, c, { size: 2.6 + hype * 1.5, duration: 0.9 });
        sparks.burst(ORB_UP, c, Math.round((90 + hype * 150) * n), 2 + hype * 1.4, { gravity: 0.8 });
        sparks.burst(ORB_UP, '#ffffff', Math.round(40 * n), 3.4, { gravity: 0.2, size: 0.6, life: 0.6 });
        if (big) sparks.rain(c, Math.round((60 + hype * 120) * n));
      }, [], T)
      .to(stage, { orb: 0, duration: 0.08 }, T)
      .set(o, { visible: false }, T + 0.1)
      .to(stage, { pillar: 1, rays: 1, power: 1, bloom: 1.2 + hype * 0.3, speed: 1, shake: 0.5 + hype * 0.4, chroma: 0.15 + hype * 0.2, zoom: 0, lift: 0, duration: 0.1, ease: 'power2.out' }, T)
      .to(stage, { bloom: 1, speed: 0, shake: 0, chroma: 0, duration: 1.1, ease: 'power2.out' }, T + 0.15);

    // 6. The cards erupt from the pack in a fan of sparks, the pack drops away, the stack forms.
    cards.forEach((c, i) => {
      const at = T + 0.05 + i * 0.05;
      tl.to(c.position, { y: inside.y + 1.9 + i * 0.002, duration: 0.45, ease: 'power3.out' }, at).fromTo(c.rotation, { z: (i - 2) * 0.3 }, { z: 0, duration: 0.6, ease: 'back.out(2)', immediateRender: false }, at);
    });
    for (let j = 0; j < 5; j++) tl.call(() => sparks.burst(inside.clone().add(new THREE.Vector3(0, 1.2 + j * 0.15, 0.1)), live(), Math.round(12 * n), 0.5, { gravity: 0.5 }), [], T + 0.08 + j * 0.06);
    tl.to(pack.position, { y: -3.6, duration: 0.7, ease: 'power2.in' }, T + 0.3)
      .to(pack.rotation, { x: 0.5, z: -0.3, duration: 0.7, ease: 'power2.in' }, T + 0.3)
      .to(packFx, { glow: 0, duration: 0.4 }, T + 0.4);
    cards.forEach((c, i) => {
      const at = T + 0.65;
      tl.to(c.position, { x: STACK.x + (i - 2) * 0.004, y: STACK.y - i * 0.006, z: STACK.z - i * 0.018, duration: 0.6, ease: 'power3.inOut' }, at)
        .to(c.rotation, { z: (i % 2 ? 1 : -1) * i * 0.012, duration: 0.6 }, at)
        .to(c.scale, { x: 1.12, y: 1.12, z: 1.12, duration: 0.6, ease: 'power3.inOut' }, at);
    });
    tl.to(cardFx[0]!, { glow: 0.35 + hypeOf(next[0]!) * 1.1, duration: 0.5 }, T + 1.1).to(stage, { pillar: 0.12, power: 0.45, rays: 0.2, spin: 0.3, zoom: 0, duration: 1, ease: 'power2.inOut' }, T + 1.1);
    if (fast) tl.timeScale(2.5);
    await run(tl);
    pack.visible = false;
    o.visible = false;
    m.top = 0;
    m.turned = false;
    m.busy = false;
    setPhase('reveal');
  }

  // ---------------------------------------------------------------- turning cards
  async function turn(i: number, quick = false) {
    const c = cardRefs.current[i];
    const p = m.pulls?.[i];
    if (!c || !p) return;
    for (let k = 0; k < 40 && !ready.current.has(i); k++) await frames(3);
    const s = RARITY_STYLE[p.card.rarity];
    const hype = hypeOf(p);
    const big = hype >= 0.55 && !quick;
    const legend = p.card.rarity === 'L' || p.is_shiny;
    const slow = p.card.rarity === 'L' || (p.is_shiny && hype >= 0.85);
    const fx = cardFx[i]!;
    const fast = reduced();
    const n = fast ? 0.3 : 1;
    const home = new THREE.Vector3().copy(c.position);
    const restScale = c.scale.x;
    const tl = gsap.timeline();

    tl.to(stage.tint, { ...rgb(s.color), duration: 0.3 }, 0).to(stage, { rainbow: legend ? 1 : 0, duration: 0.3 }, 0);
    if (big) {
      // Tension: the card comes forward, energy pours into it, the camera leans in, it trembles.
      tl.to(c.position, { x: FRONT.x, y: FRONT.y, z: FRONT.z, duration: 0.5, ease: 'power3.out' }, 0)
        .to(c.scale, { x: 1.02, y: 1.02, z: 1.02, duration: 0.5, ease: 'power3.out' }, 0)
        .to(fx, { glow: 1 + hype * 0.5, duration: 0.6 }, 0)
        .to(stage, { rays: 0.6 + hype * 0.3, power: 0.95, spin: 2, pillar: 0.35, zoom: 0.5, speed: 0.45, duration: 0.6 }, 0)
        .fromTo(stage, { wave: 0.05, waveAmp: 1 }, { wave: 1.1, waveAmp: 0, duration: 0.8, ease: 'power2.out', immediateRender: false }, 0.2)
        .call(() => {
          sfx.tension(0.5);
          particles.current?.converge(FRONT, s.color, Math.round(70 * n), 2.6, 0.75);
        }, [], 0.15)
        .to(c.rotation, { z: 0.05, duration: 0.06, yoyo: true, repeat: 5, ease: 'sine.inOut' }, 0.55)
        .to(c.rotation, { z: 0, duration: 0.05 }, 0.92);
    } else {
      tl.to(c.position, { z: home.z + 0.3, y: home.y + 0.08, duration: 0.15, ease: 'power2.out' }, 0);
    }
    const at = big ? 1.0 : 0.1;
    const flipDur = slow ? 1.4 : big ? 1.0 : quick ? 0.35 : 0.45;
    const mid = at + flipDur * (big ? 0.55 : 0.35);
    tl.to(c.rotation, { y: big ? -2 * Math.PI : 0, z: 0, duration: flipDur, ease: big ? 'power3.out' : 'back.out(1.5)' }, at)
      .call(
        () => {
          sfx.flip([p.card.rarity], 0, [p.is_shiny]);
          const pos = c.getWorldPosition(new THREE.Vector3());
          const sparks = particles.current!;
          const fxv = vfx.current!;
          sparks.burst(pos, s.color, Math.round((12 + hype * 130) * n), 0.8 + hype * 1.6);
          if (hype >= 0.15) fxv.ring(pos, s.color, { size: 2 + hype * 4, duration: 0.5 + hype * 0.4 });
          if (big) {
            fxv.ring(pos, '#ffffff', { size: 5 + hype * 4, duration: 1, width: 0.04 });
            fxv.flare(pos, s.color, { size: 2 + hype * 2, duration: 0.8 });
            sparks.burst(pos, '#ffffff', Math.round(30 * n), 3, { size: 0.6, gravity: 0.3, life: 0.7 });
            sparks.rain(legend ? live2() : s.color, Math.round((40 + hype * 140) * n));
            onFlash?.(0.15 + hype * 0.2);
          }
          if (!quick) onReveal?.(i, p);
        },
        [],
        mid,
      )
      .fromTo(stage, { wave: 0.05, waveAmp: 0.3 + hype }, { wave: 1.1, waveAmp: 0, duration: 0.8, ease: 'power2.out', immediateRender: false }, mid)
      .to(stage, { bloom: 1 + hype * 0.3, speed: big ? 1 : hype * 0.35, zoom: 0, shake: hype * 0.5, chroma: legend && !quick ? 0.25 : big ? 0.1 : 0, duration: 0.08 }, mid)
      .to(stage, { bloom: 1, speed: 0, shake: 0, chroma: 0, duration: 1.0, ease: 'power2.out' }, mid + 0.1)
      .fromTo(c.scale, { x: (big ? 1.02 : restScale) * 1.12, y: (big ? 1.02 : restScale) * 1.12, z: (big ? 1.02 : restScale) * 1.12 }, { x: big ? 1.02 : restScale, y: big ? 1.02 : restScale, z: big ? 1.02 : restScale, duration: 0.6, ease: 'elastic.out(1, 0.4)', immediateRender: false }, mid)
      .to(fx, { holo: legend ? 1 : hype > 0.5 ? 0.4 : 0, duration: 0.6 }, at);
    if (big) {
      // Back over the stack once admired.
      const back = at + flipDur + (slow ? 1.5 : 0.9);
      tl.to(c.position, { x: home.x, y: home.y, z: home.z + 0.05, duration: 0.5, ease: 'power3.inOut' }, back)
        .to(c.scale, { x: 1.12, y: 1.12, z: 1.12, duration: 0.5, ease: 'power3.inOut' }, back)
        .to(stage, { rays: 0.25, power: 0.5, spin: 0.35, pillar: 0.12, duration: 0.8 }, back);
    } else {
      tl.to(c.position, { z: home.z + 0.05, y: home.y, duration: 0.2 }, at + flipDur);
    }
    tl.to(fx, { glow: 0.15 + hype * 0.45, duration: 0.6 }, at + flipDur);
    tl.call(() => void (c.rotation.y = 0));
    if (slow && !quick) tl.timeScale(0.9);
    if (fast || quick) tl.timeScale(fast ? 3 : 1.6);
    await run(tl);
  }
  const live2 = () => `#${stage.live.getHexString()}`;

  /** Sends turned card `i` to the tray; the next card's back lights up. */
  async function toTray(i: number) {
    const c = cardRefs.current[i]!;
    const slot = traySlot(i);
    c.rotation.y = 0; // a skipped spin can stop at -2π: same face, but it would unwind later
    const tl = gsap.timeline();
    tl.call(() => sfx.deal(1), [], 0)
      .to(c.position, { x: slot.x, y: slot.y, z: slot.z, duration: 0.45, ease: 'power3.inOut' }, 0)
      .to(c.scale, { x: 0.4, y: 0.4, z: 0.4, duration: 0.45, ease: 'power3.inOut' }, 0)
      .to(c.rotation, { z: 0, duration: 0.45 }, 0)
      .to(cardFx[i]!, { glow: 0.2, duration: 0.4 }, 0);
    const n = i + 1;
    if (m.pulls && n < m.pulls.length) tl.to(cardFx[n]!, { glow: 0.35 + hypeOf(m.pulls[n]!) * 1.1, duration: 0.4 }, 0.15);
    if (reduced()) tl.timeScale(3);
    await run(tl);
  }

  /** All five, face up, in a row. */
  async function lineUp() {
    const cards = cardRefs.current.slice(0, m.pulls?.length ?? 0).filter(Boolean) as THREE.Group[];
    const tl = gsap.timeline();
    cards.forEach((c, i) => {
      const s = rowSlot(i);
      const h = m.pulls ? hypeOf(m.pulls[i]!) : 0;
      tl.to(c.position, { x: s.x, y: s.y, z: s.z, duration: 0.6, ease: 'back.out(1.3)' }, i * 0.06)
        .to(c.scale, { x: 1, y: 1, z: 1, duration: 0.6, ease: 'back.out(1.3)' }, i * 0.06)
        .to(c.rotation, { y: 0, z: 0, duration: 0.4 }, i * 0.06)
        .to(cardFx[i]!, { glow: 0.15 + h * 0.45, duration: 0.5 }, i * 0.06);
    });
    tl.to(stage.tint, { ...rgb(IDLE_TINT), duration: 0.8 }, 0).to(stage, { rainbow: 0, duration: 0.8 }, 0);
    if (reduced()) tl.timeScale(3);
    await run(tl);
  }

  async function next() {
    // During the rip: skip straight to the stack.
    if (m.phase === 'opening') return hurry();
    if (m.phase !== 'reveal' || !m.pulls) return;
    if (m.busy) {
      // Mid-animation: finish it now, then play this tap.
      m.queued = true;
      hurry();
      return;
    }
    m.busy = true;
    try {
      if (!m.turned) {
        await turn(m.top);
        m.turned = true;
        setPhase('reveal');
      } else {
        await toTray(m.top);
        m.top += 1;
        m.turned = false;
        if (m.top >= m.pulls.length) {
          await lineUp();
          setPhase('done');
          return;
        }
        setPhase('reveal');
      }
    } finally {
      m.busy = false;
    }
    if (m.queued) {
      m.queued = false;
      void next();
    }
  }

  useImperativeHandle(ref, () => ({
    autoTear() {
      if (m.phase !== 'idle' || !canOpen || m.busy) return;
      m.sway = 0.25;
      setPhase('tearing');
      commit();
      const tear = gsap.to(packFx, {
        tear: 1,
        duration: reduced() ? 0.2 : 0.9,
        ease: 'power1.inOut',
        onUpdate: () => {
          peel();
          if (packFx.tear - m.lastCrinkle > 0.05) {
            m.lastCrinkle = packFx.tear;
            sfx.crinkle(0.6);
            particles.current?.burst(tipWorld(), '#ffffff', 3, 0.35);
          }
        },
        onComplete: () => void finish(),
      });
      whenHidden(tear, () => void finish());
    },
    next: () => void next(),
    async skip() {
      if (m.phase !== 'reveal' || !m.pulls) return;
      // Mid-animation: finish the current move first, then skip (as taps do).
      if (m.busy) {
        m.queued = false;
        hurry();
        for (let k = 0; k < 60 && m.busy; k++) await frames(1);
        if (m.busy || m.phase !== 'reveal') return;
      }
      m.busy = true;
      try {
        const rest = m.pulls.map((_, i) => i).filter((i) => i > m.top || (i === m.top && !m.turned));
        // The rarest of the rest still gets its moment; the others turn quickly.
        const star = rest.reduce<number | null>((a, i) => (a === null || hypeOf(m.pulls![i]!) > hypeOf(m.pulls![a]!) ? i : a), null);
        await Promise.all(rest.map((i, k) => frames(k * 6).then(() => turn(i, i !== star))));
        m.top = m.pulls.length;
        await lineUp();
        setPhase('done');
      } finally {
        m.busy = false;
        m.queued = false;
      }
    },
    async reset() {
      if (m.busy) return;
      m.busy = true;
      const pack = packRoot.current!;
      const s = strip.current!;
      const cards = cardRefs.current.filter(Boolean) as THREE.Group[];
      const tl = gsap.timeline();
      cards.forEach((c, i) => {
        tl.to(c.position, { y: 5, duration: 0.5, ease: 'power3.in' }, i * 0.05).to(c.scale, { x: 0.6, y: 0.6, z: 0.6, duration: 0.5 }, i * 0.05);
      });
      tl.call(() => {
        cards.forEach((c) => (c.visible = false));
        setPulls(null);
        m.pulls = null;
        m.pending = null;
        m.finishing = false;
        m.lastCrinkle = 0;
        packFx.tear = 0;
        packFx.glow = 0;
        s.visible = true;
        s.position.set(PACK_W / 2, SEAM_Y, 0);
        s.rotation.set(0, 0, 0);
        pack.visible = true;
        pack.position.set(PACK_HOME.x, 4.2, PACK_HOME.z);
        pack.rotation.set(0, 0, 0);
      });
      tl.to(pack.position, { y: PACK_HOME.y, duration: 0.8, ease: 'bounce.out' })
        .to(stage, { spin: 0.12, power: 0.3, rays: 0.15, pillar: 0, rainbow: 0, duration: 0.6 }, '<')
        .to(stage.tint, { ...rgb(IDLE_TINT), duration: 0.6 }, '<');
      if (reduced()) tl.timeScale(3);
      await run(tl);
      m.sway = 1;
      m.busy = false;
      setPhase('idle');
    },
  }));

  return (
    <>
      {/* Invisible plane catching the pointer at the pack's depth (tear drags, taps). */}
      <mesh position={[0, 0, 0]} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onClick={onTap}>
        <planeGeometry args={[40, 30]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
      <group ref={orb} visible={false}>
        <Orb fx={stage} />
      </group>
      <group ref={packRoot} position={PACK_HOME.toArray()}>
        <group ref={packSway}>
          <PackMesh fx={packFx} strip={(g) => (strip.current = g)} />
        </group>
      </group>
      {pulls?.map((p, i) => (
        <CardMesh
          key={`${p.user_card_id}-${i}`}
          ref={(g) => {
            cardRefs.current[i] = g;
          }}
          card={p.card}
          shiny={p.is_shiny}
          fx={cardFx[i]}
          visible={false}
          onReady={() => ready.current.add(i)}
        />
      ))}
      <Particles ref={particles} />
      <Impacts ref={vfx} />
      <SpeedLines fx={stage} />
    </>
  );
});


