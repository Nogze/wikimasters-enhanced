import { loadFonts } from './cardTexture';
import { circle, globe, goldGradient, starPolygon, textRing } from './ornament';

// The booster's printed foil: front and back art, plus a foil mask (white = metallic ink) that the
// pack shader uses for its sheen. Zigzag crimp edges are cut in the alpha channel.

const PACK_TEX_W = 640;
const PACK_TEX_H = 1050;
/** Crimped ends, as fractions of the height. */
export const CRIMP_TOP = 0.07;
export const CRIMP_BOTTOM = 0.06;
/** The perforation (tear line), as a v coordinate (0 = bottom, 1 = top). */
export const TEAR_V = 0.86;

const W = PACK_TEX_W;
const H = PACK_TEX_H;
const tearY = H * (1 - TEAR_V);

function canvas() {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  return c;
}

/** Zigzag cut along the outer edge of both crimps (alpha), so the ends read as heat-sealed foil. */
function cutZigzag(g: CanvasRenderingContext2D) {
  g.save();
  g.globalCompositeOperation = 'destination-out';
  const tooth = 16;
  const depth = 9;
  g.beginPath();
  for (let x = 0; x <= W; x += tooth) {
    g.moveTo(x, 0);
    g.lineTo(x + tooth / 2, depth);
    g.lineTo(x + tooth, 0);
  }
  for (let x = 0; x <= W; x += tooth) {
    g.moveTo(x, H);
    g.lineTo(x + tooth / 2, H - depth);
    g.lineTo(x + tooth, H);
  }
  g.fill();
  g.restore();
}

/** Silver crimp strips with vertical ridges. `foil` draws them white (mask). */
function crimps(g: CanvasRenderingContext2D, foil: boolean) {
  for (const [y0, h] of [
    [0, H * CRIMP_TOP],
    [H * (1 - CRIMP_BOTTOM), H * CRIMP_BOTTOM],
  ] as const) {
    if (foil) {
      g.fillStyle = '#fff';
      g.fillRect(0, y0, W, h);
      continue;
    }
    const gr = g.createLinearGradient(0, y0, 0, y0 + h);
    gr.addColorStop(0, '#8d96a8');
    gr.addColorStop(0.5, '#e9eef6');
    gr.addColorStop(1, '#7c8597');
    g.fillStyle = gr;
    g.fillRect(0, y0, W, h);
    g.fillStyle = 'rgba(40,48,66,0.35)';
    for (let x = 4; x < W; x += 8) g.fillRect(x, y0, 2, h);
  }
}

function background(g: CanvasRenderingContext2D) {
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0a1440');
  bg.addColorStop(0.45, '#1b3a96');
  bg.addColorStop(1, '#070d2e');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(W / 2, H * 0.42, 20, W / 2, H * 0.42, W * 0.75);
  glow.addColorStop(0, 'rgba(140,190,255,0.55)');
  glow.addColorStop(1, 'rgba(140,190,255,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, W, H);
  // Diamond lattice.
  g.strokeStyle = 'rgba(232,194,106,0.1)';
  g.lineWidth = 1.5;
  for (let k = -H; k < W + H; k += 40) {
    g.beginPath();
    g.moveTo(k, 0);
    g.lineTo(k - H, H);
    g.moveTo(k - H, 0);
    g.lineTo(k, H);
    g.stroke();
  }
}

function sunburst(g: CanvasRenderingContext2D, cx: number, cy: number, fill: string) {
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    g.fillStyle = fill;
    g.beginPath();
    g.moveTo(cx, cy);
    g.arc(cx, cy, 560, a - 0.035, a + 0.035);
    g.fill();
  }
}

function perforation(g: CanvasRenderingContext2D, color: string) {
  g.save();
  g.strokeStyle = color;
  g.lineWidth = 3;
  g.setLineDash([12, 9]);
  g.beginPath();
  g.moveTo(10, tearY);
  g.lineTo(W - 10, tearY);
  g.stroke();
  g.restore();
}

/** Front art and its foil mask. */
export async function drawPackFront(): Promise<{ face: HTMLCanvasElement; mask: HTMLCanvasElement }> {
  await loadFonts();
  await document.fonts.load('italic 900 30px "Rubik"').catch(() => {});
  const face = canvas();
  const mask = canvas();
  const g = face.getContext('2d')!;
  const m = mask.getContext('2d')!;
  m.fillStyle = '#000';
  m.fillRect(0, 0, W, H);
  const cx = W / 2;
  const cy = H * 0.42;
  const gold = goldGradient(g, 0, H * 0.2, W, H * 0.8);

  background(g);
  sunburst(g, cx, cy, 'rgba(255,230,160,0.08)');
  sunburst(m, cx, cy, 'rgba(255,255,255,0.35)');

  // Emblem, gold foil.
  for (const [ctx, ink] of [
    [g, gold],
    [m, '#fff'],
  ] as const) {
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineWidth = 5;
    circle(ctx, cx, cy, 196);
    ctx.lineWidth = 2;
    circle(ctx, cx, cy, 158);
    textRing(ctx, 'WIKIMASTERS · BOOSTER · ', cx, cy, 177, '700 25px "Crimson Pro", Georgia, serif', ink);
    ctx.lineWidth = 2;
    starPolygon(ctx, cx, cy, 158, 8, 3);
  }
  g.fillStyle = '#0b1736';
  g.beginPath();
  g.arc(cx, cy, 116, 0, Math.PI * 2);
  g.fill();
  for (const [ctx, ink] of [
    [g, gold],
    [m, '#fff'],
  ] as const) {
    ctx.strokeStyle = ink;
    ctx.lineWidth = 4;
    globe(ctx, cx, cy, 108);
  }

  // Title block.
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  m.textAlign = 'center';
  m.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,0,0,0.55)';
  g.shadowOffsetY = 4;
  g.shadowBlur = 10;
  g.font = 'italic 700 96px "Crimson Pro", Georgia, serif';
  g.fillStyle = gold;
  g.fillText('Wikimasters', cx, H * 0.69);
  m.font = g.font;
  m.fillStyle = '#fff';
  m.fillText('Wikimasters', cx, H * 0.69);
  g.shadowBlur = 0;
  g.shadowOffsetY = 0;
  g.font = 'italic 800 30px "Rubik", sans-serif';
  g.fillStyle = '#ffffff';
  g.letterSpacing = '6px';
  g.fillText('ENHANCED', cx, H * 0.765);
  g.letterSpacing = '0px';

  // "5 cartes" badge.
  const by = H * 0.85;
  g.fillStyle = '#ffd23f';
  g.beginPath();
  g.roundRect(cx - 92, by - 26, 184, 52, 26);
  g.fill();
  g.fillStyle = '#3a2300';
  g.font = 'italic 900 28px "Rubik", sans-serif';
  g.fillText('5 CARTES', cx, by + 1);
  m.fillStyle = '#fff';
  m.beginPath();
  m.roundRect(cx - 92, by - 26, 184, 52, 26);
  m.fill();

  g.font = '600 18px "Source Sans 3", sans-serif';
  g.fillStyle = 'rgba(220,230,255,0.75)';
  g.fillText('Cartes tirées des articles de fr.wikipedia.org', cx, H * 0.905);

  crimps(g, false);
  crimps(m, true);
  perforation(g, 'rgba(255,255,255,0.55)');
  g.font = '700 16px "Source Sans 3", sans-serif';
  g.textAlign = 'right';
  g.fillStyle = 'rgba(255,255,255,0.8)';
  g.fillText('✂ OUVRIR ICI', W - 18, tearY - 16);
  cutZigzag(g);
  return { face, mask };
}

/** Back art (no foil). */
export async function drawPackBack(): Promise<HTMLCanvasElement> {
  await loadFonts();
  const c = canvas();
  const g = c.getContext('2d')!;
  const cx = W / 2;
  background(g);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = goldGradient(g, 0, 0, W, H);
  g.font = 'italic 700 64px "Crimson Pro", Georgia, serif';
  g.fillText('Wikimasters Enhanced', cx, H * 0.2);
  g.fillStyle = 'rgba(235,240,255,0.92)';
  g.font = '500 26px "Source Sans 3", sans-serif';
  const lines = ['Ce paquet contient 5 cartes', 'à collectionner, tirées', 'd’articles de Wikipédia,', 'l’encyclopédie libre.', '', 'Plus un article est lu,', 'plus sa carte est rare.', 'Une carte sur cent est brillante.'];
  lines.forEach((l, i) => g.fillText(l, cx, H * 0.32 + i * 38));
  // Barcode.
  g.fillStyle = '#fff';
  g.fillRect(cx - 130, H * 0.72, 260, 110);
  g.fillStyle = '#111';
  let x = cx - 118;
  for (let i = 0; i < 48 && x < cx + 118; i++) {
    const w = 1 + ((i * 7) % 4);
    g.fillRect(x, H * 0.72 + 10, w, 80);
    x += w + 2 + ((i * 3) % 3);
  }
  g.font = '600 16px "Source Sans 3", sans-serif';
  g.fillText('3 141592 653589', cx, H * 0.72 + 100);
  g.fillStyle = 'rgba(220,230,255,0.6)';
  g.font = '500 16px "Source Sans 3", sans-serif';
  g.fillText('Textes et images : Wikipédia & Wikimedia Commons (CC BY-SA)', cx, H * 0.9);
  crimps(g, false);
  perforation(g, 'rgba(255,255,255,0.4)');
  cutZigzag(g);
  return c;
}
