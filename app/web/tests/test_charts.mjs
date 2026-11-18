// Regression test for the topic and program insight screens (js/views/charts.js):
// themes, theme and tag detail, topics by day, formats, conference pulse, buzzwords.
//
// Usage:
//   NODE_PATH=/tmp/sc26build/webtest/node_modules node app/web/tests/test_charts.mjs [width]
// Needs the app served at http://127.0.0.1:8765 (see DEV_NOTES.md). Exits 1 on any failed check.
//
// Expected numbers are recomputed here from window.SC26.DB, not taken from the view code.
import { createRequire } from 'module';
const require = createRequire(process.env.NODE_PATH ? process.env.NODE_PATH + '/' : import.meta.url);
const { chromium } = require('playwright-core');

const W = +(process.argv[2] || 412);
const PAGE = process.env.SC26_PAGE || 'index.html';
const BASE = 'http://127.0.0.1:8765/' + PAGE + '?now=2026-11-18T10:40';
let failed = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? '✓ ' : '✗ ') + name + (extra !== '' ? '  [' + extra + ']' : '')); if (!cond) failed++; };

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
async function newPage(width, height, extra = {}) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width, height }, isMobile: true, hasTouch: true }, extra));
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/404|Failed to load resource|view module failed/.test(m.text())) errors.push('console: ' + m.text()); });
  return p;
}
const page = await newPage(W, 915);
const ready = (p = page) => p.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 20000 });
/** Fresh page load of one route. */
const open = async (hash, p = page, settle = 700) => { await p.goto('about:blank'); await p.goto(BASE + hash); await ready(p); await p.waitForTimeout(settle); };
const hash = (p = page) => p.evaluate(() => location.hash);
const title = () => page.evaluate(() => document.getElementById('top-title').textContent);
const tap = async (sel, wait = 450) => { await page.locator(sel).first().tap(); await page.waitForTimeout(wait); };
const count = sel => page.locator(sel).count();
const text = sel => page.locator(sel).first().innerText();
/** First whole number in a string: "1,330 items on Tue 17" -> 1330. */
const int = s => { const m = String(s).replace(/,/g, '').match(/\d+/); return m ? +m[0] : NaN; };
const loadWholeList = async () => {
  for (let i = 0; i < 40 && await count('.vz-list .sentinel'); i++) {
    await page.evaluate(() => { const v = document.getElementById('view'); v.scrollTop = v.scrollHeight; });
    await page.waitForTimeout(120);
  }
};

// independent expectations, computed in the page from the raw data
const VIS = 'const vis = it => !it.brk && (!SC26.Store.state.settings.techOnly || it.grp === "tech");';
const expTheme = id => page.evaluate(new Function('id', VIS + `
  const t = SC26.DB.themes.findIndex(x => x.id === id);
  const items = SC26.DB.items.filter(it => vis(it) && it.th.some(x => x[0] === t));
  const byDay = {}; items.forEach(it => { byDay[it.day] = (byDay[it.day] || 0) + 1; });
  return { name: SC26.DB.themes[t].n, n: items.length, byDay };`), id);

// =================================================================== themes
await open('#/themes');
const failedViews = await page.evaluate(() => window.SC26.failedViews);
ok('charts module loaded', !failedViews.includes('charts'), failedViews.join(','));
const expThemes = await page.evaluate(new Function(VIS + `
  return SC26.DB.themes.map((t, i) => ({ id: t.id, n: SC26.DB.items.filter(it => vis(it) && it.th.some(x => x[0] === i)).length }));`));
const expTags = await page.evaluate(new Function(VIS + `
  return SC26.DB.tags.map((t, i) => ({ i, id: t.id, name: t.n, n: SC26.DB.items.filter(it => vis(it) && it.g.includes(i)).length }));`));
ok('themes: title and lead', await title() === 'Themes' && (await text('.lead')).length > 40);
const blocks = await page.evaluate(() => Array.from(document.querySelectorAll('.vz-blk')).map(g => ({ id: g.dataset.id, n: +g.dataset.n, named: g.dataset.named === '1' })));
ok('themes: one block per theme that has items', blocks.length === expThemes.filter(t => t.n > 0).length && blocks.length > 20, blocks.length + ' blocks');
ok('themes: block sizes match the data', blocks.every(b => expThemes.find(t => t.id === b.id).n === b.n));
ok('themes: most blocks carry their name', blocks.filter(b => b.named).length >= blocks.length * 0.8, blocks.filter(b => b.named).length + ' of ' + blocks.length + ' named');
ok('themes: ranked bars for every theme and every tag', await count('.vz-barrow') === expThemes.length + expTags.length, String(await count('.vz-barrow')));
const barTop = await page.evaluate(() => { const r = document.querySelector('.vz-barrow'); return { go: r.dataset.go, n: r.querySelector('b').textContent }; });
const biggest = expThemes.slice().sort((a, b) => b.n - a.n)[0];
ok('themes: bars are ranked, biggest first', barTop.go === '#/theme/' + biggest.id && int(barTop.n) === biggest.n, barTop.go + ' ' + barTop.n);
ok('themes: links to the heatmap and the galaxy', await count('[data-go="#/heatmap"]') === 1 && await count('.vz [data-go="#/galaxy"]') === 1);
ok('themes: "Official SC26 tags" section', (await page.locator('.sec-h h2').allInnerTexts()).includes('Official SC26 tags'));

const pick = blocks[3];
await tap('.vz-blk[data-id="' + pick.id + '"]');
const pickExp = await expTheme(pick.id);
ok('themes: tapping a block opens that theme', await hash() === '#/theme/' + pick.id && await title() === pickExp.name, await hash());
ok('theme: header count equals the block count', int(await text('.vz-head-count b')) === pick.n && pick.n === pickExp.n, await text('.vz-head-count b'));
await open('#/themes');
await tap('.vz-barrow[data-go^="#/theme/"]');
ok('themes: tapping a bar opens a theme', (await hash()) === '#/theme/' + biggest.id, await hash());
await open('#/themes');
await tap('.vz-barrow[data-go^="#/tag/"]');
const tagHash = await hash();
const tagIdx = +tagHash.split('/')[2];
ok('themes: tapping a tag bar opens the tag', /^#\/tag\/\d+$/.test(tagHash) && await title() === expTags[tagIdx].name, tagHash);
ok('tag: header count matches the data', int(await text('.vz-head-count b')) === expTags[tagIdx].n, await text('.vz-head-count b'));
ok('tag: no galaxy button, lead present', await count('.vz-head [data-go^="#/galaxy"]') === 0 && (await text('.lead')).length > 40);

// ============================================================= theme detail
await open('#/theme/llm');
const llm = await expTheme('llm');
ok('theme: title is the theme name', await title() === llm.name, await title());
ok('theme: item count matches the data', int(await text('.vz-head-count b')) === llm.n, llm.n + ' items');
const heads = await page.locator('.sec-h h2').allInnerTexts();
ok('theme: all sections present', ['When it happens', 'By format', 'Often together with', 'Leading organizations', 'People to talk to'].every(h => heads.includes(h)), heads.join(' | '));
ok('theme: galaxy button targets this theme', await count('.vz-head [data-go="#/galaxy?theme=llm"]') === 1);
ok('theme: one grid row per day with items, 10 hour cells each', await count('.vz-when-row') === Object.keys(llm.byDay).length && await count('.vz-when-row:first-of-type .vz-when-cells i') === 10);
const legendSum = await page.evaluate(() => Array.from(document.querySelectorAll('.vz-legend b')).reduce((a, b) => a + parseInt(b.textContent.replace(/,/g, ''), 10), 0));
ok('theme: format legend adds up to the item count', legendSum === llm.n, String(legendSum));
ok('theme: related themes link to theme pages', await count('.vz-chips .chip[data-go^="#/theme/"]') >= 3 && await count('.vz-chips .chip[data-go="#/theme/llm"]') === 0);
const nOrg = await count('.row.org'), nPpl = await count('.vz-people .row.person');
ok('theme: up to 6 organizations and 8 people', nOrg >= 1 && nOrg <= 6 && nPpl >= 1 && nPpl <= 8, nOrg + ' orgs, ' + nPpl + ' people');
const pplLines = await page.locator('.vz-people .vz-l2').allInnerTexts();
ok('theme: people rows have an avatar and a "items here" line with what is next', await count('.vz-people .row.person .av') === nPpl && pplLines.every(l => /^\d+ items? here · (next |on now|all finished)/.test(l)), pplLines[0]);

// upcoming first, then past
await loadWholeList();
const order = await page.evaluate(() => {
  const kids = Array.from(document.querySelector('.vz-list').children).filter(e => !e.classList.contains('sentinel'));
  const split = kids.findIndex(e => e.classList.contains('vz-subhead') && /Already happened/.test(e.textContent));
  const cards = kids.filter(e => e.classList.contains('it'));
  const before = kids.slice(0, split < 0 ? kids.length : split).filter(e => e.classList.contains('it'));
  const after = split < 0 ? [] : kids.slice(split).filter(e => e.classList.contains('it'));
  return { cards: cards.length, up: before.length, upPast: before.filter(e => e.classList.contains('past')).length, past: after.length, pastNot: after.filter(e => !e.classList.contains('past')).length };
});
const expSplit = await page.evaluate(new Function(VIS + `
  const now = Math.floor((SC26.Store.state.settings.sim.at + (Date.now() - SC26.Store.state.settings.sim.set)) / 60000);
  const t = SC26.DB.themes.findIndex(x => x.id === 'llm');
  const items = SC26.DB.items.filter(it => vis(it) && it.th.some(x => x[0] === t));
  return { up: items.filter(it => it.e > now).length, past: items.filter(it => it.e <= now).length };`));
ok('theme: list holds every item', order.cards === llm.n, order.cards + ' cards');
ok('theme: upcoming items first, then past ones', order.up === expSplit.up && order.past === expSplit.past && order.upPast === 0 && order.pastNot === 0, order.up + ' upcoming, ' + order.past + ' past');

// interest toggle survives a reload
ok('theme: interest starts off', !(await page.evaluate(() => SC26.Store.state.interests.themes.includes('llm'))) && (await text('.vz-int')).includes('Add to my interests'));
await tap('.vz-int');
ok('theme: interest toggle adds the theme id', await page.evaluate(() => SC26.Store.state.interests.themes.includes('llm')) && await page.locator('.vz-int').getAttribute('aria-pressed') === 'true');
await page.reload(); await ready(); await page.waitForTimeout(500);
ok('theme: interest survives a reload', await page.evaluate(() => SC26.Store.state.interests.themes.includes('llm')) &&
  await page.locator('.vz-int').getAttribute('aria-pressed') === 'true' && (await text('.vz-int')).includes('In my interests'));
await tap('.vz-int');
ok('theme: second tap removes it again', !(await page.evaluate(() => SC26.Store.state.interests.themes.includes('llm'))) && await page.locator('.vz-int').getAttribute('aria-pressed') === 'false');
await open('#/tag/7');
await tap('.vz-int');
ok('tag: interest toggle stores the tag id', await page.evaluate(() => SC26.Store.state.interests.tags.includes(SC26.DB.tags[7].id)));
await tap('.vz-int');
ok('tag: second tap removes it', await page.evaluate(() => SC26.Store.state.interests.tags.length === 0));

// day filter
await open('#/theme/llm');
const subAll = await text('.vz-list-sub');
const row = await page.evaluate(() => { const r = document.querySelectorAll('.vz-when-row')[2]; return { d: +r.dataset.id, label: r.querySelector('.vz-when-day').textContent.trim(), n: r.querySelector('.vz-when-n').textContent }; });
await tap('.vz-when-row[data-id="' + row.d + '"]', 900);
await loadWholeList();
const filtered = await page.evaluate(() => ({
  sub: document.querySelector('.vz-list-sub').textContent,
  times: Array.from(document.querySelectorAll('.vz-list .card.it .time')).map(e => e.textContent),
  rowOn: document.querySelectorAll('.vz-when-row.on').length, chipOn: document.querySelector('.vz-daychips .chip.on').textContent,
}));
ok('theme: day row shows the day count', int(row.n) === llm.byDay[row.d], row.label + ' = ' + row.n);
ok('theme: tapping a day filters the list to that day', filtered.times.length === llm.byDay[row.d] && filtered.times.every(t => t.startsWith(row.label)) && int(filtered.sub) === llm.byDay[row.d], filtered.sub);
ok('theme: the list really changed', filtered.sub !== subAll && filtered.times.length < llm.n && filtered.rowOn === 1 && filtered.chipOn.startsWith(row.label), subAll + ' -> ' + filtered.sub);
ok('theme: the day filter is kept in the URL', await hash() === '#/theme/llm?d=' + row.d, await hash());
await page.reload(); await ready(); await page.waitForTimeout(400);
ok('theme: the day filter survives a reload', int(await text('.vz-list-sub')) === llm.byDay[row.d] && await count('.vz-when-row.on') === 1);
await tap('.vz-daychips .chip[data-id="all"]');
ok('theme: "All days" clears the filter', int(await text('.vz-list-sub')) === llm.n && await hash() === '#/theme/llm' && await count('.vz-when-row.on') === 0);

// Back restores a deep scroll position in the lazy list
await open('#/theme/llm');
await page.evaluate(() => { const v = document.getElementById('view'); v.scrollTop = v.scrollHeight; });
await page.waitForTimeout(250);
await page.evaluate(() => { const v = document.getElementById('view'); v.scrollTop = v.scrollHeight; });
await page.waitForTimeout(250);
const deep = await page.evaluate(() => { const c = document.querySelectorAll('.vz-list .card.it'); c[c.length - 3].scrollIntoView({ block: 'center' }); return { cards: c.length, y: document.getElementById('view').scrollTop, title: c[c.length - 3].querySelector('.it-title').textContent }; });
await page.waitForTimeout(150);
await page.locator('.vz-list .card.it .it-title').nth(deep.cards - 3).tap();
await page.waitForTimeout(600);
const awayHash = await hash();
await page.goBack(); await page.waitForTimeout(700);
const backState = await page.evaluate(() => ({ cards: document.querySelectorAll('.vz-list .card.it').length, y: document.getElementById('view').scrollTop }));
ok('theme: Back returns to the same place in a long list', awayHash.startsWith('#/item/') && await hash() === '#/theme/llm' && backState.cards >= deep.cards && Math.abs(backState.y - deep.y) < 300,
  'cards ' + deep.cards + ' -> ' + backState.cards + ', scroll ' + Math.round(deep.y) + ' -> ' + Math.round(backState.y));

await open('#/theme/not-a-theme');
ok('theme: unknown id shows a friendly empty state', (await text('#view .empty h3')) === 'Theme not found');

// ================================================================= heatmap
await open('#/heatmap');
ok('heatmap: title and lead', await title() === 'Topics by day' && (await text('.lead')).length > 40);
const hm = await page.evaluate(() => ({
  rows: document.querySelectorAll('.vz-hm-row:not(.vz-hm-head)').length,
  days: Array.from(document.querySelectorAll('.vz-hm-dayh b')).map(b => b.textContent).join(' '),
  first: document.querySelector('.vz-hm-name').dataset.go,
}));
ok('heatmap: one row per theme, columns Sun to Fri', hm.rows === expThemes.filter(t => t.n > 0).length && hm.days === 'Sun Mon Tue Wed Thu Fri', hm.rows + ' rows, ' + hm.days);
ok('heatmap: rows sorted by total', hm.first === '#/theme/' + biggest.id, hm.first);
const cellSel = '.vz-hm-cell[data-r="1"][data-k="2"]';
const cell = await page.evaluate((sel) => { const c = document.querySelector(sel); const name = c.parentElement.querySelector('.vz-hm-name'); return { n: +c.textContent, go: name.dataset.go, bg: c.style.background }; }, cellSel);
const cellExp = await page.evaluate(new Function('go', VIS + `
  const t = SC26.DB.themes.findIndex(x => '#/theme/' + x.id === go);
  const tue = SC26.DB.meta.days.findIndex(d => new Date(d + 'T00:00:00Z').getUTCDay() === 2);
  return SC26.DB.items.filter(it => vis(it) && it.day === tue && it.th.some(x => x[0] === t)).length;`), cell.go);
ok('heatmap: cell number matches the data', cell.n === cellExp, cell.go + ' on Tue = ' + cell.n);
await tap(cellSel, 600);
const sheetCards = await count('.sheet-body .card.it');
ok('heatmap: tapping a cell opens a sheet with that many item cards', await count('.sheet-wrap.open') === 1 && sheetCards === cell.n && cell.n > 0, sheetCards + ' cards for a cell that says ' + cell.n);
await tap('.sheet [data-act="sheet-close"]', 500);
ok('heatmap: the sheet closes', await count('.sheet-wrap') === 0);
await tap('[data-act="vz-mode"][data-v="abs"]');
const cellAbs = await page.evaluate((sel) => document.querySelector(sel).style.background, cellSel);
const filledCells = await count('.vz-hm-cell[data-n]');
ok('heatmap: "Absolute" recolors the cells and is kept in the URL', cellAbs !== cell.bg && await hash() === '#/heatmap?m=abs' && filledCells > 100, cell.bg + ' -> ' + cellAbs);
await tap('[data-act="vz-src"][data-v="tags"]');
const hmTags = await page.evaluate(() => ({ rows: document.querySelectorAll('.vz-hm-row:not(.vz-hm-head)').length, first: document.querySelector('.vz-hm-name').dataset.go, rel: document.querySelector('[data-act="vz-mode"][data-v="rel"]').textContent }));
ok('heatmap: switch to official tags', hmTags.rows === expTags.filter(t => t.n > 0).length && /^#\/tag\/\d+$/.test(hmTags.first) && await hash() === '#/heatmap?s=tags&m=abs' && hmTags.rel === 'Relative to each tag', hmTags.rows + ' rows');
const tagCell = await page.evaluate(() => { const c = document.querySelector('.vz-hm-cell[data-n]'); return { n: +c.textContent, r: c.dataset.r, k: c.dataset.k }; });
await tap('.vz-hm-cell[data-r="' + tagCell.r + '"][data-k="' + tagCell.k + '"]', 600);
ok('heatmap: tag cells open a matching sheet too', await count('.sheet-body .card.it') === tagCell.n, String(tagCell.n));
await tap('.sheet [data-act="sheet-close"]', 500);
await tap('.vz-hm-name');
ok('heatmap: a row name opens its page', /^#\/tag\/\d+$/.test(await hash()), await hash());

// ================================================================= formats
await open('#/formats', page, 1500);
const expFmt = await page.evaluate(new Function(VIS + `
  const items = SC26.DB.items.filter(vis);
  const by = {}; items.forEach(it => { by[it.f] = (by[it.f] || 0) + 1; });
  const sess = items.filter(it => it.k === 'S');
  return { total: items.length, nonBreak: SC26.DB.items.filter(it => !it.brk && vis(it)).length, formats: Object.keys(by).length,
    hours: Math.round(sess.reduce((a, it) => a + (it.e - it.s), 0) / 60), days: new Set(sess.map(it => it.day)).size,
    top: Object.entries(by).sort((a, b) => b[1] - a[1])[0] };`));
const donut = await page.evaluate(() => ({
  slices: Array.from(document.querySelectorAll('.vz-arc')).map(p => +p.dataset.n),
  drawn: Array.from(document.querySelectorAll('.vz-arc')).filter(p => (p.getAttribute('d') || '').length > 10).length,
  mid: document.querySelector('.vz-donut-mid b').textContent,
  legend: Array.from(document.querySelectorAll('.vz-fmt-row .row-right b')).map(b => +b.dataset.n),
  sub: Array.from(document.querySelectorAll('.sec-sub')).map(e => e.textContent).join(' | '),
  dayRows: document.querySelectorAll('.vz-hrow').length,
}));
const sum = a => a.reduce((x, y) => x + y, 0);
ok('formats: title and lead', await title() === 'Formats' && (await text('.lead')).length > 40);
ok('formats: one slice per format, all drawn after the sweep', donut.slices.length === expFmt.formats && donut.drawn === expFmt.formats, donut.slices.length + ' slices');
ok('formats: donut slices add up to the visible non-break items', sum(donut.slices) === expFmt.nonBreak && expFmt.nonBreak === expFmt.total, sum(donut.slices) + ' = ' + expFmt.nonBreak);
ok('formats: the middle shows the same total', int(donut.mid) === expFmt.total, donut.mid);
ok('formats: legend counts add up too', sum(donut.legend) === expFmt.total && donut.legend.length === expFmt.formats);
ok('formats: total hours of programming match the data', donut.sub.includes(expFmt.hours.toLocaleString('en-US') + ' h in total'), donut.sub);
ok('formats: one bar per day with sessions, and hours in the legend', donut.dayRows === expFmt.days && /\d h of sessions/.test(await text('.vz-fmt-row .row-sub')));
await tap('.vz-arc[data-i="1"]');
const second = await page.evaluate(() => +document.querySelector('.vz-arc[data-i="1"]').dataset.n);
ok('formats: tapping a slice reads it out in the middle', int(await text('.vz-donut-mid b')) === second && await count('.vz-fmt-row.sel') === 1, (await text('.vz-donut-mid')).replace(/\s+/g, ' '));
await tap('.vz-fmt-row');
const topFmtId = await page.evaluate(i => SC26.DB.formats[i].id, +expFmt.top[0]);
const fmtHash = await hash();   // the schedule view may add its own parameters to the URL
ok('formats: tapping a legend row opens the schedule for that format', fmtHash.startsWith('#/schedule?') && fmtHash.split('?')[1].split('&').includes('f=' + topFmtId), fmtHash);

// =================================================================== pulse
await open('#/pulse', page, 1200);
const expPulse = await page.evaluate(new Function(VIS + `
  const tz = SC26.DB.meta.tzOffsetMin;
  const mod = m => (((m + tz) % 1440) + 1440) % 1440;
  const sess = SC26.DB.items.filter(it => it.k === 'S' && vis(it));
  const days = Array.from(new Set(sess.map(it => it.day))).sort((a, b) => a - b);
  let best = { v: 0 };
  const peaks = {};
  for (const d of days) {
    peaks[d] = 0;
    for (let b = 7 * 60; b < 20 * 60; b += 15) {
      let n = 0;
      for (const it of sess) { if (it.day !== d) continue; const s = mod(it.s), e = s + (it.e - it.s); if (s < b + 15 && e > b) n++; }
      if (n > peaks[d]) peaks[d] = n;
      if (n > best.v) best = { v: n, d, b };
    }
  }
  const now = Math.floor((SC26.Store.state.settings.sim.at + (Date.now() - SC26.Store.state.settings.sim.set)) / 60000);
  return { days, peaks, best, hours: Math.round(sess.reduce((a, it) => a + (it.e - it.s), 0) / 60), today: Math.floor((now + tz - Date.parse(SC26.DB.meta.days[0] + 'T00:00:00Z') / 60000) / 1440) };`));
const pulse = await page.evaluate(() => ({
  days: Array.from(document.querySelectorAll('.vz-pulse')).map(c => +c.dataset.d),
  stats: Array.from(document.querySelectorAll('.vz-stats .stat')).map(s => s.innerText.replace(/\s+/g, ' ')),
  peaks: Object.fromEntries(Array.from(document.querySelectorAll('.vz-pulse')).map(c => [c.dataset.d, parseInt(c.querySelector('.vz-peak text').textContent, 10)])),
  now: Array.from(document.querySelectorAll('.vz-pulse')).filter(c => c.querySelector('.vz-now').style.display !== 'none').map(c => +c.dataset.d),
  paths: Array.from(document.querySelectorAll('.vz-pulse .vz-line')).every(p => p.getAttribute('d').length > 50),
}));
ok('pulse: title, lead and three stat tiles', await title() === 'Conference pulse' && (await text('.lead')).length > 40 && pulse.stats.length === 3, pulse.stats.join(' / '));
ok('pulse: one chart per day with sessions', pulse.days.join() === expPulse.days.join() && pulse.paths, pulse.days.join());
ok('pulse: peak labels match a recount of overlapping sessions', expPulse.days.every(d => pulse.peaks[d] === expPulse.peaks[d]), JSON.stringify(pulse.peaks));
const bestClock = (() => { const m = expPulse.best.b, h = Math.floor(m / 60); return (h % 12 === 0 ? 12 : h % 12) + ':' + String(m % 60).padStart(2, '0'); })();
ok('pulse: tiles show the busiest moment, the most parallel sessions and total hours',
  pulse.stats[0].startsWith(bestClock) && int(pulse.stats[1]) === expPulse.best.v && int(pulse.stats[2]) === expPulse.hours, bestClock + ', ' + expPulse.best.v + ', ' + expPulse.hours + ' h');
ok('pulse: "now" marker only on today', pulse.now.join() === String(expPulse.today), 'day ' + pulse.now.join());
await tap('.vz-pulse[data-d="' + expPulse.days[1] + '"]');
const dayHash = await hash();
ok('pulse: tapping a day opens its schedule', dayHash.startsWith('#/schedule?') && dayHash.split('?')[1].split('&').includes('d=' + expPulse.days[1]), dayHash);

// ==================================================================== buzz
await open('#/buzz', page, 1300);
const buzz = await page.evaluate(() => {
  const host = document.querySelector('.vz-cloud'); const hr = host.getBoundingClientRect();
  const ws = Array.from(host.querySelectorAll('.vz-word'));
  const rs = ws.map(w => w.getBoundingClientRect());
  let overlaps = 0;
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
    const a = rs[i], b = rs[j];
    if (a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5) overlaps++;
  }
  const size = q => parseFloat(getComputedStyle(ws.find(w => w.dataset.q === q)).fontSize);
  const buzzData = SC26.DB.buzz.slice().sort((a, b) => b[1] - a[1]);
  return { n: ws.length, expected: SC26.DB.buzz.length, overlaps, cut: ws.filter(w => w.scrollWidth > w.clientWidth + 1).length,
    outside: rs.filter(r => r.left < hr.left - 0.5 || r.right > hr.right + 0.5 || r.top < hr.top - 0.5 || r.bottom > hr.bottom + 0.5).length,
    big: size(buzzData[0][0]), small: size(buzzData[buzzData.length - 1][0]), top: buzzData[0][0], bars: document.querySelectorAll('.vz-barrow').length };
});
ok('buzz: title and lead', await title() === 'Buzzwords' && (await text('.lead')).length > 40);
ok('buzz: every term is in the cloud', buzz.n === buzz.expected && buzz.n > 20, buzz.n + ' words');
ok('buzz: no word overlaps another, leaves the box or is cut off', buzz.overlaps === 0 && buzz.outside === 0 && buzz.cut === 0, buzz.overlaps + ' overlaps, ' + buzz.outside + ' outside, ' + buzz.cut + ' cut');
ok('buzz: frequent words are bigger', buzz.big > buzz.small * 1.8, buzz.top + ' ' + buzz.big + 'px vs ' + buzz.small + 'px');
const word = await page.evaluate(() => document.querySelectorAll('.vz-word')[5].dataset.q);
await page.locator('.vz-word').nth(5).tap(); await page.waitForTimeout(500);
ok('buzz: tapping a word opens the search for it', await hash() === '#/search?q=' + encodeURIComponent(word), await hash());
await open('#/buzz', page, 1300);
const nearMiss = await page.evaluate(() => {
  // 6 px above the smallest word: no direct hit, but close enough for a thumb
  const ws = Array.from(document.querySelectorAll('.vz-word')); const w = ws[ws.length - 1]; const r = w.getBoundingClientRect();
  const x = r.left + r.width / 2; let y = r.top - 5;
  const el = document.elementFromPoint(x, y);
  return { q: w.dataset.q, x, y, direct: !!(el && el.closest('.vz-word')) };
});
if (!nearMiss.direct) {
  await page.touchscreen.tap(nearMiss.x, nearMiss.y); await page.waitForTimeout(500);
  ok('buzz: a near miss still opens the nearest word', (await hash()).startsWith('#/search?q='), await hash());
}
await open('#/buzz', page, 900);
const topBar = await page.evaluate(() => { const r = document.querySelector('.vz-barrow'); return { term: r.querySelector('span').textContent, n: +r.querySelector('b').textContent, max: Math.max(...SC26.DB.buzz.map(b => b[1])) }; });
await tap('.vz-barrow');
ok('buzz: the top list starts with the most frequent term and links to search', topBar.n === topBar.max && await hash() === '#/search?q=' + encodeURIComponent(topBar.term), await hash());

// ======================================================== reduced motion
const calm = await newPage(W, 915, { reducedMotion: 'reduce' });
await calm.goto(BASE + '#/formats'); await ready(calm); await calm.waitForTimeout(120);
const calmDonut = await calm.evaluate(() => ({ drawn: Array.from(document.querySelectorAll('.vz-arc')).every(p => (p.getAttribute('d') || '').length > 10), mid: document.querySelector('.vz-donut-mid b').textContent }));
ok('reduced motion: the donut is complete at once', calmDonut.drawn && int(calmDonut.mid) === expFmt.total, calmDonut.mid);
await calm.goto('about:blank'); await calm.goto(BASE + '#/themes'); await ready(calm); await calm.waitForTimeout(120);
const calmAnim = await calm.evaluate(() => ['.vz-blk-in', '.vz-barrow .track i'].map(s => getComputedStyle(document.querySelector(s)).animationName).join());
ok('reduced motion: no entrance animations', calmAnim === 'none,none', calmAnim);
await calm.context().close();

// ============================================== narrow screen (360 px wide)
const narrow = await newPage(360, 740);
const overflow = () => narrow.evaluate(() => {
  const v = document.getElementById('view'); const vw = window.innerWidth; const bad = [];
  const clipped = e => { for (let a = e.parentElement; a && a !== v; a = a.parentElement) { if (getComputedStyle(a).overflowX !== 'visible') { const r = a.getBoundingClientRect(); if (r.right <= vw + 0.5 && r.left >= -0.5) return true; } } return false; };
  v.querySelectorAll('*').forEach(e => {
    const r = e.getBoundingClientRect();
    if (r.width && (r.right > vw + 0.5 || r.left < -0.5) && !e.closest('.hscroll') && !clipped(e)) bad.push((e.getAttribute('class') || e.tagName) + ' ' + Math.round(r.left) + '..' + Math.round(r.right));
  });
  return { bad, sw: v.scrollWidth, cw: v.clientWidth, text: v.innerText.length, lead: !!v.querySelector('.lead'), broken: !!v.querySelector('.empty') };
});
for (const [route, minText] of [['#/themes', 1200], ['#/theme/physics', 3000], ['#/tag/7', 3000], ['#/heatmap', 900], ['#/heatmap?s=tags&m=abs', 500], ['#/formats', 800], ['#/pulse', 400], ['#/buzz', 700]]) {
  await open(route, narrow, 900);
  const o = await overflow();
  ok('360 px: ' + route + ' renders real content without horizontal overflow', o.bad.length === 0 && o.sw <= o.cw && o.text >= minText && o.lead && !o.broken, o.bad.length ? o.bad.slice(0, 3).join('; ') : o.text + ' chars');
  if (route === '#/heatmap') {
    const names = await narrow.evaluate(() => Array.from(document.querySelectorAll('.vz-hm-name span')).map(s => ({ w: s.getBoundingClientRect().width, cut: s.scrollWidth > s.clientWidth + 1, fs: parseFloat(getComputedStyle(s).fontSize) })));
    ok('360 px: heatmap names stay readable (wide enough, not cut, 12 px or larger)', names.every(n => n.w >= 60 && !n.cut && n.fs >= 12), 'narrowest ' + Math.round(Math.min(...names.map(n => n.w))) + ' px');
  }
  if (route === '#/theme/physics') {
    const btns = await narrow.evaluate(() => Array.from(document.querySelectorAll('.vz-head .btn')).map(b => b.scrollWidth <= b.clientWidth + 1));
    ok('360 px: header buttons are not cut off', btns.length === 2 && btns.every(Boolean));
  }
}
await narrow.context().close();

ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(failed ? '\n' + failed + ' check(s) FAILED' : '\nall checks passed');
process.exit(failed ? 1 : 0);
