// Link checker: collect every in-app link (data-go) from a set of screens,
// open one example of each kind, and make sure it lands on a real screen
// without script errors. Catches dead buttons and broken hand-offs between views.
//
// Usage:
//   NODE_PATH=/tmp/sc26build/webtest/node_modules node app/web/tests/test_links.mjs [width]
import { createRequire } from 'module';
const require = createRequire(process.env.NODE_PATH ? process.env.NODE_PATH + '/' : import.meta.url);
const { chromium } = require('playwright-core');

const W = +(process.argv[2] || 412);
const PAGE = process.env.SC26_PAGE || 'index.html';
const BASE = 'http://127.0.0.1:8765/' + PAGE + '?now=2026-11-18T10:40';
let failed = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? '✓ ' : '✗ ') + name + (extra ? '  [' + extra + ']' : '')); if (!cond) failed++; };

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: W, height: 915 }, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => {
  if (!localStorage.getItem('sc26atlas.v1')) localStorage.setItem('sc26atlas.v1', JSON.stringify({
    plan: { sess248: 1, 'sess201/pap1017': 2, sess250: 3 }, interests: { themes: ['quantum', 'llm'], tags: [], keywords: [], formats: [] },
    settings: { techOnly: true, passes: ['TP', 'W', 'T', 'EX'], sim: null, onboarded: true } }));
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()); });
await page.goto(BASE + '#/home');
await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 20000 });
const visit = async (h, wait = 500) => { await page.evaluate(x => { location.hash = x; }, h); await page.waitForTimeout(wait); };

const seeds = ['#/home', '#/schedule?d=4', '#/explore', '#/people', '#/people?tab=foryou', '#/people?tab=veterans', '#/plan', '#/builder', '#/settings', '#/posters',
  '#/item/sess201/pap1017', '#/item/sess201', '#/item/sess248', '#/person/360143', '#/org/3', '#/search?q=quantum', '#/themes', '#/theme/quantum', '#/tag/2',
  '#/heatmap', '#/formats', '#/pulse', '#/buzz', '#/globe', '#/country/0', '#/orgs', '#/room/3', '#/map', '#/network', '#/galaxy'];
const found = new Map();   // route kind -> example hash
for (const s of seeds) {
  await visit(s, /galaxy|globe|network|map/.test(s) ? 1500 : 600);
  const links = await page.evaluate(() => Array.from(document.querySelectorAll('[data-go]')).map(e => e.dataset.go));
  for (const l of links) {
    const kind = l.replace(/^#\//, '').split(/[/?]/)[0] + (l.includes('?') ? '?' + l.split('?')[1].split('&').map(kv => kv.split('=')[0]).sort().join('&') : '');
    if (!found.has(kind)) found.set(kind, l);
  }
}
ok('collected links from ' + seeds.length + ' screens', found.size > 20, found.size + ' kinds of link');

for (const [kind, link] of Array.from(found.entries()).sort()) {
  const before = errors.length;
  await visit(link, /galaxy|globe|network|map/.test(link) ? 1400 : 550);
  const r = await page.evaluate(() => {
    const v = document.getElementById('view'); const h3 = v.querySelector('.empty h3');
    return { hash: location.hash, text: v.innerText.trim().length, canvas: v.querySelectorAll('canvas, svg, img').length,
      bad: h3 ? /not found|went wrong|not in the program/i.test(h3.textContent) : false, title: document.getElementById('top-title').textContent };
  });
  ok(kind + ' → ' + link.slice(0, 60), !r.bad && (r.text > 20 || r.canvas > 0) && errors.length === before,
    r.bad ? 'landed on an error screen' : errors.length > before ? errors.slice(before).join(' | ').slice(0, 200) : '');
}

// hand-offs with meaning: the target must show the thing that was asked for
await visit('#/item/sess201/pap1017', 700);
const roomName = await page.evaluate(() => document.querySelector('.d-row.tap b').textContent);
await page.locator('.d-row.tap').tap(); await page.waitForTimeout(1600);
ok('detail → map shows the same room', (await page.evaluate(() => document.getElementById('view').innerText)).includes(roomName), roomName);
await visit('#/item/sess201/pap1017', 700);
const title = await page.evaluate(() => document.querySelector('.d-title').textContent);
await page.locator('.d-link[data-go^="#/galaxy"]').tap(); await page.waitForTimeout(2200);
ok('detail → galaxy selects the same talk', (await page.evaluate(() => document.getElementById('view').innerText)).includes(title.slice(0, 30)), title.slice(0, 40));
await visit('#/person/360143', 700);
await page.locator('[data-go^="#/network?p="]').first().tap(); await page.waitForTimeout(2200);
ok('profile → network focuses that person', /Ian Foster/.test(await page.evaluate(() => document.getElementById('top-title').textContent + ' ' + document.getElementById('view').innerText)));
await visit('#/theme/quantum', 800);
const gal = page.locator('[data-go^="#/galaxy?theme="]').first();
if (await gal.count()) { await gal.tap(); await page.waitForTimeout(2000); ok('theme → galaxy keeps the theme in the URL', (await page.evaluate(() => location.hash)).includes('theme=quantum')); }
await visit('#/plan', 700);
const walk = page.locator('.gap[data-go^="#/map/"]').first();
if (await walk.count()) { await walk.tap(); await page.waitForTimeout(1600); ok('plan walking hint → map shows a walking estimate', /min/.test(await page.evaluate(() => document.getElementById('view').innerText))); }

ok('no script errors while following links', errors.length === 0, errors.slice(0, 3).join(' | ').slice(0, 300));
await browser.close();
console.log(failed ? failed + ' check(s) failed' : 'all checks passed');
process.exit(failed ? 1 : 0);
