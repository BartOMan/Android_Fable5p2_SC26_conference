// Browser test for the topic galaxy (#/galaxy). Prints one line per check and
// exits non-zero when any check fails.
//
// Usage (playwright-core lives outside the repo; the app must be served on port 8765):
//   NODE_PATH=/tmp/sc26build/webtest/node_modules node app/web/tests/test_galaxy.mjs [width=412] [height=915] [dpr=1]
//   NODE_PATH=/tmp/sc26build/webtest/node_modules node app/web/tests/test_galaxy.mjs 360
//
// Optional environment: GX_BASE (default http://127.0.0.1:8765/index.html), GX_PERF=0 to skip the timing run.
import { createRequire } from 'module';
const require = createRequire((process.env.NODE_PATH || '/tmp/sc26build/webtest/node_modules') + '/');
const { chromium } = require('playwright-core');

const WIDTH = +(process.argv[2] || 412), HEIGHT = +(process.argv[3] || 915), DPR = +(process.argv[4] || 1);
const BASE = (process.env.GX_BASE || 'http://127.0.0.1:8765/index.html') + '?now=2026-11-18T10:40';
const STORE_KEY = 'sc26atlas.v1';

let failed = 0, passed = 0;
function check(name, ok, detail = '') {
  if (ok) { passed++; console.log('ok   - ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { failed++; console.log('FAIL - ' + name + (detail ? '  [' + detail + ']' : '')); }
}
const note = (text) => console.log('note - ' + text);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const pageErrors = [];      // errors raised while the galaxy was on screen
const otherErrors = [];     // errors from other screens or from view modules that do not exist yet

async function open(hash, o = {}) {
  const ctx = await browser.newContext({
    viewport: { width: o.width || WIDTH, height: o.height || HEIGHT }, deviceScaleFactor: o.dpr || DPR, isMobile: true, hasTouch: true,
    reducedMotion: o.reduce ? 'reduce' : 'no-preference',
  });
  const page = await ctx.newPage();
  if (o.store) await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem('gx-seeded')) { localStorage.setItem(k, JSON.stringify(v)); sessionStorage.setItem('gx-seeded', '1'); } }, [STORE_KEY, o.store]);
  const record = (text) => {
    const url = page.url();
    const foreign = /Failed to load resource|404|view module failed|Failed to fetch dynamically imported module/.test(text) && !/galaxy/.test(text);
    (foreign || !/#\/galaxy/.test(url) ? otherErrors : pageErrors).push(text + '  @ ' + url.replace(/^.*#/, '#'));
  };
  page.on('console', m => { if (m.type() === 'error') record('console: ' + m.text()); });
  page.on('pageerror', e => record('pageerror: ' + e.message));
  await page.goto(BASE + hash);
  await page.waitForFunction(() => document.documentElement.dataset.ready, null, { timeout: 30000 });
  const first = await page.evaluate(() => { const r = document.querySelector('.gx-root'); return r && r.__gx ? r.__gx.state() : null; });
  if (!o.noSettle) await settle(page);
  return { ctx, page, first };
}
/** Wait until the entrance animation and any zoom flight have finished. */
async function settle(page, ms = 250) {
  await page.evaluate(() => { const r = document.querySelector('.gx-root'); if (r) delete r.dataset.testT; });
  await page.waitForFunction(() => {
    const r = document.querySelector('.gx-root');
    if (!r || !r.__gx || r.__gx.state().busy) return false;
    const t = r.__gx.transform(), key = t.k.toFixed(4) + '|' + t.x.toFixed(2) + '|' + t.y.toFixed(2);
    const same = r.dataset.testT === key; r.dataset.testT = key;
    return same;
  }, null, { timeout: 15000, polling: 220 });
  await page.waitForTimeout(ms);
}
const state = page => page.evaluate(() => document.querySelector('.gx-root').__gx.state());
const transform = page => page.evaluate(() => document.querySelector('.gx-root').__gx.transform());
const hashOf = page => page.evaluate(() => location.hash);
const countText = page => page.evaluate(() => document.querySelector('.gx-count').textContent.trim());
/** Coarse picture of the canvas: number of bright pixels, number of distinct colors, and a hash. */
const sample = page => page.evaluate(() => {
  const c = document.querySelector('.gx-canvas');
  const t = document.createElement('canvas'); t.width = c.width; t.height = c.height;
  const g = t.getContext('2d', { willReadFrequently: true });
  g.drawImage(c, 0, 0);
  const d = g.getImageData(0, 0, t.width, t.height).data;
  let bright = 0, hash = 0; const colors = new Set();
  for (let i = 0; i < d.length; i += 4) {
    if (Math.max(d[i], d[i + 1], d[i + 2]) > 110) bright++;
    colors.add(((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4));
    hash = (Math.imul(hash, 31) + d[i] * 3 + d[i + 1] * 5 + d[i + 2] * 7) >>> 0;
  }
  return { w: c.width, h: c.height, cssW: c.clientWidth, cssH: c.clientHeight, bright, colors: colors.size, hash };
});
const overlaps = (a, b) => a && b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const box = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return r.width && r.height ? { x: r.x, y: r.y, width: r.width, height: r.height } : null; }, sel);

/** Pick dots that are safe to tap: on the bare canvas and not crowded by other dots. */
const pickTargets = (page, minGap) => page.evaluate((minGap) => {
  const gx = document.querySelector('.gx-root').__gx, canvas = gx.canvas;
  const ids = gx.ids(); const pos = ids.map(id => gx.screenOf(id));
  const out = [];
  for (let i = 0; i < ids.length && out.length < 12; i++) {
    const [x, y] = pos[i];
    if (document.elementFromPoint(x, y) !== canvas) continue;
    let near = Infinity;
    for (let j = 0; j < ids.length; j++) if (j !== i) { const d = Math.hypot(pos[j][0] - x, pos[j][1] - y); if (d < near) near = d; }
    if (near < minGap) continue;
    const nb = gx.neighborsOf(ids[i]);
    if (nb.length >= 3) out.push({ id: ids[i], x, y, title: window.SC26.DB.byId.get(ids[i]).t, gap: near, neighbors: nb });
  }
  return out;
}, minGap);
/** A spot on the bare canvas with no dot within reach of a tap. */
const emptySpot = (page) => page.evaluate(() => {
  const gx = document.querySelector('.gx-root').__gx, canvas = gx.canvas, rc = canvas.getBoundingClientRect();
  const pos = gx.ids().map(id => gx.screenOf(id));
  for (let y = rc.top + 110; y < rc.bottom - 20; y += 12) for (let x = rc.left + 14; x < rc.right - 14; x += 12) {
    if (document.elementFromPoint(x, y) !== canvas) continue;
    if (pos.every(p => Math.hypot(p[0] - x, p[1] - y) > 44)) return { x, y };
  }
  return null;
});

// =============================================================== 1. render
{
  const { ctx, page, first } = await open('#/galaxy', { noSettle: true });
  check('view registers and mounts a canvas', !!first && first.total > 500, first ? first.total + ' dots' : 'no galaxy handle');
  check('entrance animation is running right after load', !!first && first.entering === true);
  await settle(page);
  const st = await state(page);
  check('entrance animation ends', st.entering === false && st.busy === false);
  const s = await sample(page);
  check('canvas is not blank', s.bright > 800 && s.colors > 60, s.bright + ' bright px, ' + s.colors + ' colors');
  check('canvas backing store follows the device pixel ratio (cap 2.5)', Math.abs(s.w - Math.round(s.cssW * Math.min(DPR, 2.5))) <= 1 && Math.abs(s.h - Math.round(s.cssH * Math.min(DPR, 2.5))) <= 1, s.w + 'x' + s.h + ' for ' + s.cssW + 'x' + s.cssH + ' css px');
  const view = await box(page, '#view');
  check('canvas fills the view between top bar and tabs', Math.abs(s.cssW - view.width) <= 1 && Math.abs(s.cssH - view.height) <= 1, s.cssW + 'x' + s.cssH);
  check('count shows all talks', (await countText(page)).replace(/\D/g, '') === String(st.total), await countText(page));
  check('title is "Topic galaxy" and the Explore tab is lit', await page.evaluate(() => document.getElementById('top-title').textContent === 'Topic galaxy' && document.querySelector('#tabs button.on').dataset.tab === 'explore'));

  // controls do not overlap each other and stay inside the screen
  const seg = await box(page, '.gx-seg'), cnt = await box(page, '.gx-count'), filters = await box(page, '.gx-filters'), pill = await box(page, '.gx-tools .gx-pill');
  check('mode control and count fit side by side', !!seg && !!cnt && !overlaps(seg, cnt) && cnt.x + cnt.width <= WIDTH + 0.5 && seg.x >= 0, 'seg ' + Math.round(seg.width) + ' px, count ends at ' + Math.round(cnt.x + cnt.width));
  check('filter row sits above the mode control', filters.y + filters.height <= seg.y + 0.5);
  check('Themes button is clear of the top controls', pill.y > seg.y + seg.height + 100);

  // ------------------------------------------------------ 2. color modes
  const hashes = { theme: s.hash };
  for (const m of ['format', 'day', 'me', 'theme']) {
    await page.tap('.gx-seg button[data-id="' + m + '"]');
    await page.waitForTimeout(250);
    const ms = await state(page), smp = await sample(page);
    const pressed = await page.evaluate(m => document.querySelector('.gx-seg button[data-id="' + m + '"]').getAttribute('aria-pressed'), m);
    if (m !== 'theme') hashes[m] = smp.hash;
    check('color mode "' + m + '" switches and draws', ms.mode === m && pressed === 'true' && smp.bright > 300, smp.bright + ' bright px');
    if (m === 'me') {
      const hint = await page.evaluate(() => { const h = document.querySelector('.gx-hint'); return h && !h.hidden ? { text: h.textContent, go: h.querySelector('[data-go]') && h.querySelector('[data-go]').dataset.go } : null; });
      check('"For me" without interests shows a hint with a button to the builder', !!hint && hint.go === '#/builder', hint ? hint.text.slice(0, 40) : 'no hint');
      check('"For me" is kept in the URL', /[?&]c=me\b/.test(await hashOf(page)), await hashOf(page));
    }
    if (m === 'format' || m === 'day') check('"' + m + '" mode shows a color key', await page.evaluate(() => { const k = document.querySelector('.gx-key'); return !k.hidden && k.children.length >= 4; }));
  }
  check('each color mode paints a different picture', new Set(Object.values(hashes)).size === 4);
  check('theme mode has no mode parameter in the URL', !/[?&]c=/.test(await hashOf(page)), await hashOf(page));

  // -------------------------------------------------- 3. zoom and pan
  const t0 = await transform(page);
  check('starts at the full view', Math.abs(t0.k - 1) < 1e-6 && Math.abs(t0.x) < 0.5 && Math.abs(t0.y) < 0.5);
  check('reset button is hidden at the full view', (await box(page, '.gx-reset')) === null);
  const cb = await box(page, '.gx-canvas');
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(250);
  const t1 = await transform(page);
  check('mouse wheel zooms in', t1.k > t0.k + 0.2, 'k ' + t0.k.toFixed(2) + ' -> ' + t1.k.toFixed(2));
  await page.evaluate(() => document.querySelector('.gx-root').__gx.setTransform(1, 0, 0));
  // pinch with two fingers through the DevTools protocol
  const cdp = await ctx.newCDPSession(page);
  const cx = cb.x + cb.width / 2, cy = cb.y + cb.height / 2;
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i, radiusX: 4, radiusY: 4, force: 1 })) });
  await touch('touchStart', [[cx - 30, cy], [cx + 30, cy]]);
  for (let i = 1; i <= 8; i++) { await touch('touchMove', [[cx - 30 - i * 10, cy], [cx + 30 + i * 10, cy]]); await page.waitForTimeout(16); }
  await touch('touchEnd', []);
  await page.waitForTimeout(250);
  const t2 = await transform(page);
  check('pinch zooms in', t2.k > 2, 'k ' + t2.k.toFixed(2));
  check('pinch does not select anything', (await state(page)).sel === null);
  // one-finger drag pans and is not taken for a tap
  await touch('touchStart', [[cx, cy]]);
  for (let i = 1; i <= 8; i++) { await touch('touchMove', [[cx + i * 9, cy + i * 6]]); await page.waitForTimeout(16); }
  await touch('touchEnd', []);
  await page.waitForTimeout(250);
  const t3 = await transform(page);
  check('one-finger drag pans the map', Math.abs(t3.x - t2.x) > 40 && Math.abs(t3.y - t2.y) > 25 && Math.abs(t3.k - t2.k) < 0.01, 'dx ' + (t3.x - t2.x).toFixed(0) + ', dy ' + (t3.y - t2.y).toFixed(0));
  check('a drag is not taken for a tap', (await state(page)).sel === null);
  // double tap zooms in around the finger (d3's built-in gesture)
  await page.evaluate(() => document.querySelector('.gx-root').__gx.setTransform(1, 0, 0));
  const dt = await emptySpot(page);
  if (dt) { await touch('touchStart', [[dt.x, dt.y]]); await touch('touchEnd', []); await page.waitForTimeout(90); await touch('touchStart', [[dt.x, dt.y]]); await touch('touchEnd', []); }
  await page.waitForTimeout(600); await settle(page);
  const tdt = await transform(page);
  check('double tap zooms in', !!dt && Math.abs(tdt.k - 2) < 0.05 && (await state(page)).sel === null, 'k ' + tdt.k.toFixed(2));
  await page.evaluate(() => document.querySelector('.gx-root').__gx.setTransform(16, -3000, -5000));
  const t4 = await transform(page);
  check('programmatic zoom changes the transform', Math.abs(t4.k - 16) < 1e-6);
  check('reset button appears after zooming', (await box(page, '.gx-reset')) !== null);
  await page.mouse.wheel(0, -2000); await page.waitForTimeout(200);
  check('zoom stops at 16x', (await transform(page)).k <= 16.0001, 'k ' + (await transform(page)).k.toFixed(2));
  await page.tap('.gx-reset');
  await settle(page);
  const t5 = await transform(page);
  check('reset returns to the full view', Math.abs(t5.k - 1) < 0.01 && Math.abs(t5.x) < 1 && Math.abs(t5.y) < 1, 'k ' + t5.k.toFixed(2));
  await page.mouse.wheel(0, 3000); await page.waitForTimeout(200);
  check('zoom stops at 1x', (await transform(page)).k >= 0.9999);

  // ----------------------------------------- 4. tap, card, neighbors, open
  const targets = await pickTargets(page, 7);
  check('found isolated dots to tap', targets.length > 0, targets.length + ' candidates');
  const A = targets[0];
  await page.touchscreen.tap(A.x, A.y);
  await page.waitForTimeout(500);
  await settle(page);
  let st2 = await state(page);
  check('tapping a dot selects it', st2.sel === A.id, 'wanted ' + A.id + ', got ' + st2.sel);
  const card = await page.evaluate(() => {
    const c = document.querySelector('.gx-card'); if (!c) return null;
    return { title: c.querySelector('.gx-card-title').textContent, pill: !!c.querySelector('.pill'), time: (c.querySelector('.time') || {}).textContent || '', loc: c.querySelector('.gx-card-loc').textContent,
      star: (c.querySelector('.star') || { dataset: {} }).dataset.id, open: (c.querySelector('.gx-open') || { dataset: {} }).dataset.go, overlay: c.classList.contains('overlay-card') };
  });
  check('card shows the real title', !!card && card.title === A.title && card.title.length > 3, card ? card.title.slice(0, 50) : 'no card');
  check('card has format pill, day and time, room, star and Open', !!card && card.pill && /\d{1,2}:\d\d/.test(card.time) && /(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d+/.test(card.time) && card.loc.length > 0 && card.star === A.id && card.open === '#/item/' + A.id && card.overlay, card ? card.time + ' | ' + card.loc : '');
  check('selection is kept in the URL (encoded id)', (await hashOf(page)).includes('it=' + encodeURIComponent(A.id)), await hashOf(page));
  const cardBox = await box(page, '.gx-card'), pillBox = await box(page, '.gx-tools .gx-pill'), segBox = await box(page, '.gx-seg');
  check('card does not cover the buttons or the top controls', !overlaps(cardBox, pillBox) && !overlaps(cardBox, segBox) && !overlaps(pillBox, segBox) && cardBox.x >= 0 && cardBox.x + cardBox.width <= WIDTH + 0.5);
  const dotA = await page.evaluate(id => document.querySelector('.gx-root').__gx.screenOf(id), A.id);
  check('selected dot stays visible above the card', dotA[1] < cardBox.y - 8 && dotA[1] > segBox.y + segBox.height, 'dot y ' + Math.round(dotA[1]) + ', card top ' + Math.round(cardBox.y));

  // star from the card
  await page.tap('.gx-card .star');
  await page.waitForTimeout(200);
  check('star button adds the talk to the plan', await page.evaluate(([k, id]) => Object.prototype.hasOwnProperty.call(JSON.parse(localStorage.getItem(k) || '{}').plan || {}, id), [STORE_KEY, A.id]) && await page.evaluate(() => document.querySelector('.gx-card .star').classList.contains('on')));

  const toastBox = await box(page, '#toast'), cardNow = await box(page, '.gx-card');
  check('the "Added to My Plan" toast does not cover the card', !!toastBox && !overlaps(toastBox, cardNow) && await page.evaluate(() => document.getElementById('toast').classList.contains('show')), toastBox ? 'toast at y ' + Math.round(toastBox.y) + ', card from y ' + Math.round(cardNow.y) : 'no toast');

  // hop to a linked neighbor: zoom in around A so the neighbors are easy to hit
  const hop = await page.evaluate((A) => {
    const gx = document.querySelector('.gx-root').__gx, canvas = gx.canvas;
    const ids = gx.ids();
    for (const k of [6, 4, 9, 3, 12, 2]) {
      const t = gx.transform(); const p = gx.screenOf(A.id); const rc = canvas.getBoundingClientRect();
      const wx = (p[0] - rc.left - t.x) / t.k, wy = (p[1] - rc.top - t.y) / t.k;      // A in zoom-1 coordinates
      const s = gx.state();
      gx.setTransform(k, s.width / 2 - wx * k, s.height * 0.4 - wy * k);
      const pos = ids.map(id => gx.screenOf(id));
      for (const n of A.neighbors) {
        const [x, y] = gx.screenOf(n);
        if (document.elementFromPoint(x, y) !== canvas) continue;
        let near = Infinity; ids.forEach((id, j) => { if (id !== n) near = Math.min(near, Math.hypot(pos[j][0] - x, pos[j][1] - y)); });
        if (near > 9) return { id: n, x, y, k };
      }
    }
    return null;
  }, A);
  check('a linked neighbor is reachable on screen', !!hop, hop ? 'at ' + hop.k + 'x' : 'none');
  if (hop) {
    await page.waitForTimeout(150);
    await page.touchscreen.tap(hop.x, hop.y);
    await page.waitForTimeout(500); await settle(page);
    st2 = await state(page);
    check('tapping a neighbor selects it', st2.sel === hop.id, 'wanted ' + hop.id + ', got ' + st2.sel);
    check('card follows the selection', await page.evaluate(id => document.querySelector('.gx-card-title').textContent === window.SC26.DB.byId.get(id).t, hop.id));
  }
  // empty space clears
  await page.evaluate(() => document.querySelector('.gx-root').__gx.setTransform(1, 0, 0));
  await page.waitForTimeout(150);
  const spot = await emptySpot(page);
  check('found empty space to tap', !!spot);
  if (spot) {
    await page.touchscreen.tap(spot.x, spot.y);
    await page.waitForTimeout(400);
    check('tapping empty space clears the selection', (await state(page)).sel === null && (await box(page, '.gx-card')) === null && !/[?&]it=/.test(await hashOf(page)));
  }
  // a mouse click selects too (desktop browsers)
  await page.mouse.click(A.x, A.y);
  await page.waitForTimeout(500); await settle(page);
  check('a mouse click selects a dot as well', (await state(page)).sel === A.id);
  // the close button on the card
  await page.tap('.gx-card-x'); await page.waitForTimeout(200);
  check('the card close button clears the selection', (await state(page)).sel === null);

  // Open and Back
  await page.evaluate(() => document.querySelector('.gx-root').__gx.setTransform(1, 0, 0));
  await page.touchscreen.tap(A.x, A.y);
  await page.waitForTimeout(500); await settle(page);
  await page.evaluate(() => { const gx = document.querySelector('.gx-root').__gx, t = gx.transform(); gx.setTransform(2.5, t.x * 2.5 - 100, t.y * 2.5 - 300); });
  await page.waitForTimeout(200);
  const tBefore = await transform(page);
  await page.tap('.gx-open');
  await page.waitForTimeout(700);
  const itemHash = await hashOf(page);
  check('Open goes to the item page', itemHash === '#/item/' + A.id, itemHash);
  check('leaving the galaxy removes its canvas', await page.evaluate(() => !document.querySelector('.gx-canvas')));
  await page.goBack();
  await page.waitForFunction(() => { const r = document.querySelector('.gx-root'); return r && r.__gx; }, null, { timeout: 10000 });
  await settle(page);
  const stBack = await state(page), tBack = await transform(page);
  check('Back restores the selection', stBack.sel === A.id && (await hashOf(page)).includes('it=' + encodeURIComponent(A.id)), await hashOf(page));
  check('Back restores the zoom', Math.abs(tBack.k - tBefore.k) < 0.01 && Math.abs(tBack.x - tBefore.x) < 1 && Math.abs(tBack.y - tBefore.y) < 1, 'k ' + tBack.k.toFixed(2));
  await page.tap('.gx-card-x'); await page.waitForTimeout(150);
  await page.tap('.gx-reset'); await settle(page);

  // ------------------------------------------------------- 5. filters
  const total = (await state(page)).total;
  const dayChips = await page.evaluate(() => Array.from(document.querySelectorAll('.gx-chips [data-act="gx-day"]')).map(b => ({ id: b.dataset.id, label: b.textContent })));
  check('day chips: All, then each day with talks', dayChips.length >= 3 && dayChips[0].id === '' && dayChips.slice(1).every(c => /^\d+$/.test(c.id)), dayChips.map(c => c.label).join(' | '));
  const expectDay = await page.evaluate(d => { const gx = document.querySelector('.gx-root').__gx; return gx.ids().filter(id => window.SC26.DB.byId.get(id).day === d).length; }, +dayChips[1].id);
  await page.tap('.gx-chips [data-act="gx-day"][data-id="' + dayChips[1].id + '"]');
  await page.waitForTimeout(250);
  let fs = await state(page);
  check('day filter changes the match count', fs.match === expectDay && fs.match > 0 && fs.match < total, fs.match + ' of ' + total);
  check('count label shows "n of total"', (await countText(page)).replace(/,/g, '') === fs.match + ' of ' + total, await countText(page));
  check('day filter is kept in the URL', new RegExp('[?&]d=' + dayChips[1].id + '\\b').test(await hashOf(page)), await hashOf(page));
  const dimmed = await sample(page);
  check('filtered-out dots are dimmed, not removed', dimmed.bright < s.bright * 0.9 && dimmed.bright > 50 && (await state(page)).total === total, dimmed.bright + ' bright px (was ' + s.bright + ')');

  // format sheet
  await page.tap('.gx-chips [data-act="gx-format"]');
  await page.waitForSelector('.sheet-wrap.open .gx-opt');
  const fopts = await page.evaluate(() => Array.from(document.querySelectorAll('.sheet .gx-opt')).map(b => ({ id: b.dataset.id, n: +b.querySelector('b').textContent.replace(/\D/g, ''), name: b.querySelector('span').textContent })));
  check('format sheet lists formats with counts', fopts.length >= 5 && fopts[0].id === '' && fopts.slice(1).reduce((a, f) => a + f.n, 0) === total, fopts.slice(1, 5).map(f => f.name + ' ' + f.n).join(', '));
  await page.tap('.sheet .gx-opt[data-id="' + fopts[1].id + '"]');
  await page.waitForTimeout(450);
  fs = await state(page);
  check('picking a format filters and closes the sheet', fs.fmt === fopts[1].id && fs.match > 0 && fs.match < expectDay && await page.evaluate(() => !document.querySelector('.sheet-wrap.open')), fs.match + ' match day + ' + fopts[1].name);
  check('format chip shows the chosen format', await page.evaluate(n => document.querySelector('.gx-chips [data-act="gx-format"]').textContent.includes(n), fopts[1].name));
  await page.tap('.gx-chips [data-act="gx-day"][data-id=""]'); await page.waitForTimeout(200);
  fs = await state(page);
  check('"All days" clears the day filter', fs.day === null && fs.match === fopts[1].n, fs.match + ' ' + fopts[1].name);
  await page.tap('.gx-chips [data-act="gx-format"]'); await page.waitForSelector('.sheet-wrap.open .gx-opt');
  await page.tap('.sheet .gx-opt[data-id=""]'); await page.waitForTimeout(450);
  check('"All formats" clears the format filter', (await state(page)).match === total);

  // my plan rings (A was starred above)
  const beforePlan = await sample(page);
  await page.tap('.gx-chips [data-act="gx-plan"]'); await page.waitForTimeout(300);
  fs = await state(page);
  const withPlan = await sample(page);
  check('"My plan" rings planned talks', fs.plan === true && fs.planRings >= 1 && withPlan.hash !== beforePlan.hash && /plan=1/.test(await hashOf(page)), fs.planRings + ' ringed');
  check('"My plan" does not change the match count', fs.match === total);
  await page.tap('.gx-chips [data-act="gx-plan"]'); await page.waitForTimeout(200);

  // search field
  await page.tap('.gx-search input');
  await page.keyboard.type('quantum', { delay: 20 });
  await page.waitForTimeout(600);
  fs = await state(page);
  check('typing in the search field dims non-matches', fs.q === 'quantum' && fs.match > 3 && fs.match < total && /[?&]q=quantum\b/.test(await hashOf(page)), fs.match + ' match "quantum"');
  check('search matches come from searchItems', await page.evaluate(async () => {
    const { searchItems } = await import('./js/core.js'); const gx = document.querySelector('.gx-root').__gx;
    const want = new Set(searchItems('quantum', { limit: 5000 }).map(r => r.it.id)); const all = new Set(gx.ids());
    const lit = gx.litIds(); return lit.length === Array.from(want).filter(id => all.has(id)).length && lit.every(id => want.has(id));
  }));
  // the on-screen keyboard makes the view shorter while the field has focus: the map must stay put
  const kb0 = await page.evaluate(id => ({ p: document.querySelector('.gx-root').__gx.screenOf(id), focus: document.activeElement === document.querySelector('.gx-search input') }), A.id);
  await page.setViewportSize({ width: WIDTH, height: HEIGHT - 320 });
  await page.waitForTimeout(400);
  const kb1 = await page.evaluate(id => ({ p: document.querySelector('.gx-root').__gx.screenOf(id), h: document.querySelector('.gx-canvas').clientHeight, view: document.getElementById('view').clientHeight }), A.id);
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await page.waitForTimeout(400);
  const kb2 = await page.evaluate(id => document.querySelector('.gx-root').__gx.screenOf(id), A.id);
  check('a shorter view while typing (keyboard) does not move the map', kb0.focus && kb1.h === kb1.view && Math.hypot(kb1.p[0] - kb0.p[0], kb1.p[1] - kb0.p[1]) < 0.5 && Math.hypot(kb2[0] - kb0.p[0], kb2[1] - kb0.p[1]) < 0.5, 'canvas ' + kb1.h + ' px tall with the keyboard up');
  await page.tap('.gx-qx'); await page.waitForTimeout(300);
  check('clearing the search restores all talks', (await state(page)).match === total && !/[?&]q=/.test(await hashOf(page)) && await page.evaluate(() => document.querySelector('.gx-search input').value === ''));
  await page.evaluate(() => document.activeElement && document.activeElement.blur());

  // -------------------------------------------------- 6. themes legend
  await page.tap('[data-act="gx-legend"]');
  await page.waitForSelector('.sheet-wrap.open .gx-opt');
  const topts = await page.evaluate(() => Array.from(document.querySelectorAll('.sheet .gx-opt')).map(b => ({ id: b.dataset.id, n: +b.querySelector('b').textContent.replace(/\D/g, ''), name: b.querySelector('span').textContent, dot: getComputedStyle(b.querySelector('i')).backgroundColor })));
  const nThemes = await page.evaluate(() => window.SC26.DB.themes.length);
  check('legend sheet lists every theme with a color dot and a count', topts.length === nThemes + 1 && topts.slice(1).every(t => t.n > 0 && /rgb/.test(t.dot)) && new Set(topts.slice(1).map(t => t.dot)).size >= nThemes - 2, (topts.length - 1) + ' themes');
  const pickT = topts[6];
  const beforeTheme = await sample(page), tPre = await transform(page);
  await page.tap('.sheet .gx-opt[data-id="' + pickT.id + '"]');
  await page.waitForTimeout(400); await settle(page);
  fs = await state(page);
  const tTheme = await transform(page), afterTheme = await sample(page);
  check('picking a theme highlights it', fs.theme === pickT.id && fs.match === pickT.n && fs.match < total, pickT.name + ': ' + fs.match);
  check('picking a theme flies to its dots', tTheme.k > tPre.k + 0.3 && afterTheme.hash !== beforeTheme.hash, 'k ' + tTheme.k.toFixed(2));
  check('most of the theme is on screen after the flight', await page.evaluate(() => {
    const gx = document.querySelector('.gx-root').__gx, rc = gx.canvas.getBoundingClientRect();
    const pos = gx.litIds().map(id => gx.screenOf(id));
    return pos.filter(p => p[0] > rc.left && p[0] < rc.right && p[1] > rc.top + 90 && p[1] < rc.bottom - 50).length >= pos.length * 0.8;
  }));
  check('theme is kept in the URL and named on the button', new RegExp('[?&]theme=' + pickT.id + '\\b').test(await hashOf(page)) && await page.evaluate(n => document.querySelector('.gx-pill-main').textContent.includes(n), pickT.name), await hashOf(page));
  const pm = await box(page, '.gx-tools .gx-pill'), rs = await box(page, '.gx-reset');
  check('theme button and reset button do not overlap', !!rs && !overlaps(pm, rs) && rs.x + rs.width <= WIDTH + 0.5, 'pill ' + Math.round(pm.width) + ' px');
  await page.tap('.gx-reset'); await settle(page);
  fs = await state(page); const tR = await transform(page);
  check('reset clears the theme and returns to the full view', fs.theme === null && fs.match === total && Math.abs(tR.k - 1) < 0.01 && !/theme=/.test(await hashOf(page)));
  await ctx.close();
}

// ============================================================ 7. deep links
{
  const themeId = 'quantum';
  const { ctx, page } = await open('#/galaxy?theme=' + themeId);
  const st = await state(page), t = await transform(page);
  const want = await page.evaluate(id => { const DB = window.SC26.DB, ti = DB.themeIdx[id], gx = document.querySelector('.gx-root').__gx; return gx.ids().filter(i => { const it = DB.byId.get(i); return it.th.length && it.th[0][0] === ti; }).length; }, themeId);
  check('?theme=<id> highlights the theme', st.theme === themeId && st.match === want && want > 0, st.match + ' dots');
  check('?theme=<id> zooms to the theme', t.k > 1.5, 'k ' + t.k.toFixed(2));
  await ctx.close();
}
{
  const { ctx: c0, page: p0 } = await open('#/galaxy');
  const ids = await p0.evaluate(() => document.querySelector('.gx-root').__gx.ids().filter(id => id.includes('/')));
  await c0.close();
  const id = ids[Math.floor(ids.length / 2)];
  check('item ids contain a slash', !!id, id);
  const { ctx, page } = await open('#/galaxy?it=' + encodeURIComponent(id));
  const st = await state(page), t = await transform(page);
  check('?it=<encoded id> selects the item', st.sel === id, st.sel || 'nothing selected');
  check('?it=<encoded id> shows its card', await page.evaluate(id => { const c = document.querySelector('.gx-card-title'); return !!c && c.textContent === window.SC26.DB.byId.get(id).t; }, id));
  const p = await page.evaluate(id => document.querySelector('.gx-root').__gx.screenOf(id), id);
  const cardBox = await box(page, '.gx-card'), seg = await box(page, '.gx-seg');
  check('?it=<encoded id> zooms to the item', t.k > 2 && p[0] > 20 && p[0] < WIDTH - 20 && p[1] > seg.y + seg.height && p[1] < cardBox.y, 'k ' + t.k.toFixed(2) + ', dot at ' + Math.round(p[0]) + ',' + Math.round(p[1]));
  await ctx.close();
  const { ctx: c2, page: p2 } = await open('#/galaxy?it=' + id);       // the same id, not encoded
  check('?it=<id> also works without encoding', (await state(p2)).sel === id);
  await c2.close();
  const { ctx: c3, page: p3 } = await open('#/galaxy?it=nope%2Fnothing');
  check('an unknown ?it= is ignored without errors', (await state(p3)).sel === null);
  await c3.close();
}
{
  const { ctx, page } = await open('#/galaxy?q=' + encodeURIComponent('machine learning'));
  const st = await state(page);
  check('?q=<text> dims everything but the matches', st.q === 'machine learning' && st.match > 0 && st.match < st.total, st.match + ' of ' + st.total);
  check('?q=<text> fills the search field', await page.evaluate(() => document.querySelector('.gx-search input').value === 'machine learning'));
  await ctx.close();
}
{
  const { ctx, page } = await open('#/galaxy?c=day&d=4&f=paper&plan=1');
  const st = await state(page);
  check('mode, day, format and plan are restored from the URL', st.mode === 'day' && st.day === 4 && st.fmt === 'paper' && st.plan === true && st.match > 0 && st.match < st.total, JSON.stringify({ mode: st.mode, day: st.day, fmt: st.fmt, match: st.match }));
  await ctx.close();
}

// ================================================= 8. interests and "For me"
{
  const store = { interests: { themes: ['quantum', 'llm'], tags: [], keywords: ['compression'], formats: [] } };
  const { ctx, page } = await open('#/galaxy?c=me', { store });
  const st = await state(page);
  const info = await page.evaluate(() => ({ hint: !document.querySelector('.gx-hint').hidden, key: !document.querySelector('.gx-key').hidden && document.querySelector('.gx-key').textContent }));
  const smp = await sample(page);
  check('"For me" with saved interests draws by relevance and hides the hint', st.mode === 'me' && !info.hint && /match/i.test(info.key || '') && smp.bright > 200, smp.bright + ' bright px');
  await ctx.close();
}

// ================================================ 9. reduced motion, resize
{
  const { ctx, page, first } = await open('#/galaxy?theme=quantum', { reduce: true, noSettle: true });
  const t = await transform(page);
  check('prefers-reduced-motion skips the entrance and the flight', !!first && first.entering === false && first.busy === false && t.k > 1.5, 'k ' + t.k.toFixed(2) + ' at once');
  await ctx.close();
}
{
  const { ctx, page } = await open('#/galaxy');
  const s0 = await sample(page);
  await page.setViewportSize({ width: HEIGHT, height: WIDTH });       // rotate to landscape
  await page.waitForTimeout(500); await settle(page);
  const s1 = await sample(page), view = await box(page, '#view');
  check('rotation resizes the canvas', Math.abs(s1.cssW - view.width) <= 1 && Math.abs(s1.cssH - view.height) <= 1 && Math.abs(s1.w - Math.round(view.width * Math.min(DPR, 2.5))) <= 1 && s1.bright > 200 && s1.w !== s0.w, s1.w + 'x' + s1.h);
  const tg = await pickTargets(page, 4);
  if (tg.length) { await page.touchscreen.tap(tg[0].x, tg[0].y); await page.waitForTimeout(500); await settle(page); }
  check('taps still hit the right dot after rotation', tg.length > 0 && (await state(page)).sel === tg[0].id);
  const cardBox = await box(page, '.gx-card'), seg = await box(page, '.gx-seg'), pill = await box(page, '.gx-tools .gx-pill'), fl = await box(page, '.gx-filters');
  check('landscape: card, buttons and top controls do not overlap', !!cardBox && !overlaps(cardBox, seg) && !overlaps(cardBox, pill) && !overlaps(pill, seg) && !overlaps(cardBox, fl) && !overlaps(pill, fl), cardBox ? 'card ' + Math.round(cardBox.width) + 'x' + Math.round(cardBox.height) : 'no card');
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  await page.waitForTimeout(500); await settle(page);
  const s2 = await sample(page);
  check('rotating back restores the portrait canvas', s2.w === s0.w && s2.h === s0.h && s2.bright > 300);

  // ------------------------------------------------------- 10. cleanup
  const clean = await page.evaluate(async () => {
    const root = document.querySelector('.gx-root'), gx = root.__gx, canvas = gx.canvas;
    const before = gx.stats().frames;
    document.querySelector('#tabs [data-tab="home"]').click();
    await new Promise(r => setTimeout(r, 400));
    const gone = !document.body.contains(canvas) && root.__gx === null;
    // after cleanup neither zooming nor a resize may draw again
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -200, bubbles: true, cancelable: true }));
    window.dispatchEvent(new Event('resize'));
    await new Promise(r => setTimeout(r, 300));
    return { gone, frames: gx.stats().frames - before, zoomListeners: !!window.d3.select(canvas).on('wheel.zoom'), bodyClass: document.body.classList.contains('gx-on'), hash: location.hash };
  });
  check('cleanup detaches the view', clean.gone && clean.hash === '#/home' && clean.zoomListeners === false && clean.bodyClass === false, JSON.stringify(clean));
  check('nothing draws after cleanup', clean.frames <= 1, clean.frames + ' frames after leaving');
  await ctx.close();
}

// ============================================= 10b. slow-phone safety net
{
  const { ctx, page } = await open('#/galaxy', { dpr: 2.625 });
  const d0 = (await state(page)).dpr;
  const dGood = await page.evaluate(() => document.querySelector('.gx-root').__gx.feedFrames(16.7, 200));
  const dBlip = await page.evaluate(() => { const gx = document.querySelector('.gx-root').__gx; gx.feedFrames(40, 10); return gx.feedFrames(16.7, 30); });
  check('pixel density stays at the cap while frames are fast (a short hiccup does not count)', d0 === 2.5 && dGood === 2.5 && dBlip === 2.5, 'dpr ' + d0);
  const d1 = await page.evaluate(() => document.querySelector('.gx-root').__gx.feedFrames(40, 30));
  await page.waitForTimeout(250);
  const s1 = await sample(page);
  check('sustained slow panning lowers the canvas pixel density', d1 === 1.75 && Math.abs(s1.w - Math.round(s1.cssW * 1.75)) <= 1 && s1.bright > 800, 'dpr 2.5 -> ' + d1 + ', canvas ' + s1.w + 'x' + s1.h);
  const tg = await pickTargets(page, 7);
  if (tg.length) { await page.touchscreen.tap(tg[0].x, tg[0].y); await page.waitForTimeout(500); await settle(page); }
  check('taps still hit the right dot at the lower density', tg.length > 0 && (await state(page)).sel === tg[0].id);
  const d2 = await page.evaluate(() => document.querySelector('.gx-root').__gx.feedFrames(34, 200));
  check('a 30 frames-per-second display does not push the density down further', d2 === 1.75, 'dpr ' + d2);
  const d3 = await page.evaluate(() => { const gx = document.querySelector('.gx-root').__gx; gx.feedFrames(60, 40); return gx.feedFrames(60, 200); });
  check('very slow panning lowers it once more and then stops at 1.25', d3 === 1.25, 'dpr ' + d3);
  await ctx.close();
}

// ============================================================== 11. timing
if (process.env.GX_PERF !== '0') {
  const run = async (label, dpr, throttle) => {
    const { ctx, page } = await open('#/galaxy', { dpr });
    const cdp = await ctx.newCDPSession(page);
    if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    const r = await page.evaluate(async () => {
      const gx = document.querySelector('.gx-root').__gx, s = gx.state();
      const loop = (n) => new Promise((res) => {
        const dt = []; let i = 0, last = 0;
        const step = (ts) => {
          if (i > 0) dt.push(ts - last);
          last = ts;
          if (i >= n) return res(dt);
          const a = (i / n) * Math.PI * 2, k = 2.6 + 1.4 * Math.sin(a * 2);
          gx.setTransform(k, s.width / 2 - k * (s.width * 0.5 + 70 * Math.cos(a)), s.height / 2 - k * (s.height * 0.5 + 90 * Math.sin(a)));
          i++; requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
      await loop(10);                 // warm up
      gx.resetStats();
      const dt = await loop(60);
      const st = gx.stats();
      dt.sort((a, b) => a - b);
      const q = p => dt[Math.min(dt.length - 1, Math.floor(dt.length * p))];
      return { n: dt.length, avg: dt.reduce((a, b) => a + b, 0) / dt.length, med: q(0.5), p95: q(0.95), max: dt[dt.length - 1], drawAvg: st.avg, drawMax: st.max, frames: st.frames, w: gx.canvas.width, h: gx.canvas.height };
    });
    note('timing ' + label + ': 60 zoom+pan transforms on a ' + r.w + 'x' + r.h + ' canvas: frame interval avg ' + r.avg.toFixed(1) + ' ms, median ' + r.med.toFixed(1) + ', p95 ' + r.p95.toFixed(1) + ', max ' + r.max.toFixed(1) +
      '; draw() script time avg ' + r.drawAvg.toFixed(2) + ' ms, max ' + r.drawMax.toFixed(2) + ' (' + r.frames + ' frames drawn)');
    await ctx.close();
    return r;
  };
  const a = await run('dpr ' + DPR, DPR, 1);
  const b = await run('dpr 2.625 (canvas capped at 2.5)', 2.625, 1);
  const c = await run('dpr 2.625, CPU slowed 4x', 2.625, 4);
  check('every transform is drawn while panning', a.frames >= 58 && b.frames >= 58, a.frames + ' and ' + b.frames + ' frames for 60 transforms');
  check('panning keeps up with the display (median frame under 20 ms, draw script under 8 ms)', a.med < 20 && b.med < 20 && a.drawAvg < 8 && b.drawAvg < 8, 'median ' + a.med.toFixed(1) + ' / ' + b.med.toFixed(1) + ' ms');
  check('panning stays smooth with the CPU slowed 4x (median frame under 34 ms)', c.med < 34, 'median ' + c.med.toFixed(1) + ' ms, draw avg ' + c.drawAvg.toFixed(2) + ' ms');
}

// ============================================================== 12. errors
check('no page errors on the galaxy', pageErrors.length === 0, pageErrors.slice(0, 5).join(' || '));
if (otherErrors.length) {
  const uniq = Array.from(new Set(otherErrors.map(e => e.replace(/\s+@ .*$/, '')))).filter(e => !/^console: Failed to load resource/.test(e));
  note('ignored ' + otherErrors.length + ' console messages from other screens or missing view modules: ' + uniq.slice(0, 4).join(' || '));
}

await browser.close();
console.log('\n' + (failed ? 'FAILED' : 'PASSED') + ': ' + passed + ' ok, ' + failed + ' failed  (viewport ' + WIDTH + 'x' + HEIGHT + ', dpr ' + DPR + ')');
process.exit(failed ? 1 : 0);
