// End-to-end check of the browser extension (dist/, loaded unpacked) against a FAKE
// wiki-masters: their site, API and Supabase are answered by route interception, with a fake
// session cookie, and Cloudflare Turnstile is replaced by a stand-in that answers at once. Nothing
// reaches the real wiki-masters account.
//
// Covers: takeover (canvas, no official page), and the anti-bot check done inside Wikimasters Enhanced
// (first /packs/open refused → panel → token to /api/human-check → opening retried).
// `npm run test:e2e` (builds dist/ first). Screenshots go to .shots/ (OUT=… to change).
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const OUT = process.env.OUT ?? fileURLToPath(new URL('../.shots', import.meta.url));
const EXT = process.env.EXT ?? fileURLToPath(new URL('../dist', import.meta.url));
mkdirSync(OUT, { recursive: true });
const USER = '0f6b1d3e-1111-4c2a-9d7e-123456789abc';
const errors = [];
let failed = 0;
const check = (ok, what, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok || !extra ? '' : ` ${String(extra).slice(0, 300)}`}`);
  if (!ok) failed++;
};
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

// ---- fake data ----
const TITLES = ['France', 'Paris', 'Tour Eiffel', 'Napoléon Ier', 'Louvre', 'Mont Blanc', 'Seine', 'Marseille'];
const RARITIES = ['C', 'PC', 'R', 'SR', 'UR', 'L', 'C', 'PC'];
const cards = TITLES.map((t, i) => ({
  id: `00000000-0000-4000-8000-00000000000${i}`,
  atk: 3000 + i * 500,
  def: 3200 + i * 400,
  lang: 'fr',
  rarity: RARITIES[i],
  q_score: 80,
  category: 'monument de Paris',
  image_url: null,
  pageviews: 1000 * (i + 1),
  hide_image: false,
  wikipedia_url: `https://fr.wikipedia.org/wiki/${encodeURIComponent(t.replaceAll(' ', '_'))}`,
  wikipedia_title: t,
}));
const owned = cards.slice(0, 6).map((c, i) => ({ id: `11111111-0000-4000-8000-00000000000${i}`, card_id: c.id, count: 1 + (i % 2), starred: i === 0, is_shiny: i === 3, obtained_at: new Date(Date.now() - i * 3600_000).toISOString(), user_card_tags: [], card: c }));
const profile = { username: 'wm_tester', packs_remaining: 8, pack_cap: 10, packs_last_regen_at: new Date(Date.now() - 60_000).toISOString(), wikibidous_balance: 1234 };
const calls = [];
let humanOk = false;
let tokenSeen = null;

const ctx = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker', { timeout: 20_000 }));
check(!!sw, 'extension loaded');
await sw.evaluate(() => chrome.storage.local.set({ anon: { key: 'test-anon-key', at: Date.now() } }));
await ctx.addCookies([
  { name: 'sb-cyrxjeppjqsxxjayfrur-auth-token', value: 'base64-' + b64url({ access_token: `h.${b64url({ sub: USER })}.s`, user: { id: USER } }), domain: 'www.wiki-masters.com', path: '/', secure: true, sameSite: 'Lax' },
]);

const json = (route, data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
await ctx.route('https://www.wiki-masters.com/**', async (route) => {
  const url = new URL(route.request().url());
  const method = route.request().method();
  if (url.pathname.startsWith('/api/')) calls.push(`${method} ${url.pathname}`);
  if (url.pathname === '/api/wikibidous') return json(route, { balance: profile.wikibidous_balance });
  if (url.pathname === '/api/human-check' && method === 'POST') {
    tokenSeen = JSON.parse(route.request().postData() || '{}').token ?? null;
    humanOk = tokenSeen === 'fake-turnstile-token';
    return json(route, { ok: humanOk }, humanOk ? 200 : 400);
  }
  if (url.pathname === '/api/packs/open' && method === 'POST') {
    if (!humanOk) return json(route, { error: 'Vérification anti-bot requise pour continuer à ouvrir des paquets.' }, 403);
    profile.packs_remaining -= 1;
    const pulled = [cards[6], cards[7], cards[1], cards[4], cards[5]];
    return json(route, { cards: pulled.map((c, i) => ({ ...c, is_shiny: i === 4 })), packs_remaining: profile.packs_remaining, packs_last_regen_at: profile.packs_last_regen_at, owned_copies: Object.fromEntries(pulled.map((c, i) => [c.id, i % 2 ? 2 : 1])) });
  }
  if (url.pathname.startsWith('/api/')) return json(route, { error: 'not faked' }, 404);
  return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><head><title>wiki-masters</title></head><body><h1 id="official">Site officiel wiki-masters</h1></body></html>' });
});
// Stand-in for Cloudflare Turnstile: renders a box and answers with a token.
await ctx.route('https://challenges.cloudflare.com/**', (route) => {
  const onload = new URL(route.request().url()).searchParams.get('onload');
  route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: `window.turnstile = { render(el, o) { el.textContent = 'turnstile (test)'; el.dataset.sitekey = o.sitekey; document.documentElement.dataset.tsSitekey = o.sitekey; setTimeout(() => o.callback('fake-turnstile-token'), 400); return 'w1'; }, reset() {}, remove() {} }; ${onload ? `window[${JSON.stringify(onload)}]();` : ''}`,
  });
});
await ctx.route('https://cyrxjeppjqsxxjayfrur.supabase.co/**', async (route) => {
  const url = new URL(route.request().url());
  calls.push(`supabase ${url.pathname}`);
  if (url.pathname.endsWith('/rpc/sync_profile_packs')) return json(route, [profile]);
  if (url.pathname.endsWith('/user_cards')) return json(route, route.request().method() === 'GET' ? owned : null, route.request().method() === 'GET' ? 200 : 204);
  if (url.pathname.endsWith('/tags')) return json(route, []);
  if (url.pathname.endsWith('/cards')) {
    const ids = (url.searchParams.get('id') ?? '').replace(/^in\.\(|\)$/g, '').split(',');
    return json(route, cards.filter((c) => ids.includes(c.id)));
  }
  return json(route, { message: 'not faked' }, 404);
});

const page = ctx.pages()[0] ?? (await ctx.newPage());
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && !/status of 4\d\d|Failed to load resource/.test(m.text()) && errors.push(`console: ${m.text().slice(0, 300)}`));
const shot = (name) => page.screenshot({ path: `${OUT}/ext-${name}.png` }).then(() => console.log('shot', name));

// 1. Takeover: the native client instead of the official page.
await page.goto('https://www.wiki-masters.com/', { waitUntil: 'commit' });
await page.waitForSelector('canvas', { timeout: 60_000 });
check((await page.locator('#official').count()) === 0, 'official page replaced by the Wikimasters Enhanced client');
await page.waitForTimeout(6000);
await shot('1-title');
await page.mouse.click(640, 400);
await page.waitForTimeout(6000);

// 2. Opening: refused once for the anti-bot check, solved in Wikimasters Enhanced, then opened.
await page.keyboard.press('Space');
const dialog = page.locator('[role="dialog"][aria-label="Vérification rapide"]');
await dialog.waitFor({ timeout: 30_000 }).catch(() => {});
check((await dialog.count()) === 1, 'anti-bot panel shown inside Wikimasters Enhanced');
await shot('2-check');
check((await page.evaluate(() => document.documentElement.dataset.tsSitekey)) === '0x4AAAAAAEW_2IAWonrk_N5i', "Turnstile rendered with wiki-masters' site key");
await page.waitForFunction(() => !document.querySelector('[aria-label="Vérification rapide"]'), null, { timeout: 30_000 }).catch(() => {});
check(tokenSeen === 'fake-turnstile-token', `token sent to /api/human-check (${tokenSeen})`);
for (let k = 0; k < 40 && calls.filter((c) => c === 'POST /api/packs/open').length < 2; k++) await page.waitForTimeout(500);
const opens = calls.filter((c) => c === 'POST /api/packs/open').length;
check(opens === 2, `opening retried after the check (${opens} calls to /api/packs/open)`, calls.join(' | '));
check(profile.packs_remaining === 7, `pack spent once (${profile.packs_remaining} left)`);
await page.waitForTimeout(8000);
await shot('3-opened');

console.log('wiki-masters calls:', calls.join(' | '));
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page errors');
console.log(failed ? `${failed} FAILED` : 'all extension checks passed');
await ctx.close();
process.exit(failed ? 1 : 0);
