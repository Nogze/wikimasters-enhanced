// Drawing helpers shared by the summoning circle and the card back: text set along a circle,
// regular star polygons, the puzzle-globe emblem, and a gold gradient.

/** Writes `text` around a circle (repeated to fill it), letters upright towards the centre. */
export function textRing(g: CanvasRenderingContext2D, text: string, cx: number, cy: number, r: number, font: string, fill: string | CanvasGradient = '#fff') {
  g.save();
  g.font = font;
  g.fillStyle = fill;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const circumference = Math.PI * 2 * r;
  const unit = g.measureText(text).width;
  const reps = Math.max(1, Math.floor(circumference / unit));
  const full = text.repeat(reps);
  // Spread the letters evenly so the ring closes without a gap.
  const step = (Math.PI * 2) / full.length;
  for (let i = 0; i < full.length; i++) {
    const a = i * step - Math.PI / 2;
    g.save();
    g.translate(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    g.rotate(a + Math.PI / 2);
    g.fillText(full[i]!, 0, 0);
    g.restore();
  }
  g.restore();
}

/** Star polygon {n/k} (e.g. 8/3 octagram) inscribed in radius r. */
export function starPolygon(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, n: number, k: number, rot = -Math.PI / 2) {
  g.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = rot + ((i * k) % n) * ((Math.PI * 2) / n);
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
}

export function circle(g: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.stroke();
}

/** Wireframe globe (meridians + parallels), the Wikipedia puzzle globe reduced to its lines. */
export function globe(g: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  circle(g, cx, cy, r);
  for (const k of [0.25, 0.55, 0.85]) {
    g.beginPath();
    g.ellipse(cx, cy, r * k, r, 0, 0, Math.PI * 2);
    g.stroke();
  }
  for (const k of [-0.6, -0.25, 0.25, 0.6]) {
    const y = cy + k * r;
    const w = Math.sqrt(1 - k * k) * r;
    g.beginPath();
    g.ellipse(cx, y, w, w * 0.12, 0, 0, Math.PI * 2);
    g.stroke();
  }
  g.beginPath();
  g.moveTo(cx, cy - r);
  g.lineTo(cx, cy + r);
  g.moveTo(cx - r, cy);
  g.lineTo(cx + r, cy);
  g.stroke();
}

export function goldGradient(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  gr.addColorStop(0, '#fff3c4');
  gr.addColorStop(0.35, '#e8c26a');
  gr.addColorStop(0.6, '#b8852f');
  gr.addColorStop(0.8, '#f2d68a');
  gr.addColorStop(1, '#9a6b22');
  return gr;
}
