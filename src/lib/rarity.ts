import type { Rarity } from './types';

// One place for how each rarity looks and feels: used by the CSS (via inline custom properties),
// the canvas card faces and the 3D opening effects.

export type RarityStyle = {
  label: string;
  /** Main tint (frames, glows). */
  color: string;
  /** Darker partner for gradients. */
  deep: string;
  /** Second tint for gradients / foil. */
  accent: string;
  /** 0 → 1: how loud the reveal is (shake, bloom, slow-mo, particles). */
  hype: number;
  /** Arcade callout on reveal (null = no callout). */
  callout: string | null;
};

export const RARITY_STYLE: Record<Rarity, RarityStyle> = {
  // wiki-masters' rarity colours (mint, pale blue, lavender, pink, orange, gold), as on the cards.
  C: { label: 'Commune', color: '#b8f2d5', deep: '#2b7d58', accent: '#eefcf5', hype: 0, callout: null },
  PC: { label: 'Peu commune', color: '#b1cff2', deep: '#2c5c99', accent: '#eef5fe', hype: 0.15, callout: null },
  R: { label: 'Rare', color: '#c6a7f2', deep: '#6439b8', accent: '#e6d8fb', hype: 0.35, callout: 'RARE !' },
  SR: { label: 'Super rare', color: '#ed6fa3', deep: '#a8235b', accent: '#ffc2dc', hype: 0.6, callout: 'SUPER RARE !' },
  UR: { label: 'Ultra rare', color: '#fa9931', deep: '#9a4f05', accent: '#ffd28f', hype: 0.85, callout: 'ULTRA RARE !!' },
  L: { label: 'Légendaire', color: '#ffe144', deep: '#8a5e00', accent: '#fa9931', hype: 1, callout: 'LÉGENDAIRE !!!' },
};

/** Order from best to worst (API order is the reverse). */
export const RARITY_ORDER: Rarity[] = ['L', 'UR', 'SR', 'R', 'PC', 'C'];
const rarityRank = (r: Rarity) => 5 - RARITY_ORDER.indexOf(r);

/** The rarest of a list. */
export const best = (rs: Rarity[]): Rarity => rs.reduce<Rarity>((a, b) => (rarityRank(b) > rarityRank(a) ? b : a), 'C');

/** CSS custom properties for an element themed by rarity. */
export const fmt = (n: number) => n.toLocaleString('fr');

/** Pageviews as a short label: 1,2 M, 45 k, 312. */
export function views(n: number) {
  if (n >= 1e6) return `${(n / 1e6).toLocaleString('fr', { maximumFractionDigits: 1 })} M`;
  if (n >= 1e4) return `${Math.round(n / 1e3).toLocaleString('fr')} k`;
  return n.toLocaleString('fr');
}
