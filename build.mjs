// Builds the extension into dist/ (load that folder unpacked from chrome://extensions):
//   dist/manifest.json             ← extension/manifest.base.json + the version from package.json
//   dist/loader.js, background.js  ← extension/
//   dist/client/                   ← the game client (src/), with turnstile.js
import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');
const read = (f) => JSON.parse(readFileSync(join(here, f), 'utf8'));

execSync('npx vite build', { cwd: here, stdio: 'inherit' });
mkdirSync(dist, { recursive: true });
const { name, version, ...rest } = read('extension/manifest.base.json');
writeFileSync(join(dist, 'manifest.json'), JSON.stringify({ name, version: read('package.json').version, ...rest }, null, 2) + '\n');
for (const f of ['loader.js', 'background.js']) copyFileSync(join(here, 'extension', f), join(dist, f));
// The Turnstile bridge goes under client/ (web-accessible), see extension/turnstile.js.
copyFileSync(join(here, 'extension', 'turnstile.js'), join(dist, 'client', 'turnstile.js'));
console.log(`extension ready in ${dist}`);
