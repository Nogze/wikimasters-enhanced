import { md5 } from './md5';

// Wikimedia originals can weigh megabytes: ask for a thumbnail of the needed width, and fall back
// to the original when there's no thumbnail (Wikimedia answers 400 when the original is narrower
// than the requested width).
//   upload.wikimedia.org/wikipedia/commons/a/ab/F.jpg → …/commons/thumb/a/ab/F.jpg/640px-F.jpg
//   (SVG thumbs are PNGs: …/F.svg/640px-F.svg.png)
// Special:FilePath URLs (from Wikidata) are rewritten to upload.wikimedia.org: the redirect they
// answer with carries no CORS header, so WebGL couldn't use them.

/** Candidate URLs, best first: [thumbnail, original] (or just [url] for other hosts). */
// Widths: Wikimedia's standard thumbnail steps (330, 500, 960…); other widths get throttled (429).
export function imageSources(url: string | null | undefined, width: 330 | 500 | 960 = 500): string[] {
  if (!url) return [];
  let root: string | null = null;
  let a = '';
  let ab = '';
  let file = '';
  const m = url.match(/^(https:\/\/upload\.wikimedia\.org\/wikipedia\/[^/]+)\/(?!thumb\/)([0-9a-f])\/([0-9a-f]{2})\/([^/?#]+)$/);
  const f = url.match(/\/wiki\/Special:FilePath\/([^?#]+)/);
  if (m) [, root, a, ab, file] = m as unknown as [string, string, string, string, string];
  else if (f) {
    const name = decodeURIComponent(f[1]!).replaceAll(' ', '_');
    const h = md5(name);
    [root, a, ab, file] = ['https://upload.wikimedia.org/wikipedia/commons', h[0]!, h.slice(0, 2), encodeURIComponent(name)];
  }
  if (!root) return [url];
  const suffix = /\.svg$/i.test(file) ? '.png' : /\.tiff?$/i.test(file) ? '.jpg' : '';
  return [`${root}/thumb/${a}/${ab}/${file}/${width}px-${file}${suffix}`, `${root}/${a}/${ab}/${file}`];
}
