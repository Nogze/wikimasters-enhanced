// Messages from the in-page client to the extension's background worker (extension/background.js). The
// background is the only part that reads the wiki-masters session cookie.

declare const chrome: {
  runtime: { sendMessage(msg: unknown): Promise<unknown>; getURL(path: string): string };
};

export type WmAuth = { userId: string; accessToken: string };

type Messages = {
  'wm-session': { req: Record<string, never>; res: WmAuth | null };
  'wm-anon-key': { req: Record<string, never>; res: string };
};

export async function bg<K extends keyof Messages>(type: K, payload?: Messages[K]['req']): Promise<Messages[K]['res']> {
  const res = (await chrome.runtime.sendMessage({ type, ...(payload ?? {}) })) as { ok: true; data: Messages[K]['res'] } | { ok: false; error: string; message: string };
  if (!res) throw new Error('extension unavailable');
  if (!res.ok) throw Object.assign(new Error(res.message), { code: res.error });
  return res.data;
}

// The mode lives in the page's localStorage: the loader must read it synchronously at
// document_start, before wiki-masters' own scripts start (extension/loader.js).
const MODE = 'wme-mode';

/** Shows the official page once, without switching the extension off (e.g. the market). */
export function openOriginal(path: string) {
  sessionStorage.setItem('wme-bypass', '1');
  location.href = path;
}

/** Back to the official site until the player switches Wikimasters Enhanced on again (button on the page). */
export function showOriginalSite() {
  localStorage.setItem(MODE, 'original');
  location.reload();
}
