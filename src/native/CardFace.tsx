import { useEffect, useState } from 'react';
import { TIERS } from '../lib/cardSpec';
import type { Card } from '../lib/types';
import { drawCardBack, drawCardFront } from '../three/cardTexture';

// Cards in the interface are flat pictures: the art the pack opening puts on its 3D cards
// (three/cardTexture.ts), painted once per card and size, then shown as an <img>. Shiny cards get
// a CSS foil sweep; UR and L cards a soft glow in their colour.

const urls = new Map<string, Promise<string>>();
const MAX = 600;

const toUrl = (c: HTMLCanvasElement) => new Promise<string>((resolve, reject) => c.toBlob((b) => (b ? resolve(URL.createObjectURL(b)) : reject(new Error('toBlob'))), 'image/webp', 0.92));

function cached(key: string, make: () => Promise<string>): Promise<string> {
  let p = urls.get(key);
  if (p) {
    urls.delete(key);
    urls.set(key, p); // most recent last
    return p;
  }
  p = make();
  p.catch(() => urls.delete(key));
  urls.set(key, p);
  if (urls.size > MAX) {
    const [old, oldUrl] = urls.entries().next().value!;
    urls.delete(old);
    void oldUrl.then(URL.revokeObjectURL, () => {});
  }
  return p;
}

const frontUrl = (card: Card, shiny: boolean, big: boolean) =>
  cached(`${card.id}|${card.rarity}|${shiny ? 1 : 0}|${card.sensitive ? 1 : 0}|${card.image_url ?? ''}|${big ? 1 : 0}`, () => drawCardFront(card, { shiny, scale: big ? 1 : 0.5 }).then((f) => toUrl(f.face)));
const backUrl = () => cached('back', () => drawCardBack().then(toUrl));

/** A card's face (or its back), filling its box (5:7). */
export function CardFace({ card, shiny = false, big = false, faceDown = false }: { card: Card; shiny?: boolean; big?: boolean; faceDown?: boolean }) {
  const key = faceDown ? 'back' : `${card.id}|${card.rarity}|${shiny}|${card.sensitive}|${card.image_url}|${big}`;
  const [src, setSrc] = useState<{ key: string; url: string } | null>(null);
  useEffect(() => {
    let off = false;
    (faceDown ? backUrl() : frontUrl(card, shiny, big)).then(
      (url) => !off && setSrc({ key, url }),
      () => {},
    );
    return () => {
      off = true;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const tier = TIERS[card.rarity];
  const cls = ['cardface', !faceDown && shiny ? 'shiny' : '', !faceDown && tier.gilded ? 'gilded' : '', src?.key === key ? 'ready' : ''].filter(Boolean).join(' ');
  return (
    <span className={cls} style={!faceDown && tier.gilded ? { ['--glow' as string]: tier.glow[0] } : undefined}>
      {src && <img src={src.url} alt="" draggable={false} decoding="async" />}
    </span>
  );
}
