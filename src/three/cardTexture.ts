import * as THREE from 'three';
import { imageSources } from '../lib/images';
import { findWikiImage } from '../lib/wikiImages';
import { ATK_PATH, DEF_PATH, hasArt, LAYOUT, subtitle, TIERS } from '../lib/cardSpec';
import { circle, globe, goldGradient, starPolygon, textRing } from './ornament';
import type { Card } from '../lib/types';

// Card faces drawn on a canvas, from lib/cardSpec.ts: wiki-masters' layout with more shine, 5:7.
// Shown as flat pictures in the interface (native/CardFace.tsx) and on the 3D cards of the pack
// opening (CardMesh.tsx).

const TEX_W = 640;
const TEX_H = 896;

let fontsReady: Promise<unknown> | null = null;
export function loadFonts() {
  fontsReady ??= Promise.all([
    document.fonts.load('600 44px "Crimson Pro"'),
    document.fonts.load('italic 30px "Crimson Pro"'),
    document.fonts.load('600 22px "Source Sans 3"'),
    document.fonts.load('700 40px "Rubik"'),
    document.fonts.load('800 40px "Rubik"'),
  ]).catch(() => {});
  return fontsReady;
}

const images = new Map<string, Promise<HTMLImageElement | null>>();
/** Loads an image with CORS (Wikimedia sends ACAO *), or null after a failure / timeout. */
function loadImage(url: string, timeoutMs = 2500): Promise<HTMLImageElement | null> {
  let p = images.get(url);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      const t = setTimeout(() => resolve(null), timeoutMs);
      img.onload = () => (clearTimeout(t), resolve(img));
      img.onerror = () => {
        clearTimeout(t);
        images.delete(url);
        resolve(null);
      };
      img.src = url;
    });
    images.set(url, p);
  }
  return p;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Word-wraps `text` to at most `lines` lines of `maxW`, ellipsizing the last one. */
function wrap(g: CanvasRenderingContext2D, text: string, maxW: number, lines: number): string[] {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (g.measureText(next).width <= maxW) cur = next;
    else {
      if (cur) out.push(cur);
      cur = w;
    }
  }
  if (cur) out.push(cur);
  if (out.length > lines) {
    const kept = out.slice(0, lines);
    let last = kept[lines - 1]!;
    while (g.measureText(last + '…').width > maxW && last.length > 1) last = last.slice(0, -1);
    kept[lines - 1] = last + '…';
    return kept;
  }
  return out;
}

/** Draws `img` covering the box (like background-size: cover). */
function cover(g: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const sw = w / s;
  const sh = h / s;
  g.drawImage(img, (img.naturalWidth - sw) / 2, Math.max(0, (img.naturalHeight - sh) / 3), sw, sh, x, y, w, h);
}

/** Fills a path from a 24×24 SVG path string, at (x, y) with size s. */
function glyph(g: CanvasRenderingContext2D, d: string, x: number, y: number, s: number) {
  g.save();
  g.translate(x, y);
  g.scale(s / 24, s / 24);
  g.fill(new Path2D(d));
  g.restore();
}

export type CardFront = { face: HTMLCanvasElement; mask: HTMLCanvasElement };

/** Soft white wave ribbons over the tint, rotated like the DOM card's pattern. */
function waves(g: CanvasRenderingContext2D, alpha: number) {
  g.save();
  g.translate(TEX_W / 2, TEX_H / 2);
  g.rotate((-24 * Math.PI) / 180);
  g.strokeStyle = `rgba(255,255,255,${alpha})`;
  g.lineWidth = 14;
  g.lineCap = 'round';
  const step = 64;
  for (let y = -TEX_H; y <= TEX_H; y += step) {
    g.beginPath();
    for (let x = -TEX_W * 1.2; x <= TEX_W * 1.2; x += 8) {
      const yy = y + Math.sin((x / 180) * Math.PI * 2) * 16;
      if (x === -TEX_W * 1.2) g.moveTo(x, yy);
      else g.lineTo(x, yy);
    }
    g.stroke();
  }
  g.restore();
}

/** Our emblem (puzzle globe) for cards without an image. */
function emblem(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  g.save();
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = r * 0.12;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = r * 0.09;
  g.beginPath();
  g.ellipse(cx, cy, r * 0.44, r, 0, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  for (const k of [-0.5, 0, 0.5]) {
    const w = Math.sqrt(1 - k * k) * r;
    g.moveTo(cx - w, cy + k * r);
    g.lineTo(cx + w, cy + k * r);
  }
  g.moveTo(cx, cy - r);
  g.lineTo(cx, cy + r);
  g.stroke();
  g.restore();
}

/**
 * Draws the front of a card from the shared spec (lib/cardSpec.ts), plus a foil mask for the 3D
 * shader: red = where foil may shine (the tinted body and the art band), black = never (title,
 * description, stats, badge).
 */
// Faces drawn recently, reused when the same card mounts again (walls of cards remount on scroll).
const faces = new Map<string, Promise<CardFront>>();
export function drawCardFront(card: Card, opts: { shiny?: boolean; hideImage?: boolean; scale?: number } = {}): Promise<CardFront> {
  const key = `${card.id}|${card.rarity}|${opts.shiny ? 1 : 0}|${opts.hideImage ? 1 : 0}|${opts.scale ?? 1}`;
  let p = faces.get(key);
  if (p) {
    faces.delete(key);
    faces.set(key, p); // most recent last
    return p;
  }
  p = paintCardFront(card, opts);
  faces.set(key, p);
  // Room for a dense wall of small faces plus the large ones.
  if (faces.size > 360) faces.delete(faces.keys().next().value!);
  return p;
}

async function paintCardFront(card: Card, opts: { shiny?: boolean; hideImage?: boolean; scale?: number }): Promise<CardFront> {
  await loadFonts();
  const t = TIERS[card.rarity];
  let img: HTMLImageElement | null = null;
  if (!opts.hideImage && hasArt(card)) for (const src of imageSources(card.image_url)) if ((img = await loadImage(src))) break;
  // No picture of its own: one from Wikimedia when the player allows it (a few seconds at most).
  if (!img && !opts.hideImage && !card.image_url && !card.sensitive) {
    const url = await Promise.race([findWikiImage(card), new Promise<null>((r) => setTimeout(() => r(null), 3500))]);
    if (url) img = await loadImage(url);
  }

  const W = TEX_W;
  const H = TEX_H;
  const R = LAYOUT.radius * W;
  const pad = 0.07 * W;
  const artH = LAYOUT.art.h * H;

  // scale < 1: a lighter texture for walls of cards (same drawing, smaller canvas).
  const k = opts.scale ?? 1;
  const face = document.createElement('canvas');
  face.width = Math.round(W * k);
  face.height = Math.round(H * k);
  const g = face.getContext('2d')!;
  g.scale(k, k);
  const mask = document.createElement('canvas');
  mask.width = 256;
  mask.height = 358;
  const m = mask.getContext('2d')!;
  m.scale(256 / W, 358 / H);

  roundRect(g, 0, 0, W, H, R);
  g.save();
  g.clip();

  // Body: pale top → tint → saturated bottom, with a glow from below.
  const body = g.createLinearGradient(0, 0, 0, H);
  body.addColorStop(0, t.light);
  body.addColorStop(0.55, t.color);
  body.addColorStop(1, t.mid);
  g.fillStyle = body;
  g.fillRect(0, 0, W, H);
  const under = g.createRadialGradient(W / 2, H, 10, W / 2, H, H * 0.6);
  under.addColorStop(0, t.mid);
  under.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = under;
  g.fillRect(0, 0, W, H);
  waves(g, 0.22);

  if (opts.shiny) {
    // Brillante: rainbow stripes over the body.
    g.save();
    g.globalCompositeOperation = 'overlay';
    g.globalAlpha = 0.55;
    const colors = ['#ff6ed8', '#50dcff', '#ffeb5a', '#78ffaa'];
    g.translate(W / 2, H / 2);
    g.rotate((35 * Math.PI) / 180);
    for (let x = -H, k = 0; x < H; x += 38, k++) {
      g.fillStyle = colors[k % colors.length]!;
      g.fillRect(x, -H, 38, H * 2);
    }
    g.restore();
  }

  // Art band.
  if (img) {
    cover(g, img, 0, 0, W, artH);
    const shade = g.createLinearGradient(0, 0, 0, artH);
    shade.addColorStop(0, 'rgba(0,0,0,0.18)');
    shade.addColorStop(0.4, 'rgba(0,0,0,0)');
    shade.addColorStop(0.7, 'rgba(0,0,0,0)');
    shade.addColorStop(1, `${t.color}73`);
    g.fillStyle = shade;
    g.fillRect(0, 0, W, artH);
  } else {
    emblem(g, W / 2, artH * 0.55, W * 0.2, `${t.deep}bf`);
  }

  // Title + description.
  const textY = LAYOUT.text.y * H;
  g.fillStyle = '#15171b';
  g.textBaseline = 'top';
  g.font = '700 60px Rubik, "Source Sans 3", sans-serif';
  const title = wrap(g, card.title, W - pad * 2, 2);
  title.forEach((line, i) => g.fillText(line, pad, textY + i * 68));
  g.font = '500 42px "Source Sans 3", sans-serif';
  g.fillStyle = 'rgba(21,23,27,0.66)';
  const descY = textY + title.length * 68 + 12;
  const desc = wrap(g, subtitle(card), W - pad * 2, title.length > 1 ? 2 : 3);
  desc.forEach((line, i) => g.fillText(line, pad, descY + i * 50));

  // Stats.
  const statsY = LAYOUT.stats.y * H;
  g.fillStyle = 'rgba(21,23,27,0.14)';
  g.fillRect(pad, statsY, W - pad * 2, 3);
  const midY = statsY + (H - statsY) / 2 - 6;
  g.font = '700 50px Rubik, "Source Sans 3", sans-serif';
  g.textBaseline = 'middle';
  g.fillStyle = '#e5383b';
  glyph(g, ATK_PATH, pad, midY - 24, 48);
  g.fillStyle = '#15171b';
  g.fillText(String(card.atk), pad + 60, midY);
  const defText = String(card.def);
  const dw = g.measureText(defText).width;
  g.fillText(defText, W - pad - dw, midY);
  g.fillStyle = '#3a6fd8';
  glyph(g, DEF_PATH, W - pad - dw - 60, midY - 24, 48);
  g.restore();

  // Gilded edge (UR, L).
  if (t.gilded) {
    const gold = g.createLinearGradient(0, 0, W, H);
    (card.rarity === 'L' ? ['#fffbe0', '#ffd23f', '#ff9a3c', '#fff6b8', '#ffb347', '#fff2a0'] : ['#fff7c2', '#e3a83a', '#fff2b0', '#b8741a', '#ffe9a0', '#c98a22']).forEach((c, i, a) => gold.addColorStop(i / (a.length - 1), c));
    roundRect(g, 6, 6, W - 12, H - 12, R - 6);
    g.lineWidth = 12;
    g.strokeStyle = gold;
    g.stroke();
  } else {
    roundRect(g, 3, 3, W - 6, H - 6, R - 3);
    g.lineWidth = 4;
    g.strokeStyle = 'rgba(255,255,255,0.4)';
    g.stroke();
  }

  // Badge.
  g.font = '800 46px Rubik, sans-serif';
  g.textBaseline = 'middle';
  const label = card.rarity + (opts.shiny ? ' ✦' : '');
  const bw = g.measureText(label).width + 48;
  const bx = 32;
  const by = 32;
  const bh = 64;
  const badge = g.createLinearGradient(0, by, 0, by + bh);
  badge.addColorStop(0, '#ffffff');
  badge.addColorStop(0.15, t.color);
  badge.addColorStop(1, card.rarity === 'L' ? t.accent : t.color);
  roundRect(g, bx, by, bw, bh, 20);
  g.fillStyle = badge;
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(255,255,255,0.6)';
  g.stroke();
  g.fillStyle = '#0d1117';
  g.fillText(label, bx + 24, by + bh / 2 + 2);

  // Foil mask: body and art may shine; never the text, stats or badge.
  m.fillStyle = '#f00';
  roundRect(m, 0, 0, W, H, R);
  m.fill();
  m.fillStyle = '#000';
  m.fillRect(pad - 10, textY - 10, W - pad * 2 + 20, H - textY + 10);
  m.fillRect(bx - 6, by - 6, bw + 12, bh + 12);
  return { face, mask };
}

let backCanvas: HTMLCanvasElement | null = null;
/** The shared back of every card: night navy with gold filigree and the globe emblem. */
export async function drawCardBack(): Promise<HTMLCanvasElement> {
  if (backCanvas) return backCanvas;
  await loadFonts();
  const c = document.createElement('canvas');
  c.width = TEX_W;
  c.height = TEX_H;
  const g = c.getContext('2d')!;
  const cx = TEX_W / 2;
  const cy = TEX_H * 0.46;
  const gold = goldGradient(g, 0, 0, TEX_W, TEX_H);
  roundRect(g, 0, 0, TEX_W, TEX_H, 44);
  const bg = g.createRadialGradient(cx, cy, 40, cx, cy, TEX_H * 0.75);
  bg.addColorStop(0, '#1d3a8a');
  bg.addColorStop(0.45, '#0d1c4a');
  bg.addColorStop(1, '#050a1f');
  g.fillStyle = bg;
  g.fill();
  g.save();
  g.clip();
  // Diamond lattice, faint.
  g.strokeStyle = 'rgba(232,194,106,0.12)';
  g.lineWidth = 1.5;
  for (let k = -TEX_H; k < TEX_W + TEX_H; k += 36) {
    g.beginPath();
    g.moveTo(k, 0);
    g.lineTo(k - TEX_H, TEX_H);
    g.moveTo(k - TEX_H, 0);
    g.lineTo(k, TEX_H);
    g.stroke();
  }
  // Rays behind the emblem.
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const ray = g.createLinearGradient(cx, cy, cx + Math.cos(a) * 420, cy + Math.sin(a) * 420);
    ray.addColorStop(0, 'rgba(255,236,170,0.22)');
    ray.addColorStop(1, 'rgba(255,236,170,0)');
    g.fillStyle = ray;
    g.beginPath();
    g.moveTo(cx, cy);
    g.arc(cx, cy, 420, a - 0.05, a + 0.05);
    g.fill();
  }
  g.restore();

  g.strokeStyle = gold;
  g.fillStyle = gold;
  // Double frame with corner ornaments.
  g.lineWidth = 6;
  roundRect(g, 22, 22, TEX_W - 44, TEX_H - 44, 30);
  g.stroke();
  g.lineWidth = 2;
  roundRect(g, 38, 38, TEX_W - 76, TEX_H - 76, 22);
  g.stroke();
  for (const [x, y] of [[38, 38], [TEX_W - 38, 38], [38, TEX_H - 38], [TEX_W - 38, TEX_H - 38]] as const) {
    g.beginPath();
    g.moveTo(x, y - 18);
    g.lineTo(x + 18, y);
    g.lineTo(x, y + 18);
    g.lineTo(x - 18, y);
    g.closePath();
    g.fill();
  }
  // Emblem: globe in a ring of text, a star above and below.
  g.lineWidth = 3;
  circle(g, cx, cy, 196);
  g.lineWidth = 1.5;
  circle(g, cx, cy, 160);
  textRing(g, 'WIKIMASTERS ENHANCED · ', cx, cy, 178, '600 26px "Crimson Pro", Georgia, serif', gold);
  g.lineWidth = 1.5;
  starPolygon(g, cx, cy, 160, 8, 3);
  g.save();
  g.fillStyle = '#0b1736';
  g.beginPath();
  g.arc(cx, cy, 110, 0, Math.PI * 2);
  g.fill();
  g.restore();
  g.lineWidth = 3;
  globe(g, cx, cy, 104);
  for (const y of [cy - 250, cy + 250]) {
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 ? 7 : 24;
      g.lineTo(cx + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
  }
  g.font = 'italic 600 64px "Crimson Pro", Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('Wikimasters', cx, TEX_H - 130);
  g.font = '600 22px "Source Sans 3", sans-serif';
  g.letterSpacing = '8px';
  g.fillText('ENHANCED', cx, TEX_H - 84);
  g.letterSpacing = '0px';
  backCanvas = c;
  return c;
}

export function toTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
