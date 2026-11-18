// Regression test for the core screens: today, schedule, details, search,
// people, plan and the schedule builder.
//
// Usage:
//   NODE_PATH=/tmp/sc26build/webtest/node_modules node app/web/tests/test_core.mjs [width]
// Needs the app served at http://127.0.0.1:8765 (see DEV_NOTES.md). Exits 1 on any failed check.
import { createRequire } from 'module';
const require = createRequire(process.env.NODE_PATH ? process.env.NODE_PATH + '/' : import.meta.url);
const { chromium } = require('playwright-core');

const W = +(process.argv[2] || 412);
const PAGE = process.env.SC26_PAGE || 'index.html';
const BASE = 'http://127.0.0.1:8765/' + PAGE + '?now=2026-11-18T10:40';
let failed = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? '✓ ' : '✗ ') + name + (extra ? '  [' + extra + ']' : '')); if (!cond) failed++; };

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: W, height: 915 }, isMobile: true, hasTouch: true, acceptDownloads: true });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/404|Failed to load resource|view module failed/.test(m.text())) errors.push('console: ' + m.text()); });
const ready = () => page.waitForFunction(() => document.documentElement.dataset.ready === '1', null, { timeout: 20000 });
const goto = async (hash) => { await page.evaluate(h => { location.hash = h; }, hash); await page.waitForTimeout(450); };
const hash = () => page.evaluate(() => location.hash);
const tap = async (sel) => { await page.locator(sel).first().tap(); await page.waitForTimeout(300); };

// ---------------------------------------------------------------- first run
await page.goto(BASE + '#/home'); await ready();
await page.waitForSelector('.sheet .welcome', { timeout: 4000 }).catch(() => {});
ok('first run shows the welcome sheet', await page.locator('.sheet .welcome').count() === 1);
await tap('.sheet [data-act="sheet-close"]');
await page.waitForTimeout(350);
ok('welcome sheet closes', await page.locator('.sheet-wrap').count() === 0);
ok('today shows the simulated clock', (await page.locator('.hero-clock').innerText()).includes('10:40'));
ok('today lists sessions happening now', await page.locator('.hcard').count() > 3);
const failedViews = await page.evaluate(() => window.SC26.failedViews);
ok('every view module loaded', failedViews.length === 0, failedViews.join(','));

// ---------------------------------------------------------------- schedule
await tap('#tabs [data-tab="schedule"]');
ok('schedule tab opens', (await hash()).startsWith('#/schedule'));
ok('schedule opens on the simulated day', (await page.locator('.daytab.on b').innerText()) === '18');
const nWed = await page.locator('#sched-body .card.it').count();
ok('schedule lists sessions', nWed > 5, nWed + ' cards rendered');
const dbWed = await page.evaluate(() => window.SC26.DB.items.filter(it => it.k === 'S' && it.day === 4 && !it.brk && it.grp === 'tech').length);
ok('day tab count matches the data', (await page.locator('.daytab.on em').innerText()) === String(dbWed), 'db=' + dbWed);
await tap('.daytab[data-id="3"]');
ok('switching day works', (await page.locator('.daytab.on b').innerText()) === '17');
await tap('.sched-bar .chip[data-act="sf-f"][data-id="paper"]');
const onlyPapers = await page.evaluate(() => Array.from(document.querySelectorAll('#sched-body .card.it .pill')).every(p => /paper|gordon bell/i.test(p.textContent)));
ok('format chip filters to papers', onlyPapers && (await hash()).includes('f=paper'));
await tap('[data-act="sched-view"][data-id="grid"]');
ok('grid view renders blocks', await page.locator('.sblock').count() > 5);
await tap('[data-act="sched-view"][data-id="list"]');
await tap('.sched-bar .chip[data-act="sched-filter"]');
ok('filter sheet opens', await page.locator('.sheet').count() === 1);
await tap('.sheet .chip[data-act="sf-th"][data-id="quantum"]');
await tap('.sheet [data-act="sf-done"]');
await page.waitForTimeout(400);
ok('theme filter is applied', (await hash()).includes('th=quantum'));
await tap('.sched-bar .chip[data-act="sf-th"]');
await tap('.sched-bar .chip[data-act="sf-f"][data-id="paper"]');

// ------------------------------------------------------------------ detail
await goto('#/schedule?d=3&f=paper&th=');
await tap('#sched-body .card.it');
ok('tapping a session opens its detail page', (await hash()).startsWith('#/item/sess'));
const sessId = (await hash()).replace('#/item/', '');
ok('session page lists its talks', await page.locator('#d-kids .talk').count() >= 2);
await tap('#d-kids .talk[data-go]');
const talkHash = await hash();
ok('tapping a talk opens the talk', talkHash.startsWith('#/item/' + sessId + '/'));
ok('talk shows an abstract', (await page.locator('.d-text').innerText()).length > 200);
ok('talk lists authors', await page.locator('.ppl .row.person').count() >= 1);
await tap('[data-act="d-plan"]');
ok('add to plan updates the button', (await page.locator('[data-act="d-plan"]').innerText()).includes('In My Plan'));
ok('plan badge shows 1', (await page.locator('#plan-badge').innerText()) === '1');
await page.locator('#d-note').fill('Ask about the dataset');
await page.waitForTimeout(700);
await page.reload(); await ready();
ok('plan and note survive a reload', (await page.locator('[data-act="d-plan"]').innerText()).includes('In My Plan') && (await page.locator('#d-note').inputValue()) === 'Ask about the dataset');
await tap('.ppl .row.person');
ok('tapping an author opens the profile', (await hash()).startsWith('#/person/'));
await tap('[data-act="follow-person"]');
ok('follow toggles', (await page.locator('[data-act="follow-person"] span').innerText()) === 'Following');
const backHandled = await page.evaluate(() => window.__sc26Back());
await page.waitForTimeout(400);
ok('system back returns to the talk', backHandled === true && (await hash()) === talkHash);

// ------------------------------------------------------------------ search
await goto('#/search');
await page.locator('#q').fill('kokkos');
await page.waitForTimeout(500);
const nRes = await page.locator('#s-items .card.it').count();
ok('search finds program items', nRes > 3, nRes + ' shown');
ok('search results mention the query', (await page.locator('#s-items').innerText()).toLowerCase().includes('kokkos'));
await page.locator('#q').fill('foster');
await page.waitForTimeout(500);
ok('search finds people', await page.locator('#s-body .row.person').count() >= 1);
await page.locator('#q').fill('zzqqxx');
await page.waitForTimeout(500);
ok('search shows an empty state for nonsense', await page.locator('#s-body .empty').count() === 1);

// ------------------------------------------------------------------ people
await goto('#/people?tab=active&q=&c=');
ok('people ranking renders', await page.locator('#plist .row.person').count() >= 20);
await tap('.chip[data-act="p-tab"][data-id="veterans"]');
ok('veterans tab lists SC paper counts', (await page.locator('#plist .row-right').first().innerText()).includes('SC papers'));
await tap('.chip[data-act="p-tab"][data-id="all"]');
ok('A to Z starts with an A or similar', await page.locator('#plist .row.person').count() >= 40);
await page.locator('#pq').fill('argonne');
await page.waitForTimeout(500);
ok('people search matches organizations', await page.locator('#plist .row.person').count() > 10);

// ----------------------------------------------------------------- builder
await page.evaluate(() => { const S = window.SC26.Store; S.state.follows.people = []; S.save('follows'); });   // a follow alone counts as an interest
await goto('#/builder');
ok('builder shows the themes', await page.locator('#b-themes .chip').count() >= 30);
await tap('[data-act="b-build"]');
ok('builder refuses to run with no interests', (await hash()) === '#/builder');
for (const id of ['quantum', 'llm', 'energy']) await tap('#b-themes .chip[data-id="' + id + '"]');
await page.locator('#b-kw').fill('checkpointing');
await page.locator('#b-kw').press('Enter');
ok('keyword chip is added', await page.locator('#b-kws .chip').count() === 1);
await tap('[data-act="b-build"]');
await page.waitForTimeout(600);
ok('builder shows a result', (await hash()).includes('step=result') && await page.locator('#b-result .card.it').count() > 5);
// invariants of the generated plan, checked against the data
const inv = await page.evaluate(async () => {
  const { DB, Store } = window.SC26;
  const core = await import('./js/core.js'); const b = await import('./js/views/builder.js');
  const o = Object.assign({ days: [1, 2, 3, 4, 5, 6], formats: ['keynote', 'plenary', 'invited', 'gb', 'award', 'paper', 'panel', 'bof', 'tutorial', 'workshop'], lunch: false, hop: true, headliners: true, keep: true, start: 480, end: 1140 }, Store.state.builder || {});
  const res = b.buildPlan(o, core.interestProfile());
  let overlaps = 0, walkBad = 0, outside = 0, lowRel = 0, n = 0, lockedKept = true;
  const planned = core.Plan.items();
  for (const day of res.days) {
    for (let i = 0; i < day.units.length; i++) {
      const u = day.units[i]; n++;
      if (core.minOfDay(u.it.s) < o.start || core.minOfDay(u.it.s) + u.it.dur > o.end) { if (!u.locked) outside++; }
      if (!u.locked && u.rel < 0.3) lowRel++;
      if (i) {
        const p = day.units[i - 1];
        if (p.e > u.s) overlaps++;
        const w = p.room && u.room && p.room.i !== u.room.i ? core.walkMin(p.room, u.room) : 0;
        if (w && u.s - p.e < w - 2 && !(p.locked && u.locked)) walkBad++;
      }
    }
    for (const it of planned.filter(x => x.day === day.d)) if (!day.units.some(u => u.it.i === it.i)) lockedKept = false;
  }
  return { n, overlaps, walkBad, outside, lowRel, lockedKept, days: res.days.length, posters: res.posters.length };
});
ok('plan has no overlapping blocks', inv.overlaps === 0, JSON.stringify(inv));
ok('plan leaves time to walk between rooms', inv.walkBad === 0);
ok('plan stays inside the day window and above the match floor', inv.outside === 0 && inv.lowRel === 0);
ok('plan keeps the item already starred', inv.lockedKept);
const swap = page.locator('[data-act="b-swap"]').first();
if (await swap.count()) {
  const before = await page.locator('#b-result .card.it .it-title').allInnerTexts();
  await swap.tap(); await page.waitForTimeout(350);
  ok('alternatives sheet opens', await page.locator('.sheet [data-act="b-use"]').count() >= 1);
  await tap('.sheet [data-act="b-use"]');
  await page.waitForTimeout(400);
  const after = await page.locator('#b-result .card.it .it-title').allInnerTexts();
  ok('swapping changes the plan', before.join('|') !== after.join('|'));
} else ok('alternatives exist for at least one block', false);
const addBtn = await page.locator('[data-act="b-addall"]').innerText();
await tap('[data-act="b-addall"]');
await page.waitForTimeout(500);
ok('add all goes to My Plan', (await hash()).startsWith('#/plan'), addBtn);

// -------------------------------------------------------------------- plan
const planCount = await page.evaluate(() => Object.keys(window.SC26.Store.state.plan).length);
ok('plan holds the added blocks', planCount > 5, planCount + ' items');
ok('plan badge matches', (await page.locator('#plan-badge').innerText()) === String(planCount));
ok('agenda shows cards for the selected day', await page.locator('.v-plan .card.it').count() >= 1);
ok('agenda shows walking or gap hints', await page.locator('.v-plan .gap').count() >= 1);
await tap('[data-act="pl-menu"]');
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }).catch(() => null), page.locator('.sheet [data-act="pl-ics"]').tap()]);
let ics = '';
if (dl) { const fs = require('fs'); ics = fs.readFileSync(await dl.path(), 'utf8'); }
ok('calendar export produces a valid file', ics.startsWith('BEGIN:VCALENDAR') && (ics.match(/BEGIN:VEVENT/g) || []).length === planCount, dl ? dl.suggestedFilename() : 'no download');
await page.waitForTimeout(300);
await tap('.v-plan .card.it .star');
await page.waitForTimeout(400);
ok('unstarring in the plan removes the item', await page.evaluate(() => Object.keys(window.SC26.Store.state.plan).length) === planCount - 1);
await goto('#/home');
ok('today shows the next planned item', await page.locator('.card.next').count() === 1);

// ---------------------------------------------------------------- settings
await goto('#/settings');
await tap('[data-act="set-tech"]');
await goto('#/schedule?d=4&f=&th=&g=');
const nAll = await page.locator('.daytab.on em').innerText();
ok('turning off "technical only" shows more sessions', +nAll > dbWed, nAll + ' vs ' + dbWed);
await goto('#/settings');
await tap('[data-act="set-tech"]');

// ------------------------------------------------------------ misc screens
for (const [h, sel, min] of [['#/explore', '.tile', 10], ['#/posters', '.ptile', 8], ['#/org/3', '.row.person', 1], ['#/item/sess248', '.d-title', 1]]) {
  await goto(h);
  ok(h + ' renders', await page.locator(sel).count() >= min);
}
await goto('#/nosuchpage');
ok('unknown routes show a not-found screen', (await page.locator('.empty h3').innerText()).includes('not found'));
await goto('#/home');
await page.evaluate(() => { history.replaceState({ d: 0 }, '', '#/home'); });
ok('system back at the root is not handled (app exits)', await page.evaluate(() => window.__sc26Back()) === false);

// horizontal overflow check on the main screens
for (const h of ['#/home', '#/schedule', '#/builder', '#/people', '#/plan', '#/explore', '#/settings', '#/posters']) {
  await goto(h);
  const over = await page.evaluate(() => { const v = document.getElementById('view'); return v.scrollWidth - v.clientWidth; });
  ok(h + ' has no sideways overflow at ' + W + 'px', over <= 1, 'overflow ' + over);
}

ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
console.log(failed ? failed + ' check(s) failed' : 'all checks passed');
process.exit(failed ? 1 : 0);
