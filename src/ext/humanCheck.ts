// wiki-masters' anti-bot check before pack openings, done inside Wikimasters Enhanced. Their check is
// Cloudflare Turnstile: the player solves it in a small panel (the one piece of HTML in the game:
// Cloudflare's widget lives in an iframe), then the result goes to wiki-masters' own
// POST /api/human-check, as on their pack page, and the opening is retried.
//
// The widget has to run in the page's world (window.turnstile), not the extension's isolated one:
// client/turnstile.js (extension/turnstile.js) is loaded with <script src>, hosts the
// widget and answers with postMessage.
declare const chrome: { runtime: { getURL(path: string): string } };

let bridge: Promise<void> | null = null;
function loadBridge() {
  return (bridge ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('client/turnstile.js');
    s.onload = () => resolve();
    s.onerror = () => {
      bridge = null;
      reject(new Error('Vérification indisponible (extension à recharger)'));
    };
    document.head.appendChild(s);
  }));
}

function panel(): { box: HTMLDivElement; slot: HTMLDivElement; close: () => void; cancel: HTMLButtonElement } {
  const box = document.createElement('div');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Vérification rapide');
  Object.assign(box.style, {
    position: 'fixed',
    left: '50%',
    top: '50%',
    transform: 'translate(-50%, -50%) scale(0.9)',
    zIndex: '2147483646',
    padding: '22px 24px 18px',
    borderRadius: '18px',
    background: 'linear-gradient(180deg, #16245a, #080d24)',
    boxShadow: '0 0 0 1px rgba(143,180,255,.45), 0 30px 80px -20px rgba(0,0,0,.8)',
    color: '#e7ecff',
    font: '500 14px/1.4 "Source Sans 3", system-ui, sans-serif',
    textAlign: 'center',
    opacity: '0',
    transition: 'opacity .25s, transform .35s cubic-bezier(.2,1.4,.4,1)',
    minWidth: '320px',
  });
  const title = document.createElement('div');
  title.textContent = 'Vérification rapide';
  Object.assign(title.style, { font: 'italic 900 22px/1.2 Rubik, system-ui, sans-serif', marginBottom: '4px' });
  const text = document.createElement('div');
  text.textContent = 'wiki-masters vérifie que vous êtes bien humain avant d’ouvrir des paquets.';
  Object.assign(text.style, { color: '#c9d5f5', marginBottom: '14px', maxWidth: '300px', marginInline: 'auto' });
  const slot = document.createElement('div');
  slot.id = `wme-turnstile-${Date.now()}`;
  Object.assign(slot.style, { minHeight: '65px', display: 'flex', justifyContent: 'center' });
  const cancel = document.createElement('button');
  cancel.textContent = 'Annuler';
  Object.assign(cancel.style, { marginTop: '12px', background: 'none', border: '0', color: '#8fa3d4', font: '600 13px system-ui, sans-serif', cursor: 'pointer' });
  box.append(title, text, slot, cancel);
  document.body.appendChild(box);
  requestAnimationFrame(() => {
    box.style.opacity = '1';
    box.style.transform = 'translate(-50%, -50%) scale(1)';
  });
  return { box, slot, cancel, close: () => box.remove() };
}

/** Shows the check, waits for the player to pass it, and reports it to wiki-masters. */
export async function verifyHuman(): Promise<void> {
  await loadBridge();
  const ui = panel();
  try {
    const token = await new Promise<string>((resolve, reject) => {
      const onMessage = (e: MessageEvent) => {
        if (e.source !== window || e.data?.source !== 'wme-turnstile' || e.data.id !== ui.slot.id) return;
        window.removeEventListener('message', onMessage);
        if (e.data.token) resolve(e.data.token as string);
        else reject(new Error(e.data.error ?? 'Vérification impossible'));
      };
      window.addEventListener('message', onMessage);
      ui.cancel.onclick = () => {
        window.removeEventListener('message', onMessage);
        reject(Object.assign(new Error('Vérification annulée'), { code: 'CANCELLED' }));
      };
      window.postMessage({ source: 'wme-client', type: 'render', id: ui.slot.id }, location.origin);
    });
    const res = await fetch('/api/human-check', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
    document.documentElement.dataset.wmeHumanCheck = String(res.status);
    if (!res.ok) throw new Error(`wiki-masters a refusé la vérification (${res.status})`);
  } finally {
    ui.close();
  }
}
