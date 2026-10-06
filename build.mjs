// Builds the extension into dist/ (load it unpacked from chrome://extensions):
//   dist/manifest.json, loader.js, background.js  ← extension/
//   dist/client/                                   ← the game client (src/), with turnstile.js
import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');

execSync('npx vite build', { cwd: here, stdio: 'inherit' });
mkdirSync(dist, { recursive: true });
for (const f of ['manifest.json', 'loader.js', 'background.js']) copyFileSync(join(here, 'extension', f), join(dist, f));
// The Turnstile bridge goes under client/ (web-accessible), see extension/turnstile.js.
copyFileSync(join(here, 'extension', 'turnstile.js'), join(dist, 'client', 'turnstile.js'));
console.log(`extension ready in ${dist}`);
