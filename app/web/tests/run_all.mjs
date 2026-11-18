// Run every browser test in this folder, one after another, and summarize.
//
// Usage:
//   NODE_PATH=/tmp/sc26build/webtest/node_modules node app/web/tests/run_all.mjs [width]
//
// Needs the app served at http://127.0.0.1:8765 (see ../DEV_NOTES.md).
// Exit codes: 0 all passed, 1 at least one test file failed.
import { spawnSync } from 'child_process';
import { readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const width = process.argv[2];
const files = readdirSync(here).filter(f => /^test_.*\.mjs$/.test(f)).sort();
const results = [];
for (const f of files) {
  console.log('\n━━ ' + f + (width ? ' @ ' + width + 'px' : ''));
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [join(here, f)].concat(width ? [width] : []), { stdio: 'inherit', env: process.env });
  results.push([f, r.status === 0, ((Date.now() - t0) / 1000).toFixed(0)]);
}
console.log('\n━━ summary');
for (const [f, ok, s] of results) console.log((ok ? '✓ ' : '✗ ') + f + '  (' + s + ' s)');
process.exit(results.every(r => r[1]) ? 0 : 1);
