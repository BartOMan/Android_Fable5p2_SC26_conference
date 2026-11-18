// Open one screen of the web app in headless Chrome at phone size, report
// console errors, and save a screenshot.
//
// Usage (playwright-core lives outside the repo):
//   NODE_PATH=/tmp/sc26build/webtest/node_modules node app/web/tests/shot.mjs '#/home' /tmp/out.png [now=2026-11-18T10:40] [js=<expr>] [wait=ms] [full=1] [seed=<json>]
//
// The app must be served at http://127.0.0.1:8765 (python3 -m http.server 8765 --directory app/web/www).
import { createRequire } from 'module';
const require = createRequire(process.env.NODE_PATH ? process.env.NODE_PATH + '/' : import.meta.url);
const { chromium } = require('playwright-core');

const [hash = '#/home', out = '/tmp/shot.png', ...rest] = process.argv.slice(2);
const opt = Object.fromEntries(rest.map(a => { const i = a.indexOf('='); return [a.slice(0, i), a.slice(i + 1)]; }));
const base = (opt.base || 'http://127.0.0.1:8765/' + (opt.page || 'index.html'));
const url = base + (opt.now ? '?now=' + opt.now : '') + hash;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: +(opt.dpr || 1), isMobile: true, hasTouch: true });
// seed=<json> preloads the app's saved state (plan, interests, settings) before the page starts
if (opt.seed) await ctx.addInitScript(v => { if (!localStorage.getItem('sc26atlas.v1')) localStorage.setItem('sc26atlas.v1', v); }, opt.seed);
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('requestfailed', r => errors.push('requestfailed: ' + r.url()));
await page.goto(url);
await page.waitForFunction(() => document.documentElement.dataset.ready, null, { timeout: 20000 });
await page.waitForTimeout(+(opt.wait || 600));
if (opt.js) {
  const r = await page.evaluate(opt.js);
  console.log('js ->', JSON.stringify(r));
  await page.waitForTimeout(400);
}
await page.screenshot({ path: out, fullPage: false });
if (opt.full) {
  // capture the whole scrollable view by growing the viewport
  const h = await page.evaluate(() => document.getElementById('view').scrollHeight + 130);
  await page.setViewportSize({ width: 412, height: Math.min(h, 6000) });
  await page.waitForTimeout(300);
  await page.screenshot({ path: out });
}
const info = await page.evaluate(() => ({ ready: document.documentElement.dataset.ready, failed: window.SC26 && window.SC26.failedViews, title: document.title, text: document.getElementById('view') ? document.getElementById('view').innerText.length : 0 }));
console.log(JSON.stringify(info));
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no errors');
await browser.close();
