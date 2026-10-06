// Background service worker: the only part of the extension that reads the wiki-masters session
// cookie. The in-page client gets the player's id and access token, to call wiki-masters' Supabase
// as their own app does. Nothing leaves the browser except requests to wiki-masters itself.

const WM = 'https://www.wiki-masters.com';
const SUPABASE_REF = 'cyrxjeppjqsxxjayfrur';
const COOKIE = `sb-${SUPABASE_REF}-auth-token`;

class Failure extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// ---- the wiki-masters session (Supabase auth cookie, maybe split in .0 .1 … chunks) ----
async function rawSession() {
  const all = await chrome.cookies.getAll({ domain: 'wiki-masters.com' });
  const whole = all.find((c) => c.name === COOKIE);
  if (whole) return decodeURIComponent(whole.value);
  const parts = all.filter((c) => c.name.startsWith(`${COOKIE}.`)).sort((a, b) => Number(a.name.split('.').pop()) - Number(b.name.split('.').pop()));
  return parts.length ? parts.map((c) => decodeURIComponent(c.value)).join('') : null;
}

function base64UrlJson(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

function parseSession(raw) {
  try {
    const s = raw.startsWith('base64-') ? base64UrlJson(raw.slice(7)) : JSON.parse(raw);
    const token = s.access_token ?? s.currentSession?.access_token;
    if (typeof token !== 'string') return null;
    const userId = s.user?.id ?? base64UrlJson(token.split('.')[1]).sub;
    return userId ? { accessToken: token, userId } : null;
  } catch {
    return null;
  }
}


// ---- wiki-masters' public Supabase key, read from their JS bundle (cached a day) ----
async function anonKey() {
  const { anon } = await chrome.storage.local.get('anon');
  if (anon && Date.now() - anon.at < 86_400_000) return anon.key;
  const html = await (await fetch(`${WM}/login`, { signal: AbortSignal.timeout(15_000) })).text();
  const chunks = [...new Set(html.match(/\/_next\/static\/chunks\/[^"']+\.js[^"']*/g) ?? [])];
  for (const path of chunks) {
    const js = await (await fetch(WM + path, { signal: AbortSignal.timeout(15_000) })).text();
    const key = js.match(/eyJhbGciOi[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)?.[0] ?? js.match(/sb_publishable_[A-Za-z0-9_-]+/)?.[0];
    if (key) {
      await chrome.storage.local.set({ anon: { key, at: Date.now() } });
      return key;
    }
  }
  throw new Failure('WM_UNAVAILABLE', 'wiki-masters.com est injoignable pour le moment');
}

const handlers = {
  'wm-session': async () => {
    const raw = await rawSession();
    return raw ? parseSession(raw) : null;
  },
  'wm-anon-key': anonKey,
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Only our own content scripts and pages.
  if (sender.id !== chrome.runtime.id || !handlers[msg?.type]) return false;
  handlers[msg.type](msg).then(
    (data) => sendResponse({ ok: true, data }),
    (e) => sendResponse({ ok: false, error: e.code ?? 'ERROR', message: e.message ?? String(e) }),
  );
  return true;
});
