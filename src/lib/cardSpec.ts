import type { Card, Rarity } from './types';

// The card, as data: wiki-masters' layout (tinted card, image on top, rarity badge, title and
// description, ATK / DEF) with more shine. One spec, two renderers: the DOM card
// (components/CardFace.tsx + styles/card.css) and the canvas face of the 3D card
// (three/cardTexture.ts), so they can't drift apart.

/** Card regions as fractions of the card height (5:7 card). */
export const LAYOUT = {
  /** Image (or emblem) band at the top. */
  art: { y: 0, h: 0.45 },
  /** Title + description. */
  text: { y: 0.48, h: 0.34 },
  /** Divider + ATK / DEF. */
  stats: { y: 0.84, h: 0.16 },
  /** Corner radius, as a fraction of the width. */
  radius: 0.1,
} as const;

export type Treatment = {
  /** Main tint (badge, glow, pattern). wiki-masters' rarity colours. */
  color: string;
  /** Pale top of the body gradient. */
  light: string;
  /** Saturated bottom of the body gradient. */
  mid: string;
  /** Dark partner, for text accents on the tint. */
  deep: string;
  /** Second colour (Légendaire: gold over orange). */
  accent: string;
  /** Glow around the card: [inner, outer] rgba. */
  glow: [string, string];
  /** Idle motion when visible (light sweep, pattern drift). */
  motion: boolean;
  /** Gilded edge + twinkles (UR, L). */
  gilded: boolean;
};

export const TIERS: Record<Rarity, Treatment> = {
  C: { color: '#b8f2d5', light: '#eefcf5', mid: '#a6e9c7', deep: '#2b7d58', accent: '#d9fbe9', glow: ['rgba(184,242,213,.30)', 'rgba(184,242,213,.16)'], motion: false, gilded: false },
  PC: { color: '#b1cff2', light: '#eef5fe', mid: '#9fc1ec', deep: '#2c5c99', accent: '#dbe9fb', glow: ['rgba(177,207,242,.32)', 'rgba(177,207,242,.18)'], motion: false, gilded: false },
  R: { color: '#c6a7f2', light: '#f5effe', mid: '#b996ee', deep: '#6439b8', accent: '#e6d8fb', glow: ['rgba(198,167,242,.36)', 'rgba(198,167,242,.20)'], motion: false, gilded: false },
  SR: { color: '#ed6fa3', light: '#fde7f0', mid: '#f08fb7', deep: '#a8235b', accent: '#ffc2dc', glow: ['rgba(237,111,163,.40)', 'rgba(237,111,163,.22)'], motion: true, gilded: false },
  UR: { color: '#fa9931', light: '#ffe9c9', mid: '#fbae5a', deep: '#9a4f05', accent: '#ffd28f', glow: ['rgba(250,153,49,.45)', 'rgba(250,153,49,.24)'], motion: true, gilded: true },
  L: { color: '#ffe144', light: '#fffbd9', mid: '#ffd23f', deep: '#8a5e00', accent: '#fa9931', glow: ['rgba(255,225,68,.55)', 'rgba(250,153,49,.30)'], motion: true, gilded: true },
};

/** What a card shows in its art band: its image, or the emblem. */
export const hasArt = (card: Card) => !!card.image_url && !card.sensitive;

/** The short line under the title: the description when there is one, else the start of the article. */
export function subtitle(card: Card): string {
  if (card.category) return card.category;
  const ex = card.excerpt?.trim();
  if (ex) {
    // Lead sentences usually read « X est un … » : keep what follows « est ».
    const m = ex.match(/\b(?:est|était|sont) (?:une?|le|la|les|l’|l'|des)\s*([^.;]{6,})/);
    if (m) {
      const rest = m[1]!.split(/[,(]/)[0]!.trim();
      return rest.length > 70 ? rest.slice(0, 68).replace(/\s+\S*$/, '') + '…' : rest;
    }
    return ex.slice(0, 70).replace(/\s+\S*$/, '') + '…';
  }
  return card.category ?? 'Article de Wikipédia';
}


/** Stat icons (24×24): crossed swords (ATK) and a shield (DEF). */
export const ATK_PATH = 'M4 2.5 13 11.5l-1.5 1.5L2.5 4V2.5zm16 0H21.5V4L12.5 13 11 11.5zM6 14l4 4-2 2-1.5-1.5L4 20.5 3.5 20 5.5 18 4 16.5zm12 0 2 2.5-1.5 1.5 2 2-.5.5-2-2L16.5 20l-2-2z';
export const DEF_PATH = 'M12 2 20 5v6c0 5.2-3.4 9.4-8 11-4.6-1.6-8-5.8-8-11V5zm0 2.2L6 6.5V11c0 4 2.5 7.4 6 8.8 3.5-1.4 6-4.8 6-8.8V6.5z';
