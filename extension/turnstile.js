// Runs in the page's own world (injected as <script src>): hosts wiki-masters' Cloudflare
// Turnstile check for the Wikimasters Enhanced client, which lives in the extension's isolated world and
// can't reach window.turnstile. The player solves the check; this only renders it and passes the
// result back with postMessage. Same site key as wiki-masters' own pack page.
// Shipped under client/ (already web-accessible), so no manifest change is needed.
(() => {
  if (window.__wmeTurnstile) return;
  window.__wmeTurnstile = true;
  const SITE_KEY = '0x4AAAAAAEW_2IAWonrk_N5i';
  let loading = null;
  const load = () =>
    (loading ??= new Promise((resolve, reject) => {
      if (window.turnstile) return resolve();
      window.__wmeTurnstileLoad = resolve;
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__wmeTurnstileLoad&render=explicit';
      s.async = true;
      s.onerror = () => {
        loading = null;
        reject(new Error('Turnstile indisponible'));
      };
      document.head.appendChild(s);
    }));
  const reply = (msg) => window.postMessage({ source: 'wme-turnstile', ...msg }, location.origin);
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.source !== 'wme-client' || e.data.type !== 'render') return;
    const { id } = e.data;
    load().then(
      () => {
        const el = document.getElementById(id);
        if (!el) return reply({ id, error: 'container missing' });
        window.turnstile.render(el, {
          sitekey: SITE_KEY,
          theme: 'dark',
          callback: (token) => reply({ id, token }),
          'error-callback': () => reply({ id, error: 'Vérification impossible, réessayez.' }),
          'expired-callback': () => reply({ id, error: 'Vérification expirée, réessayez.' }),
        });
      },
      (err) => reply({ id, error: err.message }),
    );
  });
  reply({ ready: true });
})();
