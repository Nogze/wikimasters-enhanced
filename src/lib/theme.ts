// Light or dark interface (the 3D stage stays dark). Stored per browser.
const KEY = 'wme-theme';
export type Theme = 'dark' | 'light';

export function theme(): Theme {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}
export function applyTheme(t: Theme = theme()) {
  document.documentElement.dataset.theme = t;
}
export function setTheme(t: Theme) {
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* private mode */
  }
  applyTheme(t);
}
