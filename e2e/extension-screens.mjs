// The extension's screens beyond packs, against a FAKE wiki-masters (route interception, fake
// session cookie: nothing reaches the real account): friends, messages, notifications, profiles
// and showcase, catalogue, achievements (claim), guild, tags and [LOCKED] locks.
// `npm run test:e2e` (builds dist/ first). Screenshots go to .shots/ (OUT=… to change).
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const OUT = process.env.OUT ?? fileURLToPath(new URL('../.shots', import.meta.url));
const EXT = process.env.EXT ?? fileURLToPath(new URL('../dist', import.meta.url));
mkdirSync(OUT, { recursive: true });
const USER = '0f6b1d3e-1111-4c2a-9d7e-123456789abc';
const FRIEND = '0f6b1d3e-2222-4c2a-9d7e-123456789abc';
const ASKER = '0f6b1d3e-3333-4c2a-9d7e-123456789abc';
const errors = [];
let failed = 0;
const check = (ok, what, extra = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${ok || !extra ? '' : ` ${String(extra).slice(0, 300)}`}`);
  if (!ok) failed++;
};
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = () => new Date().toISOString();

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
const tags = [];
const cardTags = new Set();
const owned = () => cards.slice(0, 6).map((c, i) => {
  const id = `11111111-0000-4000-8000-00000000000${i}`;
  return { id, card_id: c.id, count: 1 + (i % 2), starred: i === 0, is_shiny: i === 3, obtained_at: new Date(Date.now() - i * 3600_000).toISOString(), user_card_tags: tags.filter((t) => cardTags.has(`${id}|${t.id}`)).map((t) => ({ tag_id: t.id })), card: c };
});
const profile = { username: 'wm_tester', packs_remaining: 8, pack_cap: 10, packs_last_regen_at: new Date(Date.now() - 60_000).toISOString(), wikibidous_balance: 1234 };
const messages = [{ id: 'm1', sender_id: FRIEND, recipient_id: USER, content: 'Salut, tu échanges la Tour Eiffel ?', read: false, created_at: now() }];
const showcase = [];
const wished = new Set();
let claimed = false;
const calls = [];

const ctx = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
// The extension only talks to wiki-masters (and Wikimedia for card images): any other host is a failure.
const foreign = new Set();
ctx.on('request', (r) => {
  const u = new URL(r.url());
  if (!/^https?:$/.test(u.protocol)) return;
  if (!/(^|.)(wiki-masters.com|supabase.co|wikimedia.org|wikipedia.org|wikidata.org)$/.test(u.hostname)) foreign.add(u.hostname);
});
const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker', { timeout: 20_000 }));
await sw.evaluate(() => chrome.storage.local.set({ anon: { key: 'test-anon-key', at: Date.now() } }));
await ctx.addCookies([
  { name: 'sb-cyrxjeppjqsxxjayfrur-auth-token', value: 'base64-' + b64url({ access_token: `h.${b64url({ sub: USER })}.s`, user: { id: USER } }), domain: 'www.wiki-masters.com', path: '/', secure: true, sameSite: 'Lax' },
]);

// wiki-masters' clock runs 5 s ahead of the browser's: timed bids must aim by theirs.
const SKEW = 5000;
const serverNow = () => Date.now() + SKEW;
const json = (route, data, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', headers: { 'x-vercel-id': `cdg1::iad1::t8x2k-${serverNow()}-0a1b2c3d4e5f` }, body: JSON.stringify(data) });
const LOT = '66666666-0000-4000-8000-000000000001';
let lotEnd = 0;
let bidAt = null;
const person = (id, username) => ({ id, username, avatar_url: null });
await ctx.route('https://www.wiki-masters.com/**', async (route) => {
  const url = new URL(route.request().url());
  const method = route.request().method();
  const p = url.pathname;
  const body = () => JSON.parse(route.request().postData() || '{}');
  if (p.startsWith('/api/')) calls.push(`${method} ${p}`);
  if (p === '/api/wikibidous') return json(route, { balance: profile.wikibidous_balance });
  if (p === '/api/friends' && method === 'GET')
    return json(route, {
      friendships: [
        { id: '44444444-0000-4000-8000-000000000001', status: 'accepted', requester_id: USER, addressee_id: FRIEND, requester: person(USER, 'wm_tester'), addressee: person(FRIEND, 'wm_friend'), created_at: now() },
        { id: '44444444-0000-4000-8000-000000000002', status: 'pending', requester_id: ASKER, addressee_id: USER, requester: person(ASKER, 'wm_asker'), addressee: person(USER, 'wm_tester'), created_at: now() },
      ],
    });
  if (p === '/api/friends/search') return json(route, { users: [person(FRIEND, 'wm_friend'), person(ASKER, 'wm_asker')] });
  if (p.startsWith('/api/friends')) return json(route, { ok: true });
  if (p === '/api/chat') return json(route, { conversations: [{ peer_id: FRIEND, peer_username: 'wm_friend', peer_avatar_url: null, last_message: messages.at(-1).content, last_message_at: messages.at(-1).created_at, unread_count: 1 }] });
  if (p === `/api/chat/${FRIEND}` && method === 'GET') return json(route, { messages });
  if (p === `/api/chat/${FRIEND}` && method === 'POST') {
    const m = { id: `m${messages.length + 1}`, sender_id: USER, recipient_id: FRIEND, content: body().content, read: false, created_at: now() };
    messages.push(m);
    return json(route, { message: m });
  }
  if (p === '/api/notifications' && method === 'GET') return json(route, { notifications: [{ id: 'n1', type: 'auction_outbid', data: { title: 'Enchère dépassée', card_title: 'Paris', auction_id: '22222222-0000-4000-8000-000000000001' }, read: false, created_at: now() }] });
  if (p === '/api/notifications') return json(route, {});
  if (p === '/api/achievements/check') return json(route, {});
  if (p === '/api/achievements/claim') {
    claimed = true;
    profile.wikibidous_balance += 50;
    return json(route, { ok: true });
  }
  const prof = p.match(/^\/api\/profile\/([^/]+)(\/showcase|\/collection|\/stats)?$/);
  if (prof) {
    const name = decodeURIComponent(prof[1]);
    const own = name === 'wm_tester';
    if (method === 'PATCH') return json(route, { ok: true });
    if (prof[2] === '/showcase') return json(route, { showcase: own ? showcase : [{ position: 0, user_card: { id: 'uc-f', card: cards[5], is_shiny: false } }] });
    if (prof[2] === '/collection') return json(route, { collection: cards.slice(2, 7).map((c, i) => ({ id: `fc${i}`, card: c, count: 1, is_shiny: false })), total: 5, rarityCounts: { R: 1, SR: 1, UR: 1, L: 1, C: 1 } });
    return json(route, { profile: { id: own ? USER : FRIEND, username: name, avatar_url: null, is_public: true, created_at: '2025-10-01T00:00:00Z' }, isOwn: own, isFriend: !own, lastSeenAt: now() });
  }
  if (p === '/api/showcase' && method === 'GET') return json(route, { showcase, galleries: [] });
  if (p === '/api/showcase' && method === 'PUT') {
    const b = body();
    showcase.push({ position: b.position, user_card_id: b.user_card_id, user_card: { id: b.user_card_id, card: cards[0], is_shiny: false } });
    return json(route, {});
  }
  if (p === '/api/showcase') return json(route, {});
  if (p === '/api/cards') return json(route, { cards, total: cards.length, rarityCounts: { C: 2, PC: 2, R: 1, SR: 1, UR: 1, L: 1 }, ownedCardIds: [], wishlistCardIds: [] });
  if (p === '/api/guilds' && method === 'GET') return json(route, { guild: null, membership: null, member_count: 0 });
  if (p === '/api/guilds/leaderboard') return json(route, { entries: [{ rank: 1, guild_id: 'g1', guild_name: 'Les Encyclopédistes', member_count: 12, score_battles: 0, score_wb: 4200, total_score: 4200 }], week_start: now(), week_end: now(), reset_in_ms: 3 * 86_400_000, user_guild_id: null });
  if (p === '/api/trades') return json(route, { trades: [] });
  if (p === '/api/battles' && method === 'GET') return json(route, { battles: [], challenge_quota: { used: 0, limit: 3, resets_at: now() } });
  if (p === '/api/battles' && method === 'POST') return json(route, { battle: { id: '55555555-0000-4000-8000-000000000001' } });
  if (p === '/api/battles/55555555-0000-4000-8000-000000000001') return json(route, { battle: { id: '55555555-0000-4000-8000-000000000001', challenger_id: USER, opponent_id: FRIEND, winner_id: null, status: 'pending', created_at: now(), challenger: person(USER, 'wm_tester'), opponent: person(FRIEND, 'wm_friend'), game_state: null }, decks: [] });
  if (p === '/api/reports' && method === 'GET') return json(route, { report: null });
  if (p === '/api/reports') return json(route, { ok: true });
  if (p === '/api/packs/pro-daily') return json(route, { eligible: true, claimed_today: false });
  if (p === '/api/packs/special') return json(route, { packs: [], available: false });
  if (p === '/api/marketplace/mine') return json(route, { sellingCount: 1, maxConcurrentAuctions: 5 });
  if (p === `/api/marketplace/${LOT}`) return json(route, { auction: { id: LOT, card: cards[2], is_shiny: false, seller_id: FRIEND, seller: { username: 'wm_friend' }, base_amount: 5, current_bid: bidAt ? 5 : null, current_bidder_id: bidAt ? USER : null, end_at: new Date(lotEnd).toISOString(), status: 'active', bids_count: bidAt ? 1 : 0 }, bids: [] });
  if (p === `/api/marketplace/${LOT}/bid`) {
    bidAt = serverNow();
    return json(route, { ok: true });
  }
  if (p === '/api/marketplace') return json(route, url.searchParams.get('mine') ? { selling: [], bidding: [], won: [], history: [] } : { auctions: [], hasMore: false });
  if (p.startsWith('/api/')) return json(route, { error: 'not faked' }, 404);
  return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><head><title>wiki-masters</title></head><body><h1 id="official">Site officiel wiki-masters</h1></body></html>' });
});
await ctx.route('https://cyrxjeppjqsxxjayfrur.supabase.co/**', async (route) => {
  const url = new URL(route.request().url());
  const method = route.request().method();
  const body = () => JSON.parse(route.request().postData() || 'null');
  calls.push(`supabase ${method} ${url.pathname}${url.search.slice(0, 60)}`);
  if (url.pathname.endsWith('/rpc/sync_profile_packs')) return json(route, [profile]);
  if (url.pathname.endsWith('/user_cards')) return json(route, method === 'GET' ? owned() : null, method === 'GET' ? 200 : 204);
  if (url.pathname.endsWith('/tags')) {
    if (method === 'POST') {
      const t = { id: `33333333-0000-4000-8000-00000000000${tags.length}`, name: body().name, color: body().color };
      tags.push(t);
      return json(route, [t], 201);
    }
    const name = url.searchParams.get('name');
    return json(route, name ? tags.filter((t) => `eq.${t.name}` === name) : tags);
  }
  if (url.pathname.endsWith('/user_card_tags')) {
    if (method === 'POST') body().forEach((r) => cardTags.add(`${r.user_card_id}|${r.tag_id}`));
    if (method === 'DELETE') {
      const tag = url.searchParams.get('tag_id').slice(3);
      const ids = url.searchParams.get('user_card_id').replace(/^in\.\(|\)$/g, '').split(',');
      ids.forEach((id) => cardTags.delete(`${id}|${tag}`));
    }
    return route.fulfill({ status: 204 });
  }
  if (url.pathname.endsWith('/chat_messages')) return route.fulfill({ status: 204 });
  if (url.pathname.endsWith('/wishlist_items')) {
    if (method === 'POST') wished.add(body().card_id);
    if (method === 'DELETE') wished.delete(url.searchParams.get('card_id').slice(3));
    return method === 'GET' ? json(route, [...wished].map((card_id) => ({ card_id }))) : route.fulfill({ status: 204 });
  }
  if (url.pathname.endsWith('/achievements')) return json(route, [{ id: 'a1', title: 'Premier paquet', description: 'Ouvrir un paquet', wikibidous_reward: 50, sort_order: 1 }, { id: 'a2', title: 'Collectionneur', description: '100 cartes', wikibidous_reward: 200, sort_order: 2 }]);
  if (url.pathname.endsWith('/user_achievements')) return json(route, [{ achievement_id: 'a1', claimed_at: claimed ? now() : null }]);
  if (url.pathname.endsWith('/cards')) {
    const ids = (url.searchParams.get('id') ?? '').replace(/^in\.\(|\)$/g, '').split(',');
    return json(route, cards.filter((c) => ids.includes(c.id)));
  }
  return json(route, { message: 'not faked' }, 404);
});
// Wikipedia summaries (card panels).
await ctx.route('https://fr.wikipedia.org/**', (route) => json(route, { extract: 'Résumé de test.' }));

const page = ctx.pages()[0] ?? (await ctx.newPage());
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && !/status of 4\d\d|Failed to load resource/.test(m.text()) && errors.push(`console: ${m.text().slice(0, 300)}`));
const shot = (name) => page.screenshot({ path: `${OUT}/exts-${name}.png`, timeout: 120_000 });
const go = (p) => page.evaluate((path) => (history.pushState(null, '', path), dispatchEvent(new PopStateEvent('popstate'))), p);
const seen = (sel, ms = 20_000) => page.waitForSelector(sel, { timeout: ms }).then(() => true, () => false);

await page.goto('https://www.wiki-masters.com/', { waitUntil: 'commit' });
await page.waitForSelector('.title, .dock', { timeout: 60_000 });
if (await page.$('.title')) await page.click('.title');
await page.waitForSelector('.dock', { timeout: 30_000 });
check(!(await seen('.dialog', 5000)), 'no dialog at start (nothing to opt into)');

await go('/home');
check(await seen('.tile'), 'home');
await shot('home');

await page.click('.bell');
check(await seen('.notif:has-text("Enchère dépassée")'), 'notification from wiki-masters shown');
await shot('notifications');
await page.keyboard.press('Escape');

await go('/friends');
check(await seen('.row:has-text("wm_friend")'), 'friends list');
check(await seen('.row:has-text("wm_asker") button:has-text("Accepter")'), 'incoming request');
await page.click('.row:has-text("wm_asker") button:has-text("Accepter")');
await page.waitForTimeout(1000);
check(calls.includes('PATCH /api/friends/44444444-0000-4000-8000-000000000002'), 'accept → PATCH /api/friends/<friendship>');
await shot('friends');

await go(`/dms?with=${FRIEND}`);
check(await seen('.msg:has-text("Tour Eiffel")'), 'conversation loaded');
await page.fill('#dm-text', 'Oui, contre Paris');
await page.press('#dm-text', 'Enter');
check(await seen('.msg.me:has-text("contre Paris")'), 'message sent');
await shot('dms');

await go('/profile/wm_friend');
check(await seen('.profilehead:has-text("wm_friend")'), 'player profile');
check(await seen('.strip .slot'), 'player showcase card');
await page.waitForTimeout(2500);
await shot('player');
await go('/profile/wm_friend?tab=collection');
check(await seen('.board .slot'), 'player collection');

await go('/profile');
check(await seen('.emptyslot'), 'my showcase slots');
await page.click('.emptyslot >> nth=0');
await page.waitForSelector('.board .slot', { timeout: 20_000 });
await page.waitForTimeout(2000);
await page.click('.board .slot >> nth=0');
await page.waitForTimeout(1500);
check(calls.includes('PUT /api/showcase'), 'showcase → PUT /api/showcase');
await shot('profile');

await go('/global-collection');
check(await seen('.board .slot'), 'catalogue');
await page.waitForTimeout(2500);
await shot('catalog');

await go('/achievements');
check(await seen('.ach button:has-text("Réclamer")'), 'claimable achievement');
await page.click('.ach button:has-text("Réclamer")');
check(await seen('.toast'), 'claim answered');
check(calls.includes('POST /api/achievements/claim'), 'claim → POST /api/achievements/claim');
await shot('achievements');

await go('/leaderboard');
check(await seen('p:has-text("maintenance")'), 'leaderboard: maintenance notice');
await go('/guild');
check(await seen('.trow2:has-text("Encyclopédistes")'), 'guild ranking');
check(await seen('#guild-name'), 'found-a-guild form');
await shot('guild');

await go('/collection');
await page.waitForSelector('.slot', { timeout: 30_000 });
await page.waitForTimeout(2000);
await page.click('.slot >> nth=1');
check(await seen('.panel .bigcard .cardface.ready', 15_000), 'card panel shows the card picture');
await page.fill('.tagedit input', 'à échanger');
await page.press('.tagedit input', 'Enter');
check(await seen('.tagchip.on:has-text("à échanger")'), 'tag created and set');
await page.click('.panel button[aria-label="Verrouiller"]');
// Locking creates the [LOCKED] tag (first time), then tags the card: two requests.
const locked = () => tags.some((t) => t.name === '[LOCKED]') && [...cardTags].some((k) => k.endsWith(tags.find((t) => t.name === '[LOCKED]').id));
for (let k = 0; k < 40 && !locked(); k++) await page.waitForTimeout(250);
check(locked(), 'lock = [LOCKED] tag on the account');
await shot('collection');

// battles: the list, a challenge to a friend
await go(`/battle?challenge=${FRIEND}`);
check(await seen('.row.hl button:has-text("Défier")'), 'battles: friend to challenge');
await page.click('.row.hl button:has-text("Défier")');
check(await seen('h2:has-text("Défi envoyé")'), 'battle challenge → pending battle');
check(calls.includes('POST /api/battles'), 'challenge → POST /api/battles');
await shot('battle');

// catalogue wishlist
await go('/global-collection');
await page.waitForSelector('.board .slot', { timeout: 20_000 });
await page.waitForTimeout(1500);
await page.click('.board .slot >> nth=0');
await page.click('.panel button:has-text("Ajouter à ma liste")');
await page.waitForTimeout(800);
check(wished.size === 1, 'wishlist → wishlist_items');

// report a player
await go('/profile/wm_friend');
await page.waitForSelector('button:has-text("Signaler")', { timeout: 15_000 });
await page.click('button:has-text("Signaler")');
await page.click('.dialog .chip:has-text("SPAM")');
await page.click('.dialog button:has-text("Envoyer")');
check(await seen('.dialog .ok'), 'report sent');
check(calls.includes('POST /api/reports'), 'report → POST /api/reports');
await page.keyboard.press('Escape');

// booster: Pro daily pack offered
await go('/');
check(await seen('.extra:has-text("Paquet Pro du jour")'), 'Pro daily pack offered');

// timed bid aimed by wiki-masters' clock (5 s ahead of ours)
lotEnd = serverNow() + 32_000;
await go(`/market/${LOT}`);
await page.waitForSelector('#market-bid', { timeout: 20_000 });
await page.click('.panel .chip:has-text("Min")');
await page.click('.panel button:has-text("Miser à 10 s de la fin")');
await page.click('.panel button:has-text("à 10 s de la fin")');
// The hint shows the measured offset (« +4,98 s par rapport à votre horloge »): about +5 s.
const offset = await page
  .waitForSelector('.timedbox', { timeout: 15_000 })
  .then((el) => el.textContent())
  .then((t) => Number(t?.match(/\(\+(\d+,\d+) s par rapport/)?.[1]?.replace(',', '.')), () => NaN);
check(offset > 4.8 && offset < 5.2, `timed bid armed on the server clock (+${offset} s, expected about +5 s)`);
await shot('timed');
const landed = await page.waitForSelector('.toast:has-text("dernière seconde")', { timeout: 40_000 }).then(() => (lotEnd - bidAt) / 1000, () => null);
check(landed != null && landed > 10 && landed < 14, `timed bid reached wiki-masters ${landed?.toFixed(2)} s before the end, by their clock`);

await go('/settings');
check(await seen('.setrow'), 'settings');

// Pages already visited come back at once with their last content (refreshed in the background),
// never « Chargement… » again.
for (const [path, sel] of [['/friends', '.card-box .row'], ['/achievements', '.ach'], ['/collection', '.slot'], ['/home', '.tile'], ['/guild', '.trow2']]) {
  await go(path);
  const state = await page.evaluate((s) => ({ content: !!document.querySelector(s), loading: !!document.querySelector('.loading') || /Chargement/.test(document.querySelector('.screen')?.textContent ?? '') }), sel);
  check(state.content && !state.loading, `back on ${path}: content shown at once, no loading`, JSON.stringify(state));
}

check(!foreign.size, `only wiki-masters and Wikimedia contacted${foreign.size ? `: ${[...foreign].join(', ')}` : ''}`);

console.log('wiki-masters calls:', [...new Set(calls)].join(' | '));
console.log(errors.length ? `ERRORS:\n${[...new Set(errors)].join('\n')}` : 'no page errors');
console.log(failed ? `${failed} FAILED` : 'all extension screen checks passed');
await ctx.close();
process.exit(failed ? 1 : 0);
