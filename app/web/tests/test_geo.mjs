// Regression test for the "where contributors come from" screens: the globe,
// the country page, the collaboration network and the organizations board.
//
// Usage:
//   NODE_PATH=/tmp/sc26build/webtest/node_modules node app/web/tests/test_geo.mjs [width]
//   SC26_SHOTS=/tmp/sc26build/shots ...   also saves a screenshot of every screen in that folder
// Needs the app served at http://127.0.0.1:8765 (see DEV_NOTES.md).
// The full suite runs at [width] (default 412), then the layout checks run again at 360.
// Prints one line per check. Exit codes: 0 all passed, 1 at least one check failed.
import { createRequire } from 'module';
const require = createRequire(process.env.NODE_PATH ? process.env.NODE_PATH + '/' : import.meta.url);
const { chromium } = require('playwright-core');

const W = +(process.argv[2] || 412);
const PAGE = process.env.SC26_PAGE || 'index.html';
const BASE = 'http://127.0.0.1:8765/' + PAGE + '?now=2026-11-18T10:40';
const SHOTS = process.env.SC26_SHOTS || '';
const MINE = ['globe', 'network', 'orgs'];
let failed = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? '✓ ' : '✗ ') + name + (extra !== '' ? '  [' + extra + ']' : '')); if (!cond) failed++; };
const fmt = n => Number(n).toLocaleString('en-US');
const wrap = d => ((d + 180) % 360 + 360) % 360 - 180;

const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function open(width, height) {
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true });
  // count animation-frame requests from the very start, so d3's timer is counted too
  await ctx.addInitScript(() => {
    window.__raf = 0;
    const orig = window.requestAnimationFrame;
    window.requestAnimationFrame = function (fn) { window.__raf++; return orig.call(window, fn); };
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (/Failed to load resource/.test(t)) return;               // judged by the response check below
    const v = /view module failed: (\w+)/.exec(t);
    if (v && !MINE.includes(v[1])) return;                       // modules owned by other engineers
    errors.push('console: ' + t);
  });
  page.on('response', r => {
    if (r.status() < 400) return;
    const u = r.url();
    if (/\/favicon\.ico$/.test(u)) return;
    const v = /\/js\/views\/(\w+)\.js$/.exec(u);
    if (v && !MINE.includes(v[1])) return;                       // a view someone else has not written yet
    errors.push('http ' + r.status() + ': ' + u);
  });
  const cdp = await ctx.newCDPSession(page);
  return { ctx, page, errors, cdp };
}

// A session bundles the page helpers used by the checks below.
function helpers({ page, cdp }) {
  const h = {};
  h.ready = () => page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 20000 });
  h.goto = async (hash, wait = 450) => { await page.evaluate(x => { location.hash = x; }, hash); await page.waitForTimeout(wait); };
  h.hash = () => page.evaluate(() => location.hash);
  h.title = () => page.evaluate(() => document.getElementById('top-title').textContent);
  h.shot = async name => { if (SHOTS) await page.screenshot({ path: SHOTS + '/geo-' + name + '.png' }); };
  /** Share of sampled pixels that are painted, number of distinct colors, and a hash of the pixels. */
  h.canvas = sel => page.evaluate(s => {
    const c = document.querySelector(s);
    if (!c || !c.width) return { filled: 0, colors: 0, hash: 0, w: 0, h: 0 };
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0, total = 0, hash = 0; const colors = new Set();
    for (let i = 0; i < d.length; i += 4 * 3) {
      total++;
      if (d[i + 3] > 8) { n++; colors.add(((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4)); }
      hash = (hash * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7 + d[i + 3] * 11) >>> 0;
    }
    return { filled: n / total, colors: colors.size, hash, w: c.width, h: c.height };
  }, sel);
  h.geo = () => page.evaluate(() => { const s = document.querySelector('.geo-stage'); return s && s.__geo ? s.__geo() : null; });
  h.nodes = () => page.evaluate(() => { const c = document.querySelector('.geo-net-canvas'); return c && c.__geoNodes ? c.__geoNodes() : []; });
  h.center = async sel => { const b = await page.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b }; };
  h.touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: Math.round(p[0]), y: Math.round(p[1]), id: i + 1 })) });
  h.drag = async (x1, y1, x2, y2, steps = 8) => {
    await h.touch('touchStart', [[x1, y1]]);
    for (let i = 1; i <= steps; i++) { await h.touch('touchMove', [[x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps]]); await page.waitForTimeout(16); }
    await h.touch('touchEnd', []);
  };
  h.pinch = async (cx, cy, d1, d2, steps = 8) => {
    await h.touch('touchStart', [[cx - d1 / 2, cy], [cx + d1 / 2, cy]]);
    for (let i = 1; i <= steps; i++) { const d = d1 + (d2 - d1) * i / steps; await h.touch('touchMove', [[cx - d / 2, cy], [cx + d / 2, cy]]); await page.waitForTimeout(16); }
    await h.touch('touchEnd', []);
  };
  /** Elements of the current view that stick out of the screen sideways. */
  h.overflow = () => page.evaluate(() => {
    const vw = window.innerWidth, out = [];
    const view = document.getElementById('view');
    if (view.scrollWidth > view.clientWidth + 1) out.push('#view scrolls sideways by ' + (view.scrollWidth - view.clientWidth));
    // children of a box that clips or scrolls its content sideways cannot stick out, so the walk stops there
    const visit = e => {
      if (e.hidden) return;
      const r = e.getBoundingClientRect();
      if (r.width && r.height && (r.right > vw + 0.6 || r.left < -0.6)) out.push(e.tagName.toLowerCase() + '.' + String(e.className).split(' ')[0] + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
      if (getComputedStyle(e).overflowX !== 'visible') return;
      for (const k of e.children) visit(k);
    };
    for (const k of view.children) visit(k);
    return out.slice(0, 5);
  });
  h.rafDelta = async ms => { const a = await page.evaluate(() => window.__raf); await page.waitForTimeout(ms); return (await page.evaluate(() => window.__raf)) - a; };
  return h;
}

// Ground truth computed straight from SC26.DB, independent of the view code.
const truth = page => page.evaluate(() => {
  const DB = window.SC26.DB;
  const vis = it => !it.brk && (!window.SC26.Store.state.settings.techOnly || it.grp === 'tech');
  const country = name => {
    const c = DB.countries.find(x => x.name === name);
    const people = DB.people.filter(p => p.c === c.i);
    const orgs = new Set(); people.forEach(p => p.o.forEach(o => orgs.add(o)));
    const pset = new Set(people.map(p => p.i));
    const items = DB.items.filter(it => vis(it) && it.p.some(x => pset.has(x[0])));
    const tc = new Map(); items.forEach(it => it.th.forEach(([t]) => tc.set(t, (tc.get(t) || 0) + 1)));
    const themes = Array.from(tc).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 8).map(([t, n]) => [DB.themes[t].id, n]);
    return { i: c.i, name: c.name, lat: c.lat, lon: c.lon, np: people.length, dbNp: c.np, orgs: orgs.size, items: items.length, themes };
  };
  // co-authorship: every non-break item with 2..40 distinct people links each pair
  const adj = new Map();
  const add = (a, b) => { if (!adj.has(a)) adj.set(a, new Map()); adj.get(a).set(b, (adj.get(a).get(b) || 0) + 1); };
  for (const it of DB.items) {
    if (it.brk) continue;
    const ps = Array.from(new Set(it.p.map(x => x[0])));
    if (ps.length < 2 || ps.length > 40) continue;
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) { add(ps[i], ps[j]); add(ps[j], ps[i]); }
  }
  const collab = {}; for (const [i, m] of adj) collab[DB.people[i].id] = m.size;
  const norm = s => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const orgs = DB.orgs;
  return {
    people: DB.people.length,
    known: DB.people.filter(p => p.c >= 0).length,
    countries: DB.countries.filter(c => DB.people.some(p => p.c === c.i)).length,
    c: Object.fromEntries(['Japan', 'Hong Kong', 'Israel', 'United States', 'Switzerland', 'Germany'].map(n => [n, country(n)])),
    collab, names: DB.people.map(p => p.n),
    hoefler: (DB.people.find(p => /hoefler/i.test(p.n)) || {}).id,
    orgs: {
      all: orgs.length, lab: orgs.filter(o => o.k === 'lab').length, edu: orgs.filter(o => o.k === 'edu').length,
      argonne: orgs.filter(o => norm(o.n).includes('argonne')).length,
      topNp: orgs.slice().sort((a, b) => b.np - a.np || b.ni - a.ni)[0].n,
      topNi: orgs.slice().sort((a, b) => b.ni - a.ni || b.np - a.np)[0].n,
      topI: orgs.slice().sort((a, b) => b.np - a.np || b.ni - a.ni)[0].i,
      withOrg: DB.people.filter(p => p.o.length).length,
    },
  };
});

// =================================================================== suite
async function suite(width) {
  const s = await open(width, 915);
  const { page, errors } = s;
  const h = helpers(s);

  // ------------------------------------------------------------------ globe
  await page.goto(BASE + '#/globe'); await h.ready();
  const failedViews = await page.evaluate(() => window.SC26.failedViews);
  ok('globe, network and orgs modules loaded', !failedViews.some(v => MINE.includes(v)), failedViews.join(',') || 'none failed');
  const T = await truth(page);
  await page.waitForSelector('.geo-stage[data-ready="1"]', { timeout: 15000 }).catch(() => {});
  ok('world map loads and the globe starts', await page.locator('.geo-stage[data-ready="1"]').count() === 1);
  await page.waitForTimeout(500);
  ok('globe view has its title', (await h.title()) === 'World of SC26');

  const g1 = await h.canvas('.geo-globe'), r1 = await h.geo();
  ok('globe canvas is not blank', g1.filled > 0.3 && g1.colors >= 10, Math.round(g1.filled * 100) + '% painted, ' + g1.colors + ' colors');
  const f1 = await h.canvas('.geo-fx');
  await page.waitForTimeout(900);
  const g2 = await h.canvas('.geo-globe'), r2 = await h.geo(), f2 = await h.canvas('.geo-fx');
  ok('globe changes over time (auto-rotation)', g1.hash !== g2.hash && wrap(r2.rot[0] - r1.rot[0]) > 1, 'turned ' + wrap(r2.rot[0] - r1.rot[0]).toFixed(1) + ' degrees in 0.9 s');
  ok('arcs to Chicago are drawn and animate', f1.filled > 0.001 && f1.hash !== f2.hash, (f1.filled * 100).toFixed(2) + '% painted');
  const ratio = await page.evaluate(() => document.querySelector('.geo-stage').offsetHeight / document.getElementById('view').clientHeight);
  ok('globe takes roughly the top 55% of the screen', ratio > 0.48 && ratio < 0.62, Math.round(ratio * 100) + '%');
  ok('animation frames run while the globe is on screen', (await h.rafDelta(400)) > 8);
  await h.shot('globe-' + width);

  const list = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#geo-list .geo-row'));
    const un = document.getElementById('geo-unknown');
    return {
      n: rows.length, sum: rows.reduce((a, r) => a + +r.dataset.np, 0),
      shown: rows.reduce((a, r) => a + Number(r.querySelector('.geo-row-top > b').textContent.replace(/,/g, '')), 0),
      sorted: rows.every((r, i) => !i || +rows[i - 1].dataset.np >= +r.dataset.np),
      shares: rows.every(r => /%$/.test(r.querySelector('.geo-row-top > em').textContent)),
      unknown: +un.dataset.unknown, unknownText: un.textContent, total: document.getElementById('geo-total').textContent,
    };
  });
  ok('country list total equals the contributors with a country', list.sum === T.known && list.shown === T.known, list.sum + ' listed, ' + T.known + ' in DB');
  ok('country list has every country with contributors, largest first, with shares', list.n === T.countries && list.sorted && list.shares, list.n + ' rows');
  ok('says how many contributors have no country on file', list.unknown === T.people - T.known && list.unknownText.includes(fmt(T.people - T.known)) && list.total.includes(fmt(T.known)), list.unknown + ' unknown');

  // list row -> globe -> card, then a tap on the center of the globe finds the same country again
  for (const name of ['Japan', 'Hong Kong', 'Israel']) {
    const c = T.c[name];
    const row = page.locator('#geo-list .geo-row[data-c="' + c.i + '"]');
    await row.scrollIntoViewIfNeeded();
    await row.tap();
    const settled = await page.waitForFunction(([i, lon, lat]) => {
      const st = document.querySelector('.geo-stage'), g = st.__geo && st.__geo();
      const w = d => ((d + 180) % 360 + 360) % 360 - 180;
      return st.dataset.sel === String(i) && document.getElementById('view').scrollTop === 0 && g && Math.abs(w(g.rot[0] + lon)) < 0.05 && Math.abs(g.rot[1] + lat) < 0.05;
    }, [c.i, c.lon, c.lat], { timeout: 6000 }).then(() => true, () => false);
    const cardText = await page.locator('.geo-card').innerText();
    ok('tapping the ' + name + ' row selects it, scrolls to the top and turns the globe to it', settled && cardText.includes(name) && cardText.includes(fmt(c.np)) && cardText.includes(fmt(c.orgs)), cardText.replace(/\s+/g, ' ').slice(0, 60));
    ok(name + ' card has a button to its country page', await page.locator('.geo-card [data-go="#/country/' + c.i + '"]').count() === 1);
    if (name === 'Japan') await h.shot('globe-selected-' + width);
    await page.locator('[data-act="geo-clear"]').tap();
    await page.waitForTimeout(150);
    const cleared = await page.locator('.geo-card-empty').count() === 1;
    const ctr = await h.center('.geo-fx');
    await page.touchscreen.tap(ctr.x, ctr.y);
    await page.waitForTimeout(350);
    const sel = await page.evaluate(() => { const e = document.querySelector('.geo-card[data-c]'); return e ? e.dataset.c + '|' + e.querySelector('.geo-card-name').textContent : ''; });
    ok('tapping the center of the globe shows the ' + name + ' card', cleared && sel === c.i + '|' + name, sel || 'no card');
  }

  // gestures (Israel is selected, so the globe is not spinning on its own)
  const ctr = await h.center('.geo-fx');
  const b0 = await h.geo();
  await h.drag(ctr.x - 50, ctr.y, ctr.x + 50, ctr.y + 6);
  const b1 = await h.geo();
  ok('dragging rotates the globe', wrap(b1.rot[0] - b0.rot[0]) > 12, 'turned ' + wrap(b1.rot[0] - b0.rot[0]).toFixed(1) + ' degrees');
  await page.waitForTimeout(900);
  await h.pinch(ctr.x, ctr.y, 70, 190);
  const z1 = (await h.geo()).zoom;
  await page.waitForTimeout(100);
  await h.pinch(ctr.x, ctr.y, 200, 40);
  const z2 = (await h.geo()).zoom;
  ok('pinching zooms the globe a little and back', z1 > 1.5 && z1 <= 2.2 && z2 < z1 && z2 >= 1, 'zoom ' + z1.toFixed(2) + ' then ' + z2.toFixed(2));
  await page.mouse.move(ctr.x, ctr.y);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(150);
  const z3 = (await h.geo()).zoom;
  ok('the wheel zooms too', z3 > z2, 'zoom ' + z3.toFixed(2));

  // bar scale toggle
  const barW = () => page.evaluate(() => { const r = document.querySelectorAll('#geo-list .geo-row')[9]; return r.querySelector('.geo-track i').getBoundingClientRect().width / r.querySelector('.geo-track').getBoundingClientRect().width; });
  const lin = await barW();
  await page.locator('[data-act="geo-scale"][data-v="log"]').scrollIntoViewIfNeeded();
  await page.locator('[data-act="geo-scale"][data-v="log"]').tap();
  await page.waitForTimeout(700);
  const log = await barW();
  ok('the linear / log toggle rescales the bars', lin < 0.06 && log > 0.3 && (await h.hash()).includes('scale=log'), '10th bar ' + Math.round(lin * 100) + '% then ' + Math.round(log * 100) + '%');
  await page.locator('[data-act="geo-scale"][data-v="linear"]').tap();
  await page.waitForTimeout(200);

  // ---------------------------------------------------------------- country
  const isr = T.c.Israel;
  await page.evaluate(() => { document.getElementById('view').scrollTop = 0; });
  await page.locator('.geo-card [data-go]').tap();
  await page.waitForTimeout(500);
  ok('the card button opens the country page', (await h.hash()) === '#/country/' + isr.i && (await h.title()) === 'Israel', await h.hash());
  await page.goBack();
  await page.waitForTimeout(700);
  ok('Back returns to the globe with the country still selected', (await h.hash()).startsWith('#/globe?c=' + isr.i) && (await page.locator('.geo-card-name').innerText().catch(() => '')) === 'Israel', await h.hash());
  for (const name of ['United States', 'Switzerland']) {
    const c = T.c[name];
    await h.goto('#/country/' + c.i, 600);
    const pg = await page.evaluate(() => ({
      title: document.getElementById('top-title').textContent,
      head: document.querySelector('.geo-chead h2') ? document.querySelector('.geo-chead h2').textContent : '',
      stats: Array.from(document.querySelectorAll('.geo-cstats .stat b')).map(b => +b.dataset.count),
      text: Array.from(document.querySelectorAll('.geo-cstats .stat b')).map(b => b.textContent),
      secs: Array.from(document.querySelectorAll('.sec-h h2')).map(x => x.textContent),
      themes: Array.from(document.querySelectorAll('.geo-list .geo-row[data-go^="#/theme/"]')).map(r => [r.dataset.go.slice(8), +r.querySelector('b').textContent.replace(/,/g, '')]),
      orgRows: document.querySelectorAll('#geo-corgs .row.org').length,
      people: document.querySelectorAll('.row.person').length,
      cards: document.querySelectorAll('#geo-citems .card.it').length,
    }));
    ok(name + ' page: title and header', pg.title === name && pg.head === name);
    ok(name + ' page: contributor count matches SC26.DB', pg.stats[0] === c.np && c.np === c.dbNp && pg.text[0] === fmt(c.np), 'page ' + pg.text[0] + ', DB ' + c.np);
    ok(name + ' page: organization and program item tiles match SC26.DB', pg.stats[1] === c.orgs && pg.stats[2] === c.items, 'orgs ' + pg.stats[1] + '/' + c.orgs + ', items ' + pg.stats[2] + '/' + c.items);
    ok(name + ' page: top themes match SC26.DB and link to theme pages', JSON.stringify(pg.themes) === JSON.stringify(c.themes), pg.themes.length + ' themes');
    ok(name + ' page: sections, top 10 organizations and people, item cards',
      pg.secs.join('|') === ['What ' + (name.startsWith('United') ? 'the ' : '') + name + ' presents', 'Organizations', 'Most active people', 'Program items'].join('|') &&
      pg.orgRows === Math.min(10, c.orgs) && pg.people === Math.min(10, c.np) && pg.cards > 0 && pg.cards <= c.items, pg.orgRows + ' orgs, ' + pg.people + ' people, ' + pg.cards + ' cards');
    if (c.orgs > 10) {
      await page.locator('[data-act="geo-orgs-all"]').scrollIntoViewIfNeeded();
      await page.locator('[data-act="geo-orgs-all"]').tap();
      await page.waitForTimeout(300);
      const n = await page.locator('#geo-corgs .row.org').count();
      ok(name + ' page: "show all" expands the organizations', n > 10 && n <= c.orgs && await page.locator('[data-act="geo-orgs-all"]').count() === 0, n + ' of ' + c.orgs + ' rendered so far');
    }
    if (name === 'United States') await h.shot('country-' + width);
    ok(name + ' page fits the screen width', (await h.overflow()).length === 0, (await h.overflow()).join('; '));
  }
  await h.goto('#/country/9999');
  ok('unknown country shows a clear message', (await page.locator('.empty').innerText()).includes('Country not found'));
  await h.goto('#/globe?c=' + T.c.Germany.i, 900);
  ok('globe opens with a country preselected from the link', (await page.locator('.geo-card-name').innerText()) === 'Germany');
  ok('globe fits the screen width', (await h.overflow()).length === 0, (await h.overflow()).join('; '));

  // ---------------------------------------------------------------- network
  await h.goto('#/network', 300);
  await page.waitForSelector('.geo-net-canvas[data-ready="1"]', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(700);
  const n1 = await h.canvas('.geo-net-canvas');
  const meta = await page.evaluate(() => { const c = document.querySelector('.geo-net-canvas'); return { nodes: +c.dataset.nodes, links: +c.dataset.links }; });
  ok('network canvas is not blank', n1.filled > 0.01 && n1.colors >= 4, (n1.filled * 100).toFixed(1) + '% painted, ' + n1.colors + ' colors');
  ok('default graph has roughly 200 people and the links among them', meta.nodes >= 150 && meta.nodes <= 200 && meta.links > meta.nodes, meta.nodes + ' people, ' + meta.links + ' links');
  ok('network view has its title and a search field', (await h.title()) === 'Collaboration network' && await page.locator('.floatbar .field input').count() === 1);
  const p1 = await h.nodes();
  await page.waitForTimeout(800);
  const p2 = await h.nodes();
  const moves = p1.map((a, i) => Math.hypot(a.x - p2[i].x, a.y - p2[i].y));
  const vp = page.viewportSize();
  const inside = p2.filter(n => n.x > 0 && n.x < vp.width && n.y > 0 && n.y < 915).length;
  ok('layout is settled on first paint and stays gently alive', Math.max(...moves) > 0.02 && Math.max(...moves) < 12 && inside >= p2.length * 0.95, 'largest move ' + Math.max(...moves).toFixed(2) + ' px in 0.8 s, ' + inside + '/' + p2.length + ' on screen');
  await h.shot('network-' + width);

  const cbox = (await h.center('.geo-net-canvas')).box;
  const tapNode = async pred => {
    const cand = (await h.nodes()).filter(pred).sort((a, b) => b.r - a.r)[0];
    const fresh = (await h.nodes()).find(n => n.id === cand.id);
    await page.touchscreen.tap(cbox.x + fresh.x, cbox.y + fresh.y);
    await page.waitForTimeout(350);
    return cand;
  };
  const free = n => n.y > 130 && n.y < cbox.height - 230 && n.x > 20 && n.x < cbox.width - 20;
  const big = await tapNode(free);
  const card = await page.evaluate(() => {
    const c = document.querySelector('.overlay-card.geo-ncard');
    if (!c) return null;
    return { name: c.querySelector('.geo-ncard-name').textContent, text: c.innerText, av: !!c.querySelector('.av'), btns: Array.from(c.querySelectorAll('.btnrow .btn')).map(b => [b.textContent.trim(), b.dataset.go || b.dataset.act]), id: c.dataset.person };
  });
  ok('tapping a circle shows the person card with a real name', !!card && card.name === big.name && T.names.includes(card.name) && card.av, card ? card.name : 'no card');
  ok('card shows organization and collaborators in the full data', !!card && card.text.includes(fmt(T.collab[big.id]) + ' collaborator'), card ? card.text.replace(/\s+/g, ' ').slice(0, 90) : '');
  ok('card has Profile and Their network buttons', !!card && JSON.stringify(card.btns) === JSON.stringify([['Profile', '#/person/' + big.id], ['Their network', '#/network?p=' + big.id]]), card ? JSON.stringify(card.btns) : '');
  const n2 = await h.canvas('.geo-net-canvas');
  ok('selection highlights the person and dims the rest', n2.hash !== n1.hash);
  await h.shot('network-card-' + width);
  ok('person card fits the screen width', (await h.overflow()).length === 0, (await h.overflow()).join('; '));

  // ego network
  await page.locator('.geo-ncard [data-go^="#/network?p="]').tap();
  await page.waitForTimeout(400);
  await page.waitForSelector('.geo-net-canvas[data-ready="1"]', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
  const e1 = await h.nodes();
  const fo = e1.filter(n => n.focus);
  ok('"Their network" opens the ego network: title has the name', (await h.hash()) === '#/network?p=' + big.id && (await h.title()) === big.name + ': network', await h.title());
  ok('ego network: the person plus up to 60 collaborators', fo.length === 1 && fo[0].id === big.id && e1.length === Math.min(60, T.collab[big.id]) + 1, e1.length + ' people, ' + T.collab[big.id] + ' collaborators in DB');
  await page.waitForTimeout(700);
  const e2 = await h.nodes();
  const fmove = Math.hypot(fo[0].x - e2.find(n => n.focus).x, fo[0].y - e2.find(n => n.focus).y);
  const eg = await h.canvas('.geo-net-canvas');
  ok('ego network: drawn, focus person pinned near the middle', eg.filled > 0.005 && fmove < 0.01 && Math.abs(fo[0].x - cbox.width / 2) < cbox.width * 0.4, 'focus at ' + Math.round(fo[0].x) + ',' + Math.round(fo[0].y));
  await h.shot('network-ego-' + width);
  await page.touchscreen.tap(cbox.x + fo[0].x, cbox.y + fo[0].y);
  await page.waitForTimeout(300);
  ok('tapping the focus person shows their card', (await page.locator('.geo-ncard-name').innerText().catch(() => '')) === big.name);
  await page.locator('[data-act="net-close"]').tap();
  await page.waitForTimeout(200);
  ok('the card closes', await page.locator('.geo-ncard').count() === 0);

  // search jumps to someone else's ego network
  await page.locator('#geo-nq').tap();
  await page.keyboard.type('hoefler', { delay: 25 });
  await page.waitForTimeout(400);
  const res = await page.evaluate(() => Array.from(document.querySelectorAll('.geo-nresults .row')).map(r => [r.dataset.id, r.querySelector('.row-title').textContent]));
  ok('search finds contributors by name', res.length >= 1 && res.every(r => /hoefler/i.test(r[1])) && res[0][0] === T.hoefler, res.map(r => r[1]).join(', '));
  await page.locator('.geo-nresults .row').first().tap();
  await page.waitForTimeout(400);
  await page.waitForSelector('.geo-net-canvas[data-ready="1"]', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
  const hn = await h.nodes();
  ok('picking a search result jumps to that ego network', (await h.hash()) === '#/network?p=' + T.hoefler && /Hoefler: network$/.test(await h.title()) && hn.some(n => n.focus && n.id === T.hoefler), await h.title());

  // color by country, zoom, recenter
  const c0 = await h.canvas('.geo-net-canvas');
  await page.locator('[data-act="net-color"][data-id="country"]').tap();
  await page.waitForTimeout(300);
  const leg = await page.locator('.geo-nlegend').innerText();
  const c1 = await h.canvas('.geo-net-canvas');
  ok('color switch: by country, with a legend', leg.includes('United States') && c0.hash !== c1.hash && (await h.hash()).includes('color=country'), leg.replace(/\s+/g, ' ').slice(0, 80));
  await page.locator('[data-act="net-color"][data-id="sector"]').tap();
  await page.waitForTimeout(200);
  ok('color switch: back to sector', /University|Lab|Industry/.test(await page.locator('.geo-nlegend').innerText()) && !(await h.hash()).includes('color='));
  const mid = { x: cbox.x + cbox.width / 2, y: cbox.y + cbox.height / 2 };
  const s0 = await h.nodes();
  await h.pinch(mid.x, mid.y, 60, 220);
  await page.waitForTimeout(200);
  const s1 = await h.nodes();
  const spread = a => Math.max(...a.map(n => n.x)) - Math.min(...a.map(n => n.x));
  ok('pinch zooms the network', spread(s1) > spread(s0) * 1.5, 'spread ' + Math.round(spread(s0)) + ' then ' + Math.round(spread(s1)) + ' px');
  await page.locator('[data-act="net-fit"]').tap();
  await page.waitForTimeout(700);
  ok('recenter fits the graph again', Math.abs(spread(await h.nodes()) - spread(s0)) < spread(s0) * 0.1);
  await page.locator('[data-act="net-top"]').first().tap();
  await page.waitForTimeout(600);
  ok('"Top 200" returns to the overview', (await h.hash()) === '#/network' && (await h.title()) === 'Collaboration network');
  await h.goto('#/network?p=no-such-person', 700);
  ok('unknown person falls back to the overview', (await h.title()) === 'Collaboration network' && (await h.nodes()).length > 100);

  // ------------------------------------------------------------------- orgs
  await h.goto('#/orgs', 700);
  const idle = await h.rafDelta(700);
  ok('no animation frames keep running after leaving the canvas views', idle <= 2, idle + ' requests in 0.7 s');
  const total = () => page.evaluate(() => +document.getElementById('geo-ocount').dataset.total);
  const rows = () => page.evaluate(() => Array.from(document.querySelectorAll('#geo-olist .row.org')).map(r => ({ t: r.querySelector('.row-title').textContent, sub: r.querySelector('.row-sub').textContent, go: r.dataset.go })));
  const all = await total(), r0 = await rows();
  ok('orgs view: title, lead sentence, sector bar with legend', (await h.title()) === 'Organizations' && await page.locator('p.lead').count() === 1 && await page.locator('.geo-stack i').count() === 4 && await page.locator('.geo-slegend span').count() === 4);
  const sect = await page.evaluate(() => Array.from(document.querySelectorAll('.geo-slegend span')).reduce((a, x) => a + +x.dataset.n, 0));
  ok('sector bar counts every contributor with an organization once', sect === T.orgs.withOrg, sect + ' of ' + T.orgs.withOrg);
  const top = await page.evaluate(() => Array.from(document.querySelectorAll('.geo-top .geo-row')).map(r => [r.dataset.go, r.querySelector('.geo-nm').textContent]));
  ok('top 15 chart lists the 15 largest organizations', top.length === 15 && top[0][1] === T.orgs.topNp && top[0][0] === '#/org/' + T.orgs.topI, top[0] ? top[0][1] : '');
  ok('leaderboard lists all organizations, most contributors first', all === T.orgs.all && r0.length === 30 && r0[0].t.trim().startsWith(T.orgs.topNp) && r0[0].go === '#/org/' + T.orgs.topI, all + ' organizations, ' + r0.length + ' rows rendered');
  await h.shot('orgs-' + width);
  await page.locator('[data-act="org-sector"][data-k="lab"]').scrollIntoViewIfNeeded();
  await page.locator('[data-act="org-sector"][data-k="lab"]').tap();
  await page.waitForTimeout(250);
  const labs = await total(), r1b = await rows();
  ok('sector filter changes the row count', labs === T.orgs.lab && labs !== all && r1b.every(r => / Lab /.test(' ' + r.sub.replace(/·/g, ' ') + ' ')) && (await h.hash()).includes('k=lab'), all + ' then ' + labs + ' labs');
  await page.locator('[data-act="org-sector"][data-k="edu"]').tap();
  await page.waitForTimeout(250);
  ok('sector filter: universities', (await total()) === T.orgs.edu, String(await total()));
  await page.locator('[data-act="org-sector"][data-k="all"]').tap();
  await page.locator('#geo-oq').tap();
  await page.keyboard.type('Argonne', { delay: 25 });
  await page.waitForTimeout(400);
  const found = await total(), r2b = await rows();
  ok('search filters organizations by name', found === T.orgs.argonne && found > 0 && found < all && r2b.length === found && r2b.every(r => /argonne/i.test(r.t)) && (await h.hash()).includes('q=Argonne'), found + ' match "Argonne"');
  await page.locator('#geo-oq').fill('zzqqxx');
  await page.waitForTimeout(350);
  ok('search with no match shows an empty state', (await total()) === 0 && await page.locator('#geo-olist .empty').count() === 1);
  await page.locator('[data-act="org-reset"]').tap();
  await page.waitForTimeout(250);
  ok('clearing the filters restores the full list', (await total()) === all);
  await page.locator('[data-act="org-sort"][data-s="ni"]').tap();
  await page.waitForTimeout(250);
  const r3 = await rows();
  ok('sort switch orders by program items', r3[0].t.trim().startsWith(T.orgs.topNi) && (await h.hash()).includes('s=ni'), r3[0].t.trim());
  await page.evaluate(() => { const v = document.getElementById('view'); v.scrollTop = v.scrollHeight; });
  await page.waitForTimeout(400);
  ok('long list keeps loading while scrolling', (await rows()).length > 30, (await rows()).length + ' rows');
  ok('note says the sector is estimated from the name', /estimated from the organization name/.test(await page.locator('#geo-onote').innerText()));
  ok('orgs view fits the screen width', (await h.overflow()).length === 0, (await h.overflow()).join('; '));

  // Back keeps list state: the filter is in the URL
  await h.goto('#/orgs?k=lab&s=ni&q=national', 500);
  ok('orgs filters can be restored from the link', (await page.locator('#geo-oq').inputValue()) === 'national' && await page.locator('[data-act="org-sector"].on').getAttribute('data-k') === 'lab' && (await total()) > 0 && (await total()) < T.orgs.lab);

  // hop between the screens faster than they can finish loading, then make sure everything shut down cleanly
  for (const x of ['#/globe', '#/network', '#/globe?c=' + T.c.Japan.i, '#/country/' + T.c.Japan.i, '#/network?p=' + T.hoefler, '#/orgs', '#/globe', '#/network', '#/orgs']) await h.goto(x, 40);
  await page.waitForTimeout(900);
  const idle2 = await h.rafDelta(600);
  ok('rapid switching between the screens ends clean', (await h.title()) === 'Organizations' && (await total()) === T.orgs.all && idle2 <= 2, idle2 + ' animation frames in 0.6 s afterwards');

  ok('no page errors at ' + width + ' px', errors.length === 0, errors.slice(0, 4).join(' | '));
  await s.ctx.close();
}

// Screens at a narrow phone: drawn, nothing sticks out sideways.
async function narrow(width) {
  const s = await open(width, 740);
  const { page, errors } = s;
  const h = helpers(s);
  await page.goto(BASE + '#/globe'); await h.ready();
  const T = await truth(page);
  await page.waitForSelector('.geo-stage[data-ready="1"]', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(600);
  const g = await h.canvas('.geo-globe');
  ok(width + ' px: globe is drawn and fits', g.filled > 0.3 && (await h.overflow()).length === 0, (await h.overflow()).join('; '));
  await page.locator('#geo-list .geo-row[data-c="' + T.c['United States'].i + '"]').tap();
  await page.waitForTimeout(1300);
  ok(width + ' px: country card fits', await page.locator('.geo-card[data-c]').count() === 1 && (await h.overflow()).length === 0, (await h.overflow()).join('; '));
  await h.shot('globe-' + width);
  await h.goto('#/country/' + T.c['United States'].i, 600);
  ok(width + ' px: country page fits', await page.locator('.geo-cstats .stat').count() === 3 && (await h.overflow()).length === 0, (await h.overflow()).join('; '));
  await h.shot('country-' + width);
  await h.goto('#/network?p=' + T.hoefler, 300);
  await page.waitForSelector('.geo-net-canvas[data-ready="1"]', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(700);
  const n = await h.canvas('.geo-net-canvas');
  const nodes = await h.nodes();
  const on = nodes.filter(q => q.x > 0 && q.x < width && q.y > 0 && q.y < 740).length;
  ok(width + ' px: network is drawn and fits', n.filled > 0.005 && on >= nodes.length * 0.95 && (await h.overflow()).length === 0, on + '/' + nodes.length + ' on screen; ' + (await h.overflow()).join('; '));
  const fo = nodes.find(q => q.focus), box = (await h.center('.geo-net-canvas')).box;
  await page.touchscreen.tap(box.x + fo.x, box.y + fo.y);
  await page.waitForTimeout(350);
  ok(width + ' px: person card fits', await page.locator('.geo-ncard').count() === 1 && (await h.overflow()).length === 0, (await h.overflow()).join('; '));
  await h.shot('network-' + width);
  await h.goto('#/orgs', 800);
  ok(width + ' px: organizations view fits', await page.locator('#geo-olist .row.org').count() === 30 && (await h.overflow()).length === 0, (await h.overflow()).join('; '));
  await page.evaluate(() => document.querySelector('.geo-otools').scrollIntoView());
  await page.waitForTimeout(200);
  await h.shot('orgs-' + width);
  ok('no page errors at ' + width + ' px', errors.length === 0, errors.slice(0, 4).join(' | '));
  await s.ctx.close();
}

try {
  await suite(W);
  if (W !== 360) await narrow(360);
} catch (e) {
  console.log('✗ test run aborted: ' + (e && e.stack || e));
  failed++;
}
await browser.close();
console.log(failed ? '\n' + failed + ' check(s) FAILED' : '\nall geo checks passed');
process.exit(failed ? 1 : 0);
