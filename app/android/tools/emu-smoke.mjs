#!/usr/bin/env node
// Smoke test of the real app inside the Android WebView on a running emulator or device.
//
//   node app/android/tools/emu-smoke.mjs [screenshot-dir]
//
// Needs: the DEBUG build installed and running, adb, and playwright-core in
// /tmp/sc26build/pw (npm i --prefix /tmp/sc26build/pw playwright-core).
// Boot the emulator with `-gpu host`: the software renderer (swiftshader_indirect)
// draws stale tiles in this app's scrolling views, which is an emulator artifact.
//
// The test drives the WebView over the Chrome DevTools Protocol: it opens every
// screen, checks for script errors and blank canvases, and exercises the native
// bridge (share sheet, reminders, back button). Exit code 1 on any failed check.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const pwDir = process.env.SC26_PW_DIR || '/tmp/sc26build/pw';
const pkg = 'io.github.bartoman.sc26atlas';
const sdkAdb = process.env.ANDROID_HOME && path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb');
const adbBin = process.env.ADB || (sdkAdb && existsSync(sdkAdb) ? sdkAdb : 'adb');
const shotDir = process.argv[2] || '/tmp/sc26build/shots/emu';
mkdirSync(shotDir, { recursive: true });
const { chromium } = createRequire(path.join(pwDir, 'package.json'))('playwright-core');
const adb = (...a) => execFileSync(adbBin, a, { encoding: 'utf8', maxBuffer: 1 << 26 }).trim();
const shot = name => writeFileSync(path.join(shotDir, name + '.png'), execFileSync(adbBin, ['exec-out', 'screencap', '-p'], { maxBuffer: 1 << 26 }));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? '✓ ' : '✗ ') + name + (extra ? '  [' + extra + ']' : '')); if (!cond) failed++; };

async function attach() {
  const pid = adb('shell', 'pidof', pkg).split(/\s+/)[0];
  if (!pid) throw new Error(pkg + ' is not running');
  adb('forward', 'tcp:9222', 'localabstract:webview_devtools_remote_' + pid);
  const browser = await chromium.connectOverCDP('http://localhost:9222', { noDefaults: true });
  const page = browser.contexts().flatMap(c => c.pages())[0];
  return { browser, page };
}

// fresh start with a clean profile
adb('shell', 'am', 'force-stop', pkg);
adb('shell', 'pm', 'clear', pkg);
adb('shell', 'pm', 'grant', pkg, 'android.permission.POST_NOTIFICATIONS');
adb('shell', 'am', 'start', '-n', pkg + '/.MainActivity');
await sleep(5000);
let { browser, page } = await attach();
const errors = [];
const watch = p => {
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
};
watch(page);
await page.waitForFunction(() => document.documentElement.dataset.ready, null, { timeout: 30000 });
const boot = await page.evaluate(() => ({ ready: document.documentElement.dataset.ready, failed: window.SC26 && window.SC26.failedViews, ua: navigator.userAgent, bridge: !!window.AndroidBridge,
  sat: getComputedStyle(document.documentElement).getPropertyValue('--sat'), version: window.AndroidBridge && window.AndroidBridge.appVersion() }));
console.log('WebView: ' + (boot.ua.match(/Chrome\/[\d.]+/) || [''])[0] + ', app ' + boot.version);
ok('app starts inside the WebView', boot.ready === '1');
ok('every view module loads', boot.failed && boot.failed.length === 0, (boot.failed || []).join(','));
ok('native bridge is present', boot.bridge);
ok('status bar inset reaches the page', /px/.test(boot.sat), boot.sat);
ok('welcome sheet shows on first run', await page.locator('.sheet .welcome').count() === 1);
shot('01-welcome');
await page.locator('.sheet [data-act="sheet-close"]').first().click();
await sleep(500);

// pretend it is Wednesday morning of the conference
await page.evaluate(async () => { const c = await import('./js/core.js'); c.setSimTime('2026-11-18T10:40'); });
const go = async (h, wait = 900) => { await page.evaluate(x => { location.hash = x; }, h); await sleep(wait); };
await go('#/schedule'); await go('#/home', 1200);
shot('02-today');

const canvasInk = () => page.evaluate(() => {
  let best = 0;
  for (const c of document.querySelectorAll('#view canvas')) {
    try {
      const g = c.getContext('2d'); if (!g || !c.width) continue;
      const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0;
      for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 20 && (d[i - 1] + d[i - 2] + d[i - 3]) > 90) n++;
      best = Math.max(best, n);
    } catch (e) { /* tainted or webgl */ }
  }
  return best;
});
const screens = [
  ['#/home', 'Today', '.hero'], ['#/schedule?d=4', 'Schedule', '#sched-body .card.it'], ['#/schedule?d=4&v=grid', 'Schedule grid', '.sblock'],
  ['#/item/sess248', 'Keynote detail', '.d-title'], ['#/search?q=quantum', 'Search', '#s-items .card.it'], ['#/people', 'People', '#plist .row.person'],
  ['#/person/360143', 'Person', '.profile'], ['#/org/3', 'Organization', '.profile'], ['#/builder', 'Builder', '#b-themes .chip'],
  ['#/plan', 'My Plan', '.empty, .card.it'], ['#/explore', 'Explore', '.tile'], ['#/settings', 'Settings', '.sw'], ['#/posters', 'Posters', '.ptile'],
  ['#/galaxy', 'Galaxy', 'canvas'], ['#/themes', 'Themes', '#view svg, #view canvas'], ['#/theme/quantum', 'Theme page', '.card.it'], ['#/tag/0', 'Tag page', '.card.it'],
  ['#/heatmap', 'Topics by day', '#view'], ['#/formats', 'Formats', '#view svg, #view canvas'], ['#/pulse', 'Pulse', '#view svg, #view canvas'], ['#/buzz', 'Buzzwords', '#view [data-go*="search"]'],
  ['#/globe', 'Globe', 'canvas'], ['#/country/0', 'Country', '.row'], ['#/network', 'Network', 'canvas'], ['#/orgs', 'Organizations', '.row.org'],
  ['#/map', 'Venue map', '#view img, #view svg'], ['#/room/3', 'Room', '#view'],
];
let n = 3;
for (const [h, name, sel] of screens) {
  const before = errors.length;
  await go(h, /galaxy|globe|network|map/.test(h) ? 2600 : 1100);
  const info = await page.evaluate(s => ({ n: document.querySelectorAll(s).length, text: document.getElementById('view').innerText.length, hash: location.hash,
    broken: !!document.querySelector('#view .empty h3') && /went wrong/i.test(document.querySelector('#view .empty h3').textContent) }), sel);
  let extra = info.n + ' × ' + sel;
  let good = info.n > 0 && !info.broken && errors.length === before;
  if (/galaxy|globe|network/.test(h)) { const ink = await canvasInk(); extra += ', canvas samples lit: ' + ink; good = good && ink > 20; }
  ok(name + ' renders in the WebView', good, extra + (errors.length > before ? ' ERR ' + errors.slice(before).join(' | ').slice(0, 300) : ''));
  shot(String(n++).padStart(2, '0') + '-' + name.toLowerCase().replace(/[^a-z]+/g, '-'));
}

// ---- plan + persistence across a process kill
await go('#/item/sess248');
await page.locator('[data-act="d-plan"]').click(); await sleep(400);
ok('star adds to the plan', await page.evaluate(() => Object.keys(window.SC26.Store.state.plan).length) === 1);

// ---- native: share sheet
await page.locator('#top-actions [data-act="share-item"]').click(); await sleep(1800);
const top = adb('shell', 'dumpsys', 'activity', 'activities').split('\n').filter(l => /topResumedActivity|ResumedActivity/.test(l)).join(' ');
ok('share opens the Android share sheet', /Chooser|Resolver|intentresolver/i.test(top), top.trim().slice(0, 120));
shot(String(n++).padStart(2, '0') + '-share-sheet');
adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); await sleep(1200);

// ---- native: reminder for a session that has not started in real time
const future = await page.evaluate(() => { const it = window.SC26.DB.items.filter(x => x.k === 'S' && !x.brk && (x.s - 10) * 60000 > Date.now() + 120000).sort((a, b) => a.s - b.s)[0]; return it ? it.id : null; });
if (future) {
  await go('#/item/' + future);
  await page.locator('[data-act="d-remind"]').click(); await sleep(1200);
  const alarms = adb('shell', 'dumpsys', 'alarm');
  ok('reminder registers an alarm with Android', alarms.includes(pkg), future);
  ok('reminder state is saved', await page.evaluate(id => window.SC26.Store.state.reminders[id] === 10, future));
  await page.locator('[data-act="d-remind"]').click(); await sleep(800);
  ok('reminder can be removed', await page.evaluate(id => window.SC26.Store.state.reminders[id] == null, future));
} else console.log('· reminder check skipped: every session already started in real time');

// ---- native: back button walks the history, then leaves the app
// navigate the way taps do (through the router), so the history depth is tracked
const nav = async h => { await page.evaluate(async x => { (await import('./js/router.js')).go(x); }, h); await sleep(900); };
await nav('#/home'); await nav('#/schedule'); await nav('#/item/sess248');
adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); await sleep(900);
ok('back returns to the previous screen', (await page.evaluate(() => location.hash)).startsWith('#/schedule'));
adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); await sleep(900);
ok('back again returns to Today', (await page.evaluate(() => location.hash)).startsWith('#/home'));
const planBefore = await page.evaluate(() => Object.keys(window.SC26.Store.state.plan).sort().join(','));

// ---- data survives a cold restart
await browser.close();
adb('shell', 'am', 'force-stop', pkg);
adb('shell', 'am', 'start', '-n', pkg + '/.MainActivity');
await sleep(4500);
({ browser, page } = await attach()); watch(page);
await page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 30000 });
const planAfter = await page.evaluate(() => Object.keys(window.SC26.Store.state.plan).sort().join(','));
ok('plan survives a cold restart', planAfter === planBefore && planAfter.length > 0, planAfter);
ok('no welcome sheet on the second start', await page.locator('.sheet .welcome').count() === 0);
const t0 = await page.evaluate(() => performance.now());
console.log('· page had been alive ' + Math.round(t0) + ' ms when checked');

// ---- offline: airplane mode must not break anything
adb('shell', 'cmd', 'connectivity', 'airplane-mode', 'enable'); await sleep(1500);
await page.reload(); await page.waitForFunction(() => document.documentElement.dataset.ready, null, { timeout: 30000 });
await sleep(800);
ok('app starts in airplane mode', await page.evaluate(() => document.documentElement.dataset.ready === '1' && window.SC26.DB.items.length > 1000));
await page.evaluate(() => { location.hash = '#/search?q=exascale'; }); await sleep(1200);
ok('search works offline', await page.locator('#s-items .card.it').count() > 3);
adb('shell', 'cmd', 'connectivity', 'airplane-mode', 'disable');

const real = errors.filter(e => !/net::ERR_|Failed to load resource/.test(e));
ok('no script errors in the WebView', real.length === 0, real.slice(0, 4).join(' | ').slice(0, 500));
await browser.close();
console.log(failed ? failed + ' check(s) failed' : 'all checks passed');
console.log('screenshots: ' + shotDir);
process.exit(failed ? 1 : 0);
