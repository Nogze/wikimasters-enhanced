// Content script, at document_start on www.wiki-masters.com: replaces their page with the
// Wikimasters Enhanced client (unless the player chose the official site), before any of their scripts run.
//
// The mode is read synchronously from the page's localStorage (an async extension-storage read
// would let their app start meanwhile). Sign-in and legal pages always stay official.

const MODE = 'wme-mode';
const BYPASS = 'wme-bypass';
const OFFICIAL_ONLY = /^\/(login|signup|register|auth|reset-password|forgot-password|legal|cgu|cgv|privacy|terms|mentions)/;

function bypassOnce() {
  try {
    if (sessionStorage.getItem(BYPASS)) {
      sessionStorage.removeItem(BYPASS);
      return true;
    }
  } catch {
    /* storage blocked */
  }
  return false;
}

/** On official pages: a small button to go (back) to Wikimasters Enhanced. */
function switchBackButton() {
  const add = () => {
    if (document.getElementById('wme-switch')) return;
    const b = document.createElement('button');
    b.id = 'wme-switch';
    b.textContent = '▶ Wikimasters Enhanced';
    b.title = 'Ouvrir Wikimasters Enhanced (non officiel)';
    Object.assign(b.style, {
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      zIndex: '2147483647',
      padding: '10px 16px',
      border: '0',
      borderRadius: '999px',
      font: 'italic 800 14px/1 system-ui, sans-serif',
      color: '#3a2300',
      background: 'linear-gradient(180deg,#fff3b0,#ffd23f 45%,#f0a800)',
      boxShadow: '0 0 0 2px #fff, 0 8px 20px -6px rgba(0,0,0,.5)',
      cursor: 'pointer',
    });
    b.addEventListener('click', () => {
      localStorage.setItem(MODE, 'enhanced');
      location.href = '/';
    });
    document.body.appendChild(b);
  };
  if (document.body) add();
  else document.addEventListener('DOMContentLoaded', add, { once: true });
}

function takeOver() {
  window.stop();
  document.documentElement.innerHTML = '<head></head><body><div id="root"></div></body>';
  const head = document.head;
  const el = (tag, attrs) => head.appendChild(Object.assign(document.createElement(tag), attrs));
  el('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1.0' });
  el('meta', { name: 'theme-color', content: '#0e1115' });
  document.title = 'Wikimasters Enhanced';
  el('link', { rel: 'stylesheet', href: chrome.runtime.getURL('client/client.css') });
  document.documentElement.dataset.theme = 'dark';
  import(chrome.runtime.getURL('client/main.js')).catch((e) => {
    console.error('[Wikimasters Enhanced] client failed to load', e);
    localStorage.setItem(MODE, 'original');
    location.reload();
  });
}

(() => {
  if (window.top !== window) return; // never inside frames
  let mode = 'enhanced';
  try {
    mode = localStorage.getItem(MODE) ?? 'enhanced';
  } catch {
    /* storage blocked: keep the default */
  }
  if (mode !== 'enhanced' || bypassOnce() || OFFICIAL_ONLY.test(location.pathname)) {
    switchBackButton();
    return;
  }
  takeOver();
})();
