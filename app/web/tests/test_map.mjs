// Checks the venue map (#/map) and the room page (#/room) in headless Chrome at phone size.
//
// Usage (playwright-core lives outside the repo; the app must be served on 127.0.0.1:8765):
//   python3 -m http.server 8765 --bind 127.0.0.1 --directory app/web/www &
//   NODE_PATH=/tmp/sc26build/webtest/node_modules node app/web/tests/test_map.mjs [width] [height]
//   SC26_SHOTS=/tmp/sc26build/shots ...   also saves a screenshot of the main screens in that folder
//   SC26_PAGE=index.html ...              tests another entry page (default index.html)
//
// The whole suite runs at [width] x [height] (default 412 x 915); the layout checks then run
// again at 360 x 740. Prints one line per check. Exit codes: 0 all passed, 1 a check failed.
// Expected values are worked out from window.SC26.DB and the helpers in js/core.js at the
// simulated time below.
import { createRequire } from 'module';
const require = createRequire((process.env.NODE_PATH || '/tmp/sc26build/webtest/node_modules') + '/');
const { chromium } = require('playwright-core');

const W = +(process.argv[2] || 412), H = +(process.argv[3] || (W < 400 ? 740 : 915)), MID = W / 2;
const BASE = process.env.SC26_BASE || 'http://127.0.0.1:8765/' + (process.env.SC26_PAGE || 'index.html');
const SHOTS = process.env.SC26_SHOTS || '';
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: SHOTS + '/map_' + name + '_' + page.viewportSize().width + '.png' }); };
const NOW = '2026-11-18T10:40';        // Wednesday of the conference, mid-morning

let failures = 0, checks = 0;
function check(name, ok, detail = '') {
  checks++;
  if (ok) console.log('ok   - ' + name);
  else { failures++; console.log('FAIL - ' + name + (detail ? '  [' + detail + ']' : '')); }
}
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));
const norm = s => (s || '').replace(/\s+/g, ' ').trim();

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
async function newPage(width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  // Other engineers' view modules may not exist yet: their 404s are not this test's business.
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/status of 404/.test(t)) return;
    if (/view module failed: (?!map\b)/.test(t)) return;
    errors.push('console: ' + t);
  });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('requestfailed', r => { if (/\/(map|data)\/|views\/map\.js|css\/map\.css/.test(r.url())) errors.push('requestfailed: ' + r.url()); });
  page.on('response', r => { if (r.status() >= 400 && /\/map\/|views\/map\.js|css\/map\.css|data\/routes\.json/.test(r.url())) errors.push('HTTP ' + r.status() + ': ' + r.url()); });
  const cdp = await ctx.newCDPSession(page);
  return { ctx, page, cdp };
}
/** Full load of one route (a fresh document every time, so no state leaks between checks). */
async function open(page, hash, settle = 1300, now = NOW) {
  await page.goto('about:blank');
  await page.goto(BASE + '?now=' + now + hash);
  await page.waitForFunction(() => document.documentElement.dataset.ready, null, { timeout: 30000 });
  await page.waitForTimeout(settle);
}
const planLoaded = (page, id) => page.waitForFunction(layerId => {
  const root = document.querySelector('.mp-root'), img = document.querySelector('.mp-plan');
  return root && root.dataset.layer === layerId && img && img.complete && img.naturalWidth > 0;
}, id, { timeout: 15000 }).then(() => true, () => false);
const mapState = page => page.evaluate(() => {
  const root = document.querySelector('.mp-root'), card = document.querySelector('.mp-card'), img = document.querySelector('.mp-plan');
  const sel = document.querySelector('.mp-pin.is-sel'), from = document.querySelector('.mp-pin.is-from'), chip = document.querySelector('.mp-bar .chip.on');
  const rect = el => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, cx: b.left + b.width / 2, cy: b.top + b.height / 2 }; };
  return {
    layer: root && root.dataset.layer, k: root ? +root.dataset.k : 0, chip: chip && chip.dataset.id,
    pins: document.querySelectorAll('.mp-pins .mp-pin').length,
    transform: document.querySelector('.mp-world').style.transform,
    willChange: document.querySelector('.mp-world').style.willChange,
    img: img ? Object.assign(rect(img), { nw: img.naturalWidth }) : null,
    sel: sel ? Object.assign(rect(sel), { id: +sel.dataset.id, dot: rect(sel.querySelector('.mp-dot')) }) : null,
    from: from ? Object.assign(rect(from), { id: +from.dataset.id }) : null,
    card: card && !card.hidden ? { room: +card.dataset.room, name: card.querySelector('h3').textContent, text: card.innerText, top: card.getBoundingClientRect().top, bottom: card.getBoundingClientRect().bottom } : null,
    hash: location.hash, view: rect(document.getElementById('view')),
  };
});
/** What SC26.DB says a room is doing right now (sessions only, honoring the "technical program only" setting). */
const expectRoom = (page, idx) => page.evaluate(async i => {
  const c = await import('./js/core.js');
  const DB = window.SC26.DB, r = DB.rooms[i], now = c.nowMin(), today = c.dayOf(now);
  const list = r.items.map(x => DB.items[x]).filter(it => it.k === 'S' && c.visible(it));
  const cur = list.filter(it => it.s <= now && now < it.e).sort((a, b) => b.s - a.s || a.e - b.e)[0] || null;
  const fut = list.filter(it => it.s > now).sort((a, b) => a.s - b.s || a.e - b.e);
  const next = fut[0] || null;
  return {
    name: r.n, layer: r.l, n: list.length, x: r.x, y: r.y,
    state: cur ? 'now' : fut.some(it => c.dayOf(it.s) === today) ? 'later' : 'done',
    cur: cur && { id: cur.id, line: 'Now: ' + cur.t + ' until ' + c.fmtTime(cur.e) },
    next: next && { id: next.id, line: 'Next: ' + next.t + ' ' + (c.dayOf(next.s) === today ? 'at ' + c.fmtTime(next.s) : 'on ' + c.dayInfo(c.dayOf(next.s)).dow + ' at ' + c.fmtTime(next.s)) },
  };
}, idx);
const cardLines = page => page.evaluate(() => ({
  now: (document.querySelector('.mp-card .mp-line.st-now') || {}).textContent || null,
  next: (document.querySelector('.mp-card .mp-line.st-next') || {}).textContent || null,
  open: (document.querySelector('.mp-card .btn.primary') || { dataset: {} }).dataset.go || null,
  sched: (document.querySelector('.mp-card .btnrow .btn') || { dataset: {} }).dataset.go || null,
}));
async function touch(cdp, type, pts) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, id) => ({ x: p[0], y: p[1], id })) });
}
async function pinch(page, cdp, cx, cy, d0, d1) {
  await touch(cdp, 'touchStart', [[cx - d0 / 2, cy], [cx + d0 / 2, cy]]);
  for (let i = 1; i <= 10; i++) { const d = d0 + (d1 - d0) * i / 10; await touch(cdp, 'touchMove', [[cx - d / 2, cy], [cx + d / 2, cy]]); await page.waitForTimeout(16); }
  await touch(cdp, 'touchEnd', []);
  await page.waitForTimeout(450);
}
async function drag(page, cdp, x0, y0, x1, y1) {
  await touch(cdp, 'touchStart', [[x0, y0]]);
  for (let i = 1; i <= 8; i++) { await touch(cdp, 'touchMove', [[x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * i / 8]]); await page.waitForTimeout(16); }
  await touch(cdp, 'touchEnd', []);
  await page.waitForTimeout(450);
}

try {
  const { page, cdp } = await newPage(W, H);

  // ---------------------------------------------------------------- floors
  await open(page, '#/map');
  const info = await page.evaluate(() => ({
    failed: window.SC26.failedViews,
    layers: window.SC26.DB.layers.map(L => ({ id: L.id, n: L.n, rooms: window.SC26.DB.rooms.filter(r => r.l === L.id).length, campus: !/\d/.test(L.f) })),
    rooms: window.SC26.DB.rooms.length,
    chips: Array.from(document.querySelectorAll('.mp-bar [data-act="mp-floor"]')).map(b => ({ id: b.dataset.id, count: b.querySelector('i') ? +b.querySelector('i').textContent : null })),
    title: document.getElementById('top-title').textContent,
    tab: (document.querySelector('#tabs button.on') || { dataset: {} }).dataset.tab,
    find: !!document.querySelector('.mp-bar [data-act="mp-find"]'),
    legend: document.querySelectorAll('.mp-legend i').length,
  }));
  check('map module loaded', !info.failed.includes('map'), 'failedViews=' + info.failed);
  eq('map title and tab', [info.title, info.tab], ['Venue map', 'home']);
  eq('one chip per floor plan', info.chips.map(c => c.id).sort(), info.layers.map(L => L.id).sort());
  eq('first chip is West 1', info.chips[0].id, 'West1');
  check('legend shows the three pin colors', info.legend === 3);
  eq('every program room is on a floor plan', info.layers.reduce((n, L) => n + L.rooms, 0), info.rooms);
  let s0 = await mapState(page);
  await shot(page, 'home');
  eq('map opens on West 1', [s0.layer, s0.chip], ['West1', 'West1']);
  check('map starts fitted to the screen', s0.k === 1 && s0.img.x >= 0 && s0.img.x + s0.img.w <= W + 0.5 && s0.img.y >= s0.view.y && s0.img.y + s0.img.h <= s0.view.y + s0.view.h,
    JSON.stringify({ k: s0.k, img: s0.img }));
  for (const L of info.layers) {
    await page.tap('.mp-bar [data-act="mp-floor"][data-id="' + L.id + '"]');
    const loaded = await planLoaded(page, L.id);
    await page.waitForTimeout(200);
    const st = await mapState(page);
    const chip = info.chips.find(c => c.id === L.id);
    await shot(page, 'floor_' + L.id);
    check('floor ' + L.id + ': plan image loads', loaded && st.img && st.img.nw > 0, 'naturalWidth=' + (st.img && st.img.nw));
    check('floor ' + L.id + ': ' + L.rooms + ' pins, chip count matches', st.pins === L.rooms && (L.campus ? chip.count === null : chip.count === L.rooms) && st.chip === L.id,
      'pins=' + st.pins + ' chip=' + chip.count + ' on=' + st.chip);
    check('floor ' + L.id + ': layer is kept in the URL', /[?&]layer=/.test(st.hash) && st.hash.includes('layer=' + L.id), st.hash);
  }

  // ---------------------------------------------- pin colors follow the clock
  await page.tap('.mp-bar [data-act="mp-floor"][data-id="West1"]');
  await planLoaded(page, 'West1');
  const states = await page.evaluate(() => Array.from(document.querySelectorAll('.mp-pins .mp-pin')).map(p => [+p.dataset.id, (/st-(\w+)/.exec(p.className) || [])[1]]));
  let wrong = [], tally = { now: 0, later: 0, done: 0 };
  for (const [id, st] of states) { const e = await expectRoom(page, id); tally[e.state]++; if (e.state !== st) wrong.push(e.name + ': ' + st + ' != ' + e.state); }
  check('West 1 pin states match SC26.DB at ' + NOW + ' (' + tally.now + ' now, ' + tally.later + ' later, ' + tally.done + ' done)', !wrong.length && tally.now > 0 && tally.later > 0, wrong.join('; '));

  // ------------------------------------------------------------ tap a pin
  await page.tap('.mp-bar [data-act="mp-floor"][data-id="west3"]');
  await planLoaded(page, 'west3');
  await page.waitForTimeout(300);
  const tapId = 46, eTap = await expectRoom(page, tapId);
  await page.tap('.mp-pins .mp-pin[data-id="' + tapId + '"]');
  await page.waitForTimeout(1000);
  let st = await mapState(page);
  check('tapping a pin shows the card with that room name', !!st.card && st.card.name === eTap.name && st.sel && st.sel.id === tapId, JSON.stringify(st.card));
  check('card names building and floor', !!st.card && st.card.text.includes('West Building') && st.card.text.includes('Level 3'), st.card && st.card.text);
  let cl = await cardLines(page);
  eq('card has a Room schedule button', cl.sched, '#/room/' + tapId);
  check('tapped pin is zoomed in and sits above the card', st.k >= 2.9 && st.sel.cy < st.card.top && st.sel.cy > st.view.y + 50, JSON.stringify({ k: st.k, pin: st.sel.cy, card: st.card.top }));

  // ------------------------------------------ Back from the room page
  await page.tap('.mp-card .btnrow .btn[data-go^="#/room/"]');
  await page.waitForTimeout(700);
  const roomHash = await page.evaluate(() => location.hash);
  eq('Room schedule button opens the room page', roomHash, '#/room/' + tapId);
  await page.goBack();
  await page.waitForTimeout(900);
  st = await mapState(page);
  check('Back from the room page returns to the map on the same floor', st.layer === 'west3' && st.chip === 'west3' && st.hash.startsWith('#/map') && st.hash.includes('layer=west3'), JSON.stringify({ layer: st.layer, hash: st.hash }));
  check('Back also restores the selected room', !!st.card && st.card.room === tapId && st.sel && st.sel.id === tapId, JSON.stringify(st.card));
  await page.tap('.mp-card [data-act="mp-close"]');
  await page.waitForTimeout(250);
  st = await mapState(page);
  check('closing the card clears the selection', !st.card && !st.sel);

  // ------------------------------- crowded pins: the tap goes to the nearest pin
  await page.tap('.mp-bar [data-act="mp-floor"][data-id="West1"]');
  await planLoaded(page, 'West1');
  await page.waitForTimeout(300);
  const crowd = [];
  for (const name of ['W183b', 'W181b', 'W181abc', 'W184d', 'W176abc', 'W196bc']) {
    const pos = await page.evaluate(n => {
      const i = window.SC26.DB.rooms.findIndex(r => r.n === n), b = document.querySelector('.mp-pins .mp-pin[data-id="' + i + '"]').getBoundingClientRect();
      return { x: b.left + b.width / 2, y: b.top + b.height / 2, k: +document.querySelector('.mp-root').dataset.k };
    }, name);
    await page.touchscreen.tap(pos.x, pos.y);
    await page.waitForTimeout(900);
    st = await mapState(page);
    if (!st.card || st.card.name !== name || pos.k !== 1) crowd.push(name + ' -> ' + (st.card && st.card.name) + ' (k=' + pos.k + ')');
    await page.tap('.mp-card [data-act="mp-close"]');
    await page.tap('.mp-root [data-act="mp-reset"]');
    await page.waitForTimeout(900);
  }
  check('fitted West 1, where pins overlap: a tap on a pin selects that pin, not a neighbor', crowd.length === 0, crowd.join('; '));

  // ------------------------------------------------ #/map/<roomIdx> deep links
  const deep = await page.evaluate(() => {
    const R = window.SC26.DB.rooms, pick = n => R.findIndex(r => r.n === n);
    return [pick('W183b'), pick('W375de'), pick('S100/Grand Ballroom'), pick('W474'), pick('Lakeside Ballroom (E354)')];
  });
  for (const idx of deep) {
    await open(page, '#/map/' + idx, 2300);
    const e = await expectRoom(page, idx);
    await planLoaded(page, e.layer);
    st = await mapState(page);
    await shot(page, 'room_' + idx);
    check('#/map/' + idx + ' opens ' + e.name + ' on ' + e.layer, st.layer === e.layer && st.chip === e.layer && st.sel && st.sel.id === idx && st.card && st.card.name === e.name,
      JSON.stringify({ layer: st.layer, sel: st.sel && st.sel.id, card: st.card && st.card.name }));
    const ring = await page.evaluate(() => getComputedStyle(document.querySelector('.mp-pin.is-sel'), '::before').animationName);
    check('#/map/' + idx + ' zooms to the room and shows a pulsing ring', st.k > 3 && Math.abs(st.sel.cx - MID) < 3 && st.sel.cy > st.view.y + 60 && st.sel.cy < st.card.top && ring === 'mp-ring',
      JSON.stringify({ k: st.k, x: st.sel.cx, y: st.sel.cy, ring }));
    // the pin must sit on the room's coordinates of the plan image, whatever the zoom
    const px = st.img.x + e.x * st.img.w, py = st.img.y + e.y * st.img.h;
    check('#/map/' + idx + ' pin sits on the room coordinates of the plan', Math.hypot(st.sel.cx - px, st.sel.cy - py) < 1.5, 'pin ' + st.sel.cx.toFixed(1) + ',' + st.sel.cy.toFixed(1) + ' plan ' + px.toFixed(1) + ',' + py.toFixed(1));
    // now / next
    cl = await cardLines(page);
    eq('#/map/' + idx + ' "Now" line matches SC26.DB', cl.now && norm(cl.now), e.cur && norm(e.cur.line));
    eq('#/map/' + idx + ' "Next" line matches SC26.DB', cl.next && norm(cl.next), e.next && norm(e.next.line));
    eq('#/map/' + idx + ' session button', cl.open, e.cur || e.next ? '#/item/' + (e.cur || e.next).id : null);
  }
  // a room with a session running right now, and one with only a later session, must both be covered
  const live = await page.evaluate(async () => {
    const c = await import('./js/core.js'); const DB = window.SC26.DB, now = c.nowMin();
    const S = r => r.items.map(i => DB.items[i]).filter(it => it.k === 'S' && c.visible(it));
    const a = DB.rooms.find(r => S(r).some(it => it.s <= now && now < it.e) && S(r).some(it => it.s > now));
    return a ? a.i : -1;
  });
  check('a room with a running and a later session exists at the simulated time', live >= 0);
  if (live >= 0) {
    await open(page, '#/map/' + live, 2300);
    const e = await expectRoom(page, live); cl = await cardLines(page);
    check('room ' + e.name + ': "Now … until" and "Next … at" both match SC26.DB', !!e.cur && !!e.next && norm(cl.now) === norm(e.cur.line) && norm(cl.next) === norm(e.next.line) && /^Now: .+ until \d+:\d\d [AP]M$/.test(norm(cl.now)) && /^Next: .+ at \d+:\d\d [AP]M$/.test(norm(cl.next)),
      JSON.stringify(cl));
    eq('room ' + e.name + ': "Open session" opens the running session', cl.open, '#/item/' + e.cur.id);

    // -------------------------------------------------------- zoom and pan
    await page.tap('.mp-card [data-act="mp-close"]');
    await page.tap('.mp-root [data-act="mp-reset"]');
    await page.waitForTimeout(1100);
    const sizes = () => page.evaluate(() => {
      const pins = Array.from(document.querySelectorAll('.mp-pins .mp-pin'));
      const r = el => el.getBoundingClientRect();
      const a = pins[0], b = pins[pins.length - 1];
      return {
        dots: pins.map(p => +r(p.querySelector('.mp-dot')).width.toFixed(2)), hit: +r(a).width.toFixed(2),
        gap: Math.hypot(r(a).left - r(b).left, r(a).top - r(b).top), lbl: +r(a.querySelector('.mp-lbl')).height.toFixed(2),
      };
    });
    const z0 = await mapState(page), p0 = await sizes();
    eq('locate button resets the zoom', [z0.k, z0.transform], [s0.k, s0.transform]);
    await pinch(page, cdp, MID, 380, 60, 170);
    const z1 = await mapState(page), p1 = await sizes();
    check('pinch zooms in: transform changes (scale ' + z0.k + ' -> ' + z1.k.toFixed(2) + ')', z1.k > 2 && z1.transform !== z0.transform && /scale\(/.test(z1.transform), z1.transform);
    check('plan grows with the zoom', Math.abs(z1.img.w / z0.img.w - z1.k / z0.k) < 0.02, (z1.img.w / z0.img.w).toFixed(3));
    check('pins keep their on-screen size while the plan grows', JSON.stringify(p0.dots) === JSON.stringify(p1.dots) && p0.hit === p1.hit && p0.lbl === p1.lbl && Math.abs(p1.gap / p0.gap - z1.k / z0.k) < 0.03,
      JSON.stringify({ before: [p0.dots[0], p0.hit, p0.lbl], after: [p1.dots[0], p1.hit, p1.lbl], spread: (p1.gap / p0.gap).toFixed(3) }));
    check('plan is redrawn sharp after the gesture (compositing hint dropped)', z1.willChange === '', z1.willChange);
    await drag(page, cdp, MID, 420, MID - 86, 330);
    const z2 = await mapState(page);
    check('one-finger drag pans without zooming', z2.k === z1.k && Math.abs((z2.img.x - z1.img.x) + 86) < 3 && Math.abs((z2.img.y - z1.img.y) + 90) < 3, JSON.stringify({ dx: z2.img.x - z1.img.x, dy: z2.img.y - z1.img.y }));
    await pinch(page, cdp, MID, 380, 40, W - 20); await pinch(page, cdp, MID, 380, 40, W - 20); await pinch(page, cdp, MID, 380, 40, W - 20);
    const z3 = await mapState(page), p3 = await sizes();
    check('zoom stops at 8x and pins are still the same size', z3.k === 8 && JSON.stringify(p3.dots) === JSON.stringify(p0.dots), 'k=' + z3.k);
    const labelsIn = await page.evaluate(() => document.querySelectorAll('.mp-pins .mp-pin.has-lbl').length);
    const pinsNow = z3.pins;
    await page.tap('.mp-root [data-act="mp-reset"]');
    await page.waitForTimeout(1100);
    const labelsOut = await page.evaluate(() => document.querySelectorAll('.mp-pins .mp-pin.has-lbl').length);
    check('room names appear when zoomed in (' + labelsOut + ' fitted, ' + labelsIn + ' of ' + pinsNow + ' at 8x)', labelsIn >= labelsOut && labelsIn > 0);
  }

  // --------------------------------------------------------- walking hints
  const walk = (a, b) => page.evaluate(async ([x, y]) => {
    const c = await import('./js/core.js'); const R = window.SC26.DB.rooms;
    const A = R.find(r => r.n === x), B = R.find(r => r.n === y);
    return { a: A.i, b: B.i, min: c.walkMin(A, B), al: A.l, bl: B.l };
  }, [a, b]);
  const walkDom = () => page.evaluate(() => ({
    t: (document.querySelector('.mp-walk-t') || {}).textContent || '', d: (document.querySelector('.mp-walk-d') || {}).textContent || '',
    line: document.querySelector('.mp-route .mp-rfg').getAttribute('d') || '', lineShown: getComputedStyle(document.querySelector('.mp-route')).display !== 'none',
    legs: Array.from(document.querySelectorAll('.mp-card [data-act="mp-leg"]')).map(b => b.textContent),
    kind: document.querySelector('.mp-root').dataset.route, dashed: document.querySelector('.mp-route .mp-rfg').classList.contains('is-dash'),
    // the line as drawn on screen: path points pushed through the transform of the group that holds it
    screen: (() => {
      const d = document.querySelector('.mp-route .mp-rfg').getAttribute('d') || '', m = /translate\(([-\d.]+),([-\d.]+)\) scale\(([\d.]+)\)/.exec(document.querySelector('.mp-route g').getAttribute('transform') || '');
      if (!d || !m) return [];
      const o = document.querySelector('.mp-route').getBoundingClientRect();
      return d.slice(1).split('L').map(p => p.split(',').map(Number)).map(([x, y]) => [o.left + +m[1] + x * +m[3], o.top + +m[2] + y * +m[3]]);
    })(),
  }));
  const pathLen = pts => pts.slice(1).reduce((n, p, i) => n + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
  let w = await walk('W183a', 'W175a');
  await open(page, '#/map/' + w.b + '?from=' + w.a, 2300);
  st = await mapState(page); let wd = await walkDom();
  await shot(page, 'walk_same_floor');
  eq('walking hint on one floor: text with minutes', wd.t, 'About ' + w.min + ' min walk from W183a to W175a (estimate)');
  check('walking hint on one floor: minutes are a number', /^About \d+ min walk from /.test(wd.t) && w.min > 0, wd.t);
  check('walking hint on one floor: both pins and a line between them', st.sel && st.sel.id === w.b && st.from && st.from.id === w.a && wd.lineShown && /^M[\d.]+,[\d.]+L/.test(wd.line), JSON.stringify({ sel: st.sel && st.sel.id, from: st.from && st.from.id, line: wd.line.slice(0, 40) }));
  check('walking hint on one floor: both pins are in view above the card', [st.sel, st.from].every(p => p && p.cx > 10 && p.cx < W - 10 && p.cy > st.view.y + 50 && p.cy < st.card.top), JSON.stringify({ sel: st.sel, from: st.from, card: st.card.top }));
  // real walking route (data/routes.json): a path along the walkways instead of the straight line
  const ends = wd.screen.length ? [wd.screen[0], wd.screen[wd.screen.length - 1]] : [[0, 0], [0, 0]];
  const straight = Math.hypot(st.sel.cx - st.from.cx, st.sel.cy - st.from.cy);
  check('walking route on one floor: a solid path with ' + wd.screen.length + ' points along the walkways', wd.kind === 'path' && !wd.dashed && wd.screen.length > 4, JSON.stringify({ kind: wd.kind, dashed: wd.dashed, n: wd.screen.length }));
  check('walking route on one floor: starts at the start pin and ends at the room pin', Math.hypot(ends[0][0] - st.from.cx, ends[0][1] - st.from.cy) < 1.5 && Math.hypot(ends[1][0] - st.sel.cx, ends[1][1] - st.sel.cy) < 1.5, JSON.stringify(ends));
  check('walking route on one floor: stays on the plan, in view, and is longer than the straight line (' + (pathLen(wd.screen) / straight).toFixed(2) + 'x)',
    wd.screen.every(p => p[0] >= st.img.x && p[0] <= st.img.x + st.img.w && p[1] >= st.img.y && p[1] <= st.img.y + st.img.h && p[0] > 0 && p[0] < W && p[1] > st.view.y + 50 && p[1] < st.card.top) &&
    pathLen(wd.screen) > straight && pathLen(wd.screen) < straight * 3, JSON.stringify(wd.screen.slice(0, 3)));
  check('walking route on one floor: no single step jumps across the plan', wd.screen.slice(1).every((p, i) => Math.hypot(p[0] - wd.screen[i][0], p[1] - wd.screen[i][1]) < straight), '');
  w = await walk('W190a', 'W183b');
  await open(page, '#/map/' + w.b + '?from=' + w.a, 2300);
  st = await mapState(page); wd = await walkDom();
  check('walking route between the two wings of West 1: no walkway, so a straight dashed line and a plain note', wd.kind === 'line' && wd.dashed && wd.screen.length === 2 && /no walkway/.test(wd.d) && wd.t === 'About ' + w.min + ' min walk from W190a to W183b (estimate)' && !!st.from && !!st.sel,
    JSON.stringify({ kind: wd.kind, n: wd.screen.length, d: wd.d }));
  w = await walk('Booth 4029 - SCinet Theater', 'W375de');
  await open(page, '#/map/' + w.b + '?from=' + w.a, 2300);
  st = await mapState(page); wd = await walkDom();
  check('walking route on West 3: path through the exhibit hall aisles (' + wd.screen.length + ' points)', wd.kind === 'path' && !wd.dashed && wd.screen.length > 4 && st.layer === 'west3' &&
    wd.screen.every(p => p[0] > 0 && p[0] < W && p[1] > st.view.y + 50 && p[1] < st.card.top), JSON.stringify({ kind: wd.kind, n: wd.screen.length }));

  w = await walk('W183a', 'S100/Grand Ballroom');
  await open(page, '#/map/' + w.b + '?from=' + w.a, 2300);
  st = await mapState(page); wd = await walkDom();
  await shot(page, 'walk_across_buildings');
  eq('walking hint across buildings: text with minutes', wd.t, 'About ' + w.min + ' min walk from W183a to S100/Grand Ballroom (estimate)');
  check('walking hint across buildings: names both buildings, both levels and the Grand Concourse', ['West Building', 'South Building', 'Level 1', 'Grand Concourse'].every(x => wd.d.includes(x)) && (wd.d.match(/Level 1/g) || []).length === 2, wd.d);
  check('walking hint across buildings: opens on the destination floor without a line', st.layer === w.bl && st.sel && st.sel.id === w.b && !st.from && !wd.lineShown && wd.kind === 'none' && wd.legs.length === 2, JSON.stringify({ layer: st.layer, legs: wd.legs }));
  await page.tap('.mp-card [data-act="mp-leg"][data-id="' + w.a + '"]');
  await planLoaded(page, w.al);
  await page.waitForTimeout(1000);
  st = await mapState(page);
  check('walking hint across buildings: "Start" shows the other pin on its floor', st.layer === w.al && st.from && st.from.id === w.a && !st.sel && !!st.card, JSON.stringify({ layer: st.layer, from: st.from && st.from.id }));

  w = await walk('W183a', 'W375de');
  await open(page, '#/map/' + w.b + '?from=' + w.a, 2300);
  wd = await walkDom();
  check('walking hint across levels: minutes plus both levels of the West Building', wd.t === 'About ' + w.min + ' min walk from W183a to W375de (estimate)' && ['Level 1', 'Level 3', 'West Building'].every(x => wd.d.includes(x)), wd.t + ' | ' + wd.d);
  w = await walk('W183a', 'Lakeside Ballroom (E354)');
  await open(page, '#/map/' + w.b + '?from=' + w.a, 2300);
  wd = await walkDom();
  check('walking hint to Lakeside Center mentions the sky bridge', wd.t.startsWith('About ' + w.min + ' min walk') && /sky bridge/.test(wd.d) && wd.d.includes('Lakeside Center') && wd.d.includes('West Building'), wd.d);

  // ------------------------------------------------------------ room finder
  await open(page, '#/map');
  await page.tap('.mp-bar [data-act="mp-find"]');
  await page.waitForSelector('.sheet-wrap.open .mp-find-list');
  const finder = () => page.evaluate(() => ({
    rows: Array.from(document.querySelectorAll('.mp-find-list .mp-rrow')).map(r => ({ id: +r.dataset.id, name: r.querySelector('.row-title').textContent, n: +r.querySelector('.row-right b').textContent })),
    groups: Array.from(document.querySelectorAll('.mp-find-list .mp-grp')).map(g => g.firstChild.textContent),
    title: (document.querySelector('.sheet-h h3') || {}).textContent,
  }));
  let f = await finder();
  await page.waitForTimeout(300);
  await shot(page, 'finder');
  eq('room finder lists every room', [f.title, f.rows.length], ['Find a room', info.rooms]);
  eq('room finder groups rooms by building and floor', f.groups, info.layers.filter(L => L.rooms).map(L => L.n).sort((a, b) => f.groups.indexOf(a) - f.groups.indexOf(b)));
  const cnt = await page.evaluate(async rows => {
    const c = await import('./js/core.js'); const DB = window.SC26.DB;
    return rows.filter(r => DB.rooms[r.id].items.filter(i => DB.items[i].k === 'S' && c.visible(DB.items[i])).length !== r.n || DB.rooms[r.id].n !== r.name).map(r => r.name);
  }, f.rows);
  check('room finder shows the number of sessions in each room', cnt.length === 0, cnt.join(', '));
  await page.fill('.mp-q input', '183');
  await page.waitForTimeout(200);
  f = await finder();
  const want183 = await page.evaluate(() => window.SC26.DB.rooms.filter(r => r.n.includes('183')).map(r => r.n).sort());
  eq('room finder filters as you type ("183")', f.rows.map(r => r.name).sort(), want183);
  await page.fill('.mp-q input', 'zzz');
  await page.waitForTimeout(150);
  check('room finder says when nothing matches', (await finder()).rows.length === 0 && /No room matches/.test(await page.evaluate(() => document.querySelector('.mp-find-list').textContent)));
  await page.fill('.mp-q input', 'w375');
  await page.waitForTimeout(200);
  f = await finder();
  eq('room finder: "w375" finds W375de', f.rows.map(r => r.name), ['W375de']);
  await page.tap('.mp-find-list .mp-rrow[data-id="' + f.rows[0].id + '"]');
  await planLoaded(page, 'west3');
  await page.waitForTimeout(1300);
  st = await mapState(page);
  check('choosing a room in the finder focuses it on the map', st.layer === 'west3' && st.sel && st.sel.id === f.rows[0].id && st.card && st.card.name === 'W375de' && st.k > 3 && Math.abs(st.sel.cx - MID) < 3 &&
    !(await page.evaluate(() => !!document.querySelector('.sheet-wrap.open'))), JSON.stringify({ layer: st.layer, sel: st.sel && st.sel.id, k: st.k, hash: st.hash }));

  // -------------------------------------------------------------- room page
  const expectDays = (idx) => page.evaluate(async i => {
    const c = await import('./js/core.js'); const DB = window.SC26.DB, r = DB.rooms[i], today = c.dayOf(c.nowMin());
    const list = r.items.map(x => DB.items[x]).filter(it => c.visible(it) && (it.k === 'S' || (it.k === 'P' && it.par != null && DB.items[it.par].r !== r.i)));
    const per = {}; for (const it of list) per[it.day] = (per[it.day] || 0) + 1;
    const days = Object.keys(per).map(Number).sort((a, b) => a - b);
    const def = days.includes(today) ? today : days.find(d => d > today) != null ? days.find(d => d > today) : days[0];
    // time order; on today's tab the sessions that are over come first (the "now" marker follows them)
    const now = c.nowMin();
    const ids = d => list.filter(it => it.day === d).sort((a, b) => (d === today ? (a.e > now) - (b.e > now) : 0) || a.s - b.s || a.e - b.e || a.i - b.i).map(it => it.id);
    return { name: r.n, place: r.b + ' · ' + r.f, today, days, per, def, ids: Object.fromEntries(days.map(d => [d, ids(d)])) };
  }, idx);
  const roomDom = () => page.evaluate(() => ({
    title: document.getElementById('top-title').textContent, tab: (document.querySelector('#tabs button.on') || { dataset: {} }).dataset.tab,
    h2: (document.querySelector('.mp-rhead h2') || {}).textContent, sub: (document.querySelector('.mp-rhead .mp-sub') || {}).textContent || '',
    tabs: Array.from(document.querySelectorAll('.daytabs .daytab')).map(b => ({ d: +b.dataset.id, on: b.classList.contains('on'), n: parseInt(b.querySelector('em').textContent, 10) })),
    cards: Array.from(document.querySelectorAll('.mp-rlist .card.it')).map(c => c.dataset.go.replace('#/item/', '')),
    nowIndex: Array.from(document.querySelector('.mp-rlist') ? document.querySelector('.mp-rlist').children : []).findIndex(c => c.classList.contains('mp-nowline')),
    past: Array.from(document.querySelector('.mp-rlist') ? document.querySelector('.mp-rlist').children : []).map(c => c.classList.contains('mp-nowline') ? 'N' : c.classList.contains('past') ? 'p' : 'u').join(''),
    mini: (() => { const m = document.querySelector('.mp-mini'), i = m && m.querySelector('img'); return m ? { go: m.dataset.go, img: i.complete && i.naturalWidth > 0, pin: !!m.querySelector('.mp-pin') } : null; })(),
    show: (document.querySelector('.mp-rhead .btn') || { dataset: {} }).dataset.go || null,
  }));
  const busy = await page.evaluate(async () => {
    const c = await import('./js/core.js'); const DB = window.SC26.DB, now = c.nowMin(), today = c.dayOf(now);
    const S = r => r.items.map(i => DB.items[i]).filter(it => it.k === 'S' && c.visible(it));
    const days = r => new Set(S(r).map(it => it.day));
    const pick = fn => { const r = DB.rooms.find(fn); return r ? r.i : -1; };
    return {
      today: pick(r => S(r).filter(it => it.day === today).length >= 3 && S(r).some(it => it.day === today && it.e <= now) && days(r).size >= 3),
      past: pick(r => days(r).size > 0 && [...days(r)].every(d => d < today)),
    };
  });
  for (const [why, idx] of Object.entries(busy)) {
    if (idx < 0) { check('room page (' + why + '): a matching room exists', false, 'none'); continue; }
    await open(page, '#/room/' + idx, 900);
    const e = await expectDays(idx), d = await roomDom();
    await shot(page, 'roompage_' + why);
    eq('room page ' + e.name + ' (' + why + '): title, tab, header', [d.title, d.tab, d.h2, d.sub.includes(e.place)], [e.name, 'schedule', e.name, true]);
    eq('room page ' + e.name + ': day tabs are the days in use, with session counts', d.tabs.map(t => [t.d, t.n]), e.days.map(x => [x, e.per[x]]));
    eq('room page ' + e.name + ': default day (' + why + ')', d.tabs.filter(t => t.on).map(t => t.d), [e.def]);
    eq('room page ' + e.name + ': lists the ' + e.ids[e.def].length + ' sessions of day ' + e.def + ' in time order', d.cards, e.ids[e.def]);
    check('room page ' + e.name + ': plan preview with pin, and "Show on map"', !!d.mini && d.mini.img && d.mini.pin && d.mini.go === '#/map/' + idx && d.show === '#/map/' + idx, JSON.stringify(d.mini));
    if (why === 'today') check('room page ' + e.name + ': "now" marker sits between past and upcoming sessions (' + d.past + ')', /^p+Nu+$/.test(d.past), d.past);
    else check('room page ' + e.name + ': no "now" marker on another day', d.nowIndex === -1, d.past);
    const other = e.days.find(x => x !== e.def);
    if (other != null) {
      await page.tap('.daytabs .daytab[data-id="' + other + '"]');
      await page.waitForTimeout(250);
      const d2 = await roomDom();
      eq('room page ' + e.name + ': switching to day ' + other + ' lists its ' + e.ids[other].length + ' sessions', [d2.tabs.filter(t => t.on).map(t => t.d), d2.cards], [[other], e.ids[other]]);
      check('room page ' + e.name + ': chosen day is kept in the URL', (await page.evaluate(() => location.hash)) === '#/room/' + idx + '?d=' + other);
    }
  }
  if (busy.today >= 0) {
    await open(page, '#/room/' + busy.today, 900);
    await page.tap('.mp-mini');
    await page.waitForTimeout(1800);
    st = await mapState(page);
    check('tapping the plan preview opens the map on that room', st.hash === '#/map/' + busy.today && st.sel && st.sel.id === busy.today, st.hash);
  }
  // default day on other dates: first upcoming day before the room is used, first day once the conference is over
  for (const [when, label] of [['2026-11-14T09:00', 'before its first day'], ['2026-11-22T10:00', 'after the conference']]) {
    await open(page, '#/room/' + deep[1], 900, when);
    const e = await expectDays(deep[1]), d = await roomDom();
    check('room page ' + e.name + ' opened ' + label + ' defaults to day ' + e.def, d.tabs.filter(t => t.on).map(t => t.d).join() === String(e.days[0]) && e.def === e.days[0] && !e.days.includes(e.today) && d.cards.length === e.ids[e.def].length,
      JSON.stringify({ on: d.tabs.filter(t => t.on), today: e.today, days: e.days }));
  }
  await open(page, '#/room/9999', 600);
  check('unknown room shows a plain message', /Room not found/.test(await page.evaluate(() => document.getElementById('view').textContent)));

  // ------------------------------------------------------- 360 px wide phone
  const small = await newPage(360, 740);
  w = await walk('W183a', 'S100/Grand Ballroom');
  for (const [name, hash] of [['map', '#/map'], ['selected room', '#/map/' + deep[0]], ['walking hint', '#/map/' + w.b + '?from=' + w.a]]) {
    await open(small.page, hash, 2300);
    await shot(small.page, 'small_' + name.replace(/ /g, '_'));
    const m = await small.page.evaluate(() => {
      const r = el => el.getBoundingClientRect();
      const card = document.querySelector('.mp-card'), view = r(document.getElementById('view')), bar = r(document.querySelector('.mp-bar'));
      const kids = Array.from(document.querySelectorAll('.mp-bottom *'));
      const sel = document.querySelector('.mp-pin.is-sel');
      return {
        over: kids.filter(k => r(k).width && (r(k).right > 360.5 || r(k).left < -0.5)).map(k => k.className).slice(0, 4),
        scrollX: document.documentElement.scrollWidth, card: card.hidden ? null : { top: r(card).top, bottom: r(card).bottom },
        view, barBottom: bar.bottom, img: r(document.querySelector('.mp-plan')), pin: sel ? { x: r(sel).left + 16, y: r(sel).top + 16 } : null,
      };
    });
    check('360 px ' + name + ': nothing runs off the sides', m.over.length === 0 && m.scrollX <= 360, JSON.stringify(m.over));
    if (m.card) check('360 px ' + name + ': card fits under the chips, room pin stays visible', m.card.top > m.barBottom + 40 && m.card.bottom <= m.view.bottom && m.pin && m.pin.y > m.barBottom && m.pin.y < m.card.top && m.pin.x > 0 && m.pin.x < 360,
      JSON.stringify({ card: m.card, bar: m.barBottom, pin: m.pin }));
    else check('360 px ' + name + ': plan fits the width', m.img.left >= 0 && m.img.right <= 360.5 && m.img.width > 300, JSON.stringify(m.img));
  }
  await open(small.page, '#/room/' + (busy.today >= 0 ? busy.today : deep[0]), 900);
  const sm = await small.page.evaluate(() => ({ sx: document.getElementById('view').scrollWidth, cw: document.getElementById('view').clientWidth, btn: document.querySelector('.mp-rhead .btn').getBoundingClientRect().right, cards: document.querySelectorAll('.mp-rlist .card.it').length }));
  check('360 px room page: no sideways overflow', sm.sx <= sm.cw && sm.btn <= 360 && sm.cards > 0, JSON.stringify(sm));
  await small.ctx.close();

  // ----------------------------------------------------------------- errors
  check('no page errors (404s for other view modules are ignored)', errors.length === 0, errors.slice(0, 5).join(' | '));
} catch (e) {
  failures++;
  console.log('FAIL - test run aborted: ' + (e && e.stack || e));
} finally {
  await browser.close();
}
console.log('\n' + (checks - failures) + ' of ' + checks + ' checks passed' + (failures ? ', ' + failures + ' FAILED' : ''));
process.exit(failures ? 1 : 0);
