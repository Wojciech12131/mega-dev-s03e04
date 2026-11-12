// Builds app/ into dist/ for deploy. R6: one full git sha goes into <meta name="build"> and the footer.
// Every module and stylesheet URL gets ?v=<sha>, so a cached old file can never mix with a new build.
// Usage: node scripts/build.mjs [--sha <sha>]   (default: git rev-parse HEAD; refuses a dirty tree unless --sha)
import { execSync } from 'node:child_process';
import { cpSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const arg = process.argv.indexOf('--sha');
let sha = arg > 0 ? process.argv[arg + 1] : '';
if (!sha) {
  const dirty = execSync('git status --porcelain -- app', { cwd: root }).toString().trim();
  if (dirty) throw new Error(`app/ has uncommitted changes, so HEAD would not name this build:\n${dirty}`);
  sha = execSync('git rev-parse HEAD', { cwd: root }).toString().trim();
}
if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`not a full git sha: ${sha}`);

const src = join(root, 'app');
const out = join(root, 'dist');
rmSync(out, { recursive: true, force: true });
cpSync(src, out, { recursive: true });

for (const name of readdirSync(out)) {
  const file = join(out, name);
  let text = readFileSync(file, 'utf8');
  if (name.endsWith('.js')) text = text.replace(/(from\s+'\.\/[\w-]+\.js)'/g, `$1?v=${sha}'`);
  if (name === 'index.html') {
    text = text
      .replaceAll('__BUILD_SHA__', sha)
      .replace('href="style.css"', `href="style.css?v=${sha}"`)
      .replace('src="app.js"', `src="app.js?v=${sha}"`);
  }
  writeFileSync(file, text);
}
writeFileSync(join(out, '.nojekyll'), '');
console.log(`built dist/ for ${sha}`);
