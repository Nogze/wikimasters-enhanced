import type { Rarity } from './types';

// Candy-style sound effects for pack opening, synthesized with the Web Audio API (no audio files):
// filtered noise for crinkles, rips and swishes, pitched sine/triangle "bloops" for pops and chimes.
// Each rarity gets a richer reveal, up to a glittery fanfare for Legendary. Off in hidden tabs, and
// can be muted (remembered per browser).

const KEY = 'wme-sfx';
let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let noise: AudioBuffer | null = null;

export function sfxEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}
export function setSfxEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* private mode: stays on for this page */
  }
}

/** Audio graph, created lazily (browsers only allow sound after a user gesture). */
function audio(): { ac: AudioContext; dest: GainNode; t: number } | null {
  if (!sfxEnabled() || document.hidden || typeof AudioContext === 'undefined') return null;
  if (!ctx) {
    ctx = new AudioContext();
    out = ctx.createGain();
    out.gain.value = 0.45;
    // A gentle compressor keeps stacked chimes from clipping.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    out.connect(comp).connect(ctx.destination);
    noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return { ac: ctx, dest: out!, t: ctx.currentTime + 0.01 };
}

type Env = { at: number; dur: number; gain: number; attack?: number };

function envelope(ac: AudioContext, { at, dur, gain, attack = 0.005 }: Env) {
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  return g;
}

/** Pitched blip; `to` glides the pitch (upward glides sound "bubbly"). */
function tone(a: NonNullable<ReturnType<typeof audio>>, freq: number, opts: Env & { to?: number; type?: OscillatorType }) {
  const { ac, dest } = a;
  const o = ac.createOscillator();
  o.type = opts.type ?? 'sine';
  o.frequency.setValueAtTime(freq, opts.at);
  if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, opts.at + opts.dur * 0.6);
  o.connect(envelope(ac, opts)).connect(dest);
  o.start(opts.at);
  o.stop(opts.at + opts.dur + 0.05);
}

/** Band-passed noise sweeping from `from` to `to` Hz: crinkles, rips, swishes. */
function hiss(a: NonNullable<ReturnType<typeof audio>>, from: number, to: number, opts: Env & { q?: number }) {
  const { ac, dest } = a;
  const src = ac.createBufferSource();
  src.buffer = noise;
  const f = ac.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = opts.q ?? 1.2;
  f.frequency.setValueAtTime(from, opts.at);
  f.frequency.exponentialRampToValueAtTime(to, opts.at + opts.dur);
  src.connect(f).connect(envelope(ac, opts)).connect(dest);
  src.start(opts.at, Math.random() * 0.5);
  src.stop(opts.at + opts.dur + 0.05);
}

/** A few random high twinkles over `span` seconds. */
function glitter(a: NonNullable<ReturnType<typeof audio>>, at: number, count: number, span: number, gain = 0.08) {
  const notes = [1568, 1760, 2093, 2349, 2637, 3136];
  for (let i = 0; i < count; i++) {
    const t = at + (span * i) / count + Math.random() * 0.04;
    tone(a, notes[Math.floor(Math.random() * notes.length)], { at: t, dur: 0.22, gain, type: 'sine' });
  }
}

// Reveal chimes: note sets (Hz) climbing in richness with rarity.
const CHIMES: Record<Rarity, number[]> = {
  C: [784],
  PC: [784, 988],
  R: [659, 831, 988],
  SR: [659, 831, 988, 1319],
  UR: [523, 659, 784, 1047, 1319],
  L: [523, 659, 784, 1047, 1319, 1568],
};

function chime(a: NonNullable<ReturnType<typeof audio>>, r: Rarity, at: number) {
  const notes = CHIMES[r];
  const rare = r === 'SR' || r === 'UR' || r === 'L';
  const step = r === 'L' ? 0.07 : 0.055;
  notes.forEach((n, i) => {
    tone(a, n, { at: at + i * step, dur: rare ? 0.5 : 0.28, gain: 0.16, type: 'triangle', to: n * 1.02 });
    tone(a, n * 2, { at: at + i * step, dur: 0.18, gain: 0.04 }); // sparkle overtone
  });
  if (r === 'UR' || r === 'L') {
    // Low "boom" under the arpeggio, then glitter.
    tone(a, 150, { at, dur: 0.5, gain: 0.3, to: 55 });
    glitter(a, at + notes.length * step, r === 'L' ? 14 : 7, r === 'L' ? 1.1 : 0.6);
  }
  if (r === 'L') {
    // Held major chord to finish the fanfare.
    for (const n of [523, 659, 784, 1047]) tone(a, n, { at: at + 0.45, dur: 1.4, gain: 0.07, attack: 0.08, type: 'triangle' });
  }
}

/** Shiny: a bright rising run up to a high shimmer, after the Legendary fanfare. */
function shinyJingle(a: NonNullable<ReturnType<typeof audio>>, at: number) {
  [1319, 1568, 1976, 2637, 3136].forEach((n, i) => tone(a, n, { at: at + i * 0.06, dur: 0.35, gain: 0.1, type: 'triangle', to: n * 1.01 }));
  tone(a, 3951, { at: at + 0.32, dur: 1.2, gain: 0.05, attack: 0.02 });
  glitter(a, at + 0.3, 18, 1.4, 0.07);
}

export const sfx = {
  /** Arcade riser while the pack charges: a square wave climbing over `dur` seconds, with a tremolo. */
  charge(dur = 0.9) {
    const a = audio();
    if (!a) return;
    tone(a, 110, { at: a.t, dur, gain: 0.07, to: 880, type: 'square', attack: 0.05 });
    tone(a, 220, { at: a.t, dur, gain: 0.05, to: 1760, type: 'sawtooth', attack: 0.1 });
    for (let i = 0; i < 8; i++) hiss(a, 2000 + i * 300, 4200, { at: a.t + (dur * i) / 8, dur: 0.05, gain: 0.08, q: 0.8 });
  },
  /** Coin blip (two square notes), when a pack is spent. */
  coin() {
    const a = audio();
    if (!a) return;
    tone(a, 988, { at: a.t, dur: 0.07, gain: 0.12, type: 'square' });
    tone(a, 1319, { at: a.t + 0.07, dur: 0.22, gain: 0.12, type: 'square' });
  },
  /** Tension wobble before a rare card turns (SR and up). */
  tension(dur = 0.5) {
    const a = audio();
    if (!a) return;
    for (let i = 0; i < 6; i++) tone(a, 330 + i * 40, { at: a.t + (dur * i) / 6, dur: 0.06, gain: 0.08, type: 'square' });
  },
  /** Pack shakes (crinkles), then rips and pops open (~0.6 s, matches tearPack). */
  tear() {
    const a = audio();
    if (!a) return;
    [0, 0.11, 0.22, 0.33].forEach((d, i) => hiss(a, 3500 + i * 400, 5000, { at: a.t + d, dur: 0.07, gain: 0.18, q: 0.8 }));
    hiss(a, 700, 6000, { at: a.t + 0.42, dur: 0.34, gain: 0.35, q: 0.7 }); // rip along the perforation
    hiss(a, 2600, 900, { at: a.t + 0.74, dur: 0.22, gain: 0.14, q: 0.9 }); // cards sliding out
    tone(a, 220, { at: a.t + 0.8, dur: 0.18, gain: 0.35, to: 660 }); // bubbly pop
    tone(a, 440, { at: a.t + 0.82, dur: 0.12, gain: 0.12, to: 1320 });
  },
  /** One soft whoosh + plip per card, pitched up card after card (stagger matches dealCards). */
  deal(n: number, stagger = 0.09) {
    const a = audio();
    if (!a) return;
    for (let i = 0; i < n; i++) {
      const at = a.t + i * stagger;
      hiss(a, 2400, 700, { at, dur: 0.14, gain: 0.12, q: 0.9 });
      tone(a, 880 * Math.pow(2, i / 12), { at: at + 0.09, dur: 0.07, gain: 0.1, to: 1320 * Math.pow(2, i / 12) });
    }
  },
  /** UI tap: a short soft blip. */
  click() {
    const a = audio();
    if (!a) return;
    tone(a, 1320, { at: a.t, dur: 0.06, gain: 0.06, to: 1760, type: 'triangle' });
  },
  /** One crinkle of foil while the tear is dragged (call every few px; `amount` 0–1 = speed). */
  crinkle(amount = 0.5) {
    const a = audio();
    if (!a) return;
    hiss(a, 2500 + Math.random() * 2500, 5500, { at: a.t, dur: 0.04 + amount * 0.05, gain: 0.05 + amount * 0.12, q: 0.9 });
  },
  /** The strip ripping off: a sharp tear, a pop, then light pouring out. */
  rip() {
    const a = audio();
    if (!a) return;
    hiss(a, 900, 7000, { at: a.t, dur: 0.22, gain: 0.4, q: 0.7 });
    tone(a, 240, { at: a.t + 0.12, dur: 0.16, gain: 0.3, to: 720 });
    hiss(a, 3000, 800, { at: a.t + 0.2, dur: 0.35, gain: 0.1, q: 0.8 });
  },
  /** Soft rising hum while the circle spins up. */
  hum(dur = 0.9) {
    const a = audio();
    if (!a) return;
    tone(a, 220, { at: a.t, dur, gain: 0.08, to: 440, type: 'triangle', attack: 0.2 });
    tone(a, 330, { at: a.t, dur, gain: 0.05, to: 660, attack: 0.3 });
    hiss(a, 600, 3000, { at: a.t, dur, gain: 0.06, q: 0.6, attack: 0.3 });
  },
  /** One rung of the colour tease: a bell, higher at each step (0 = first). */
  step(k: number) {
    const a = audio();
    if (!a) return;
    const base = [523, 659, 784, 1047][Math.min(k, 3)]!;
    tone(a, base, { at: a.t, dur: 0.6, gain: 0.15, type: 'triangle' });
    tone(a, base * 2, { at: a.t, dur: 0.35, gain: 0.05 });
    tone(a, base * 1.5, { at: a.t + 0.05, dur: 0.5, gain: 0.06, type: 'triangle' });
    if (k >= 2) glitter(a, a.t + 0.1, 4 + k * 2, 0.4, 0.05);
  },
  /** The pillar of light: a deep boom under a bright whoosh. */
  summon(power = 0.5) {
    const a = audio();
    if (!a) return;
    tone(a, 140, { at: a.t, dur: 0.7, gain: 0.3, to: 45 });
    hiss(a, 500, 7000, { at: a.t, dur: 0.6, gain: 0.25, q: 0.6 });
    glitter(a, a.t + 0.2, 6 + Math.round(power * 10), 0.8, 0.06);
  },
  /** Swish of each card turning over, then its rarity chime (stagger matches flipCards). */
  flip(rarities: Rarity[], stagger = 0.11, shinies: boolean[] = []) {
    const a = audio();
    if (!a) return;
    rarities.forEach((r, i) => {
      const at = a.t + i * stagger;
      hiss(a, 1200, 3800, { at, dur: 0.12, gain: 0.14, q: 1.1 });
      chime(a, r, at + 0.18);
      if (shinies[i]) shinyJingle(a, at + 1.1);
    });
  },
};
