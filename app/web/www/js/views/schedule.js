// Schedule: browse a day as a list grouped by start time, or as a room-by-time grid.
import {
  DB, Plan, Store, nowMin, dayOf, dayInfo, fmtTime, fmtRange, minOfDay, fmtClock, visible, roomOf, fmtOf, bus,
} from '../core.js';
import { registerView, setQuery } from '../router.js';
import { esc, icon, itemCard, talkRow, chip, emptyState, openSheet, closeSheet, lazyList } from '../ui.js';

// what the user last looked at, kept for the session
const memo = { d: null, f: [], g: [], th: [], mine: false, live: false, v: 'list' };
const QUICK = ['paper', 'workshop', 'tutorial', 'bof', 'panel', 'invited', 'keynote', 'poster'];

function defaultDay() {
  const now = nowMin();
  const counts = dayCounts();
  let d = dayOf(now);
  if (d < 0 || d >= DB.nDays || !counts[d]) d = counts.findIndex((c, i) => c > 0 && (i >= d || d >= DB.nDays));
  if (d < 0) d = counts.findIndex(c => c > 0);
  return Math.max(0, d);
}
function dayCounts() {
  const c = new Array(DB.nDays).fill(0);
  for (const it of DB.items) if (it.k === 'S' && visible(it) && it.day >= 0 && it.day < DB.nDays) c[it.day]++;
  return c;
}
function readState(q) {
  if (q.d != null && q.d !== '') memo.d = Math.max(0, Math.min(DB.nDays - 1, +q.d || 0));
  if (memo.d == null) memo.d = defaultDay();
  if (q.f != null) memo.f = q.f ? q.f.split(',').filter(id => DB.fmtIdx[id] != null) : [];
  if (q.g != null) memo.g = q.g ? q.g.split(',').map(Number).filter(i => DB.tags[i]) : [];
  if (q.th != null) memo.th = q.th ? q.th.split(',').filter(id => DB.themeIdx[id] != null) : [];
  if (q.mine != null) memo.mine = q.mine === '1';
  if (q.live != null) memo.live = q.live === '1';
  if (q.v != null) memo.v = q.v === 'grid' ? 'grid' : 'list';
}
function writeState() {
  setQuery({ d: memo.d, f: memo.f.join(','), g: memo.g.join(','), th: memo.th.join(','), mine: memo.mine ? 1 : '', live: memo.live ? 1 : '', v: memo.v === 'grid' ? 'grid' : '' });
}

/** Does a leaf or session match the topic filters by itself? */
function topicHit(it, tagSet, themeSet) {
  if (tagSet.size && !it.g.some(g => tagSet.has(g))) return false;
  if (themeSet.size && !it.th.some(([t]) => themeSet.has(t))) return false;
  return true;
}
function filtered(day) {
  const now = nowMin();
  const fset = new Set(memo.f.map(id => DB.fmtIdx[id]));
  const tagSet = new Set(memo.g), themeSet = new Set(memo.th.map(id => DB.themeIdx[id]));
  const topical = tagSet.size || themeSet.size;
  const out = [];
  for (const it of DB.items) {
    if (it.k !== 'S' || it.day !== day || !visible(it)) continue;
    if (fset.size && !it.fs.some(f => fset.has(f))) continue;
    if (memo.live && !(it.s <= now && now < it.e)) continue;
    const kids = it.ch.map(c => DB.items[c]).filter(c => !c.brk);
    if (memo.mine && !Plan.has(it.id) && !kids.some(c => Plan.has(c.id))) continue;
    let hits = null;
    if (topical) {
      const own = topicHit(it, tagSet, themeSet);
      const kidHits = kids.filter(c => topicHit(c, tagSet, themeSet));
      if (!own && !kidHits.length) continue;
      if (kidHits.length && kidHits.length < kids.length) hits = kidHits;
    }
    out.push({ it, hits });
  }
  out.sort((a, b) => a.it.s - b.it.s || a.it.e - b.it.e || a.it.f - b.it.f || (a.it.t < b.it.t ? -1 : 1));
  return out;
}

function filterSheet(ctx) {
  const fmts = DB.formats.filter(f => DB.items.some(it => it.k === 'S' && it.fs.includes(f.i) && visible(it)));
  const body = openSheet(
    '<div class="toggle"><div><b>Only what is in My Plan</b><span>Sessions you starred, or that hold a starred talk</span></div><button class="sw' + (memo.mine ? ' on' : '') + '" data-act="sf-mine" aria-label="Only my plan"></button></div>' +
    '<div class="toggle"><div><b>Technical program only</b><span>Hide receptions, logistics, exhibits and student events</span></div><button class="sw' + (Store.state.settings.techOnly ? ' on' : '') + '" data-act="sf-tech" aria-label="Technical program only"></button></div>' +
    '<h4 class="sheet-sub">Format</h4><div class="chips">' + fmts.map(f => chip(f.n, { act: 'sf-f', id: f.id, color: f.c, on: memo.f.includes(f.id) })).join('') + '</div>' +
    '<h4 class="sheet-sub">Research theme</h4><div class="chips">' + DB.themes.map(t => chip(t.n, { act: 'sf-th', id: t.id, color: t.c, on: memo.th.includes(t.id), cls: 'sm' })).join('') + '</div>' +
    '<h4 class="sheet-sub">Official SC26 tag</h4><div class="chips">' + DB.tags.map(t => chip(t.n, { act: 'sf-g', id: t.i, on: memo.g.includes(t.i), cls: 'sm' })).join('') + '</div>' +
    '<div class="btnrow" style="margin-top:18px"><button class="btn" data-act="sf-clear">Clear all</button><button class="btn primary" data-act="sf-done">Show sessions</button></div>',
    { title: 'Filter the schedule', tall: true, onClose: () => { writeState(); ctx.rerender({ top: true }); } });
  return body;
}

function renderList(host, day, rows) {
  const now = nowMin();
  if (!rows.length) {
    host.innerHTML = emptyState('calendar', 'Nothing matches', 'No sessions on this day pass the current filters.', '<button class="btn" data-act="sf-clear">Clear filters</button>');
    return null;
  }
  // group by start time
  const groups = [];
  for (const r of rows) {
    const g = groups[groups.length - 1];
    if (g && g.s === r.it.s) g.rows.push(r); else groups.push({ s: r.it.s, rows: [r] });
  }
  const isToday = dayOf(now) === day;
  // where to land on open: the block that started most recently, else the next one to start
  let anchorIdx = -1;
  if (isToday) {
    for (let i = 0; i < groups.length; i++) if (groups[i].s <= now && groups[i].rows.some(r => r.it.e > now)) anchorIdx = i;
    if (anchorIdx < 0) anchorIdx = groups.findIndex(g => g.s > now);
  }
  const stop = lazyList(host, groups.length, (a, b) => {
    let h = '';
    for (let i = a; i < b; i++) {
      const g = groups[i];
      const liveGroup = isToday && g.rows.some(r => r.it.s <= now && now < r.it.e);
      const upcoming = i === anchorIdx;
      h += '<div class="timehead' + (liveGroup ? ' now' : '') + '"' + (upcoming ? ' id="sched-now"' : '') + '><b>' + fmtTime(g.s) + '</b><span>' + g.rows.length + (g.rows.length === 1 ? ' session' : ' sessions') + (liveGroup ? ' · running now' : '') + '</span></div>';
      for (const { it, hits } of g.rows) {
        const extra = hits ? '<div class="sub-talks"><div class="sub-talks-h">' + hits.length + ' matching ' + (hits.length === 1 ? 'talk' : 'talks') + '</div>' + hits.slice(0, 6).map(c => talkRow(c)).join('') +
          (hits.length > 6 ? '<div class="note">and ' + (hits.length - 6) + ' more inside</div>' : '') + '</div>' : '';
        // for a session that is running, say which talk is on stage
        const cur = isToday && it.s <= now && now < it.e ? it.ch.map(c => DB.items[c]).find(c => !c.brk && c.s <= now && now < c.e) : null;
        const stage = cur && it.ch.length > 1 ? '<div class="onstage"><i>On stage</i> ' + esc(cur.t) + '</div>' : '';
        h += itemCard(it, { dense: true, extra: stage + extra });
      }
    }
    return h;
  }, Math.max(6, anchorIdx + 3));
  return stop;
}

function renderGrid(host, day, rows) {
  const now = nowMin();
  const list = rows.map(r => r.it).filter(it => it.r != null && it.dur <= 600);
  if (!list.length) { host.innerHTML = emptyState('grid', 'Nothing to lay out', 'No sessions with a room pass the current filters.'); return; }
  const lo = Math.floor(Math.min(...list.map(it => minOfDay(it.s))) / 60) * 60;
  const hi = Math.ceil(Math.max(...list.map(it => minOfDay(it.s) + it.dur)) / 60) * 60;
  const PPM = 1.5, COLW = 138, AXW = 46, HEADH = 38;
  const order = { 'West Building': 0, 'South Building': 1, 'Lakeside Center': 2 };
  const rooms = Array.from(new Set(list.map(it => it.r))).map(i => DB.rooms[i])
    .sort((a, b) => (order[a.b] ?? 9) - (order[b.b] ?? 9) || (a.f < b.f ? -1 : a.f > b.f ? 1 : 0) || a.n.localeCompare(b.n, 'en', { numeric: true }));
  // sessions that overlap in the same room share the column side by side
  const lanes = new Map();
  for (const r of rooms) {
    const its = list.filter(it => it.r === r.i).sort((a, b) => a.s - b.s || b.e - a.e);
    const ends = [];
    for (const it of its) {
      let k = ends.findIndex(e => e <= it.s);
      if (k < 0) { k = ends.length; ends.push(0); }
      ends[k] = it.e; it._lane = k;
    }
    lanes.set(r.i, Math.max(1, ends.length));
  }
  const H = (hi - lo) * PPM;
  let x = AXW; const colX = new Map();
  for (const r of rooms) { colX.set(r.i, x); x += COLW * Math.min(2, lanes.get(r.i)) + 6; }
  const W = x;
  let h = '<div class="sgrid" style="width:' + W + 'px;height:' + (H + HEADH) + 'px">';
  h += '<div class="sgrid-head" style="height:' + HEADH + 'px">';
  for (const r of rooms) h += '<div class="sgrid-room" data-go="#/room/' + r.i + '" style="left:' + colX.get(r.i) + 'px;width:' + (COLW * Math.min(2, lanes.get(r.i))) + 'px">' + esc(r.n) + '</div>';
  h += '</div><div class="sgrid-axis" style="top:' + HEADH + 'px;height:' + H + 'px">';
  for (let m = lo; m <= hi; m += 60) h += '<span style="top:' + ((m - lo) * PPM) + 'px">' + fmtClock(m).replace(':00', '') + '</span>';
  h += '</div><div class="sgrid-body" style="top:' + HEADH + 'px;height:' + H + 'px">';
  for (let m = lo; m <= hi; m += 60) h += '<i class="sgrid-line" style="top:' + ((m - lo) * PPM) + 'px"></i>';
  if (dayOf(now) === day && minOfDay(now) >= lo && minOfDay(now) <= hi) h += '<i class="sgrid-now" id="sgrid-now" style="top:' + ((minOfDay(now) - lo) * PPM) + 'px"></i>';
  for (const it of list) {
    const n = Math.min(2, lanes.get(it.r));
    const w = COLW * n / Math.min(n, lanes.get(it.r) > 2 ? 2 : lanes.get(it.r));
    const lane = Math.min(it._lane, n - 1);
    const top = (minOfDay(it.s) - lo) * PPM, hh = Math.max(20, it.dur * PPM - 3);
    h += '<div class="sblock' + (Plan.has(it.id) ? ' mine' : '') + (now >= it.e ? ' past' : '') + '" data-go="#/item/' + esc(it.id) + '" style="--c:' + fmtOf(it).c + ';left:' + (colX.get(it.r) + lane * w) + 'px;top:' + top + 'px;width:' + (w - 3) + 'px;height:' + hh + 'px">' +
      '<b>' + esc(it.t) + '</b>' + (hh > 44 ? '<span>' + fmtRange(it.s, it.e) + '</span>' : '') + '</div>';
  }
  h += '</div></div>';
  host.innerHTML = '<div class="sgrid-wrap">' + h + '</div><p class="note" style="margin:8px 2px 0">Scroll sideways for more rooms. Colors show the format. A gold edge marks sessions in your plan.</p>';
  const wrap = host.querySelector('.sgrid-wrap');
  const avail = document.getElementById('view').clientHeight - wrap.getBoundingClientRect().top + document.getElementById('view').getBoundingClientRect().top - 44;
  wrap.style.height = Math.max(320, avail) + 'px';
  const nowLine = host.querySelector('#sgrid-now');
  if (nowLine) wrap.scrollTop = Math.max(0, parseFloat(nowLine.style.top) - 120);
}

registerView('schedule', {
  title: 'Schedule', tab: 'schedule', root: true,
  render(el, ctx) {
    readState(ctx.query);
    const counts = dayCounts();
    const today = dayOf(nowMin());
    const nFilters = memo.f.length + memo.g.length + memo.th.length + (memo.mine ? 1 : 0) + (memo.live ? 1 : 0);
    let h = '<div class="daytabs" id="sched-days">';
    for (let d = 0; d < DB.nDays; d++) {
      if (!counts[d]) continue;
      const di = dayInfo(d);
      h += '<button class="daytab' + (d === memo.d ? ' on' : '') + (d === today ? ' today' : '') + '" data-act="sched-day" data-id="' + d + '"><small>' + di.dow + '</small><b>' + di.date + '</b><em>' + counts[d] + '</em></button>';
    }
    h += '</div>';
    h += '<div class="sched-bar"><div class="hscroll" style="flex:1;margin:0;padding-left:0">' +
      chip(nFilters ? 'Filters' : 'Filter', { act: 'sched-filter', icon: 'sliders', count: nFilters || null, on: nFilters > 0 }) +
      (memo.live ? chip('Live now', { act: 'sched-live', on: true, icon: 'live' }) : '') +
      (memo.mine ? chip('My plan', { act: 'sched-mine', on: true, icon: 'star' }) : '') +
      memo.th.map(id => chip(DB.themes[DB.themeIdx[id]].n, { act: 'sf-th', id, on: true, color: DB.themes[DB.themeIdx[id]].c })).join('') +
      memo.g.map(i => chip(DB.tags[i].n, { act: 'sf-g', id: i, on: true })).join('') +
      QUICK.filter(id => DB.fmtIdx[id] != null).map(id => { const f = DB.formats[DB.fmtIdx[id]]; return chip(f.n, { act: 'sf-f', id, color: f.c, on: memo.f.includes(id) }); }).join('') +
      memo.f.filter(id => !QUICK.includes(id)).map(id => { const f = DB.formats[DB.fmtIdx[id]]; return chip(f.n, { act: 'sf-f', id, color: f.c, on: true }); }).join('') +
      '</div><div class="seg mini"><button class="' + (memo.v === 'list' ? 'on' : '') + '" data-act="sched-view" data-id="list" aria-label="List view">' + icon('list') + '</button>' +
      '<button class="' + (memo.v === 'grid' ? 'on' : '') + '" data-act="sched-view" data-id="grid" aria-label="Room grid view">' + icon('grid') + '</button></div></div>';
    h += '<div id="sched-body"></div>';
    el.innerHTML = h;
    writeState();
    const rows = filtered(memo.d);
    const host = el.querySelector('#sched-body');
    let stop = null;
    if (memo.v === 'grid') renderGrid(host, memo.d, rows); else stop = renderList(host, memo.d, rows);
    const tab = el.querySelector('.daytab.on'); if (tab) tab.scrollIntoView({ inline: 'center', block: 'nearest' });
    if (!ctx.isBack && memo.v === 'list') {
      const anchor = el.querySelector('#sched-now');
      if (anchor) requestAnimationFrame(() => { el.scrollTop = Math.max(0, anchor.offsetTop - 60); });
    }

    const toggle = (arr, v) => { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); };
    const inSheet = t => !!t.closest('.sheet');
    const flip = (t) => { t.classList.toggle('on'); };
    // the URL carries the state, so write it before re-rendering
    const apply = (o) => { writeState(); ctx.rerender(o); };
    ctx.on('sched-day', t => { memo.d = +t.dataset.id; memo.live = false; apply({ top: true }); });
    ctx.on('sched-view', t => { memo.v = t.dataset.id; apply({ top: true }); });
    ctx.on('sched-filter', () => filterSheet(ctx));
    ctx.on('sched-live', () => { memo.live = false; apply({ top: true }); });
    ctx.on('sched-mine', () => { memo.mine = false; apply({ top: true }); });
    ctx.on('sf-f', t => { toggle(memo.f, t.dataset.id); writeState(); if (inSheet(t)) flip(t); else ctx.rerender({ top: true }); });
    ctx.on('sf-th', t => { toggle(memo.th, t.dataset.id); writeState(); if (inSheet(t)) flip(t); else ctx.rerender({ top: true }); });
    ctx.on('sf-g', t => { toggle(memo.g, +t.dataset.id); writeState(); if (inSheet(t)) flip(t); else ctx.rerender({ top: true }); });
    ctx.on('sf-mine', t => { memo.mine = !memo.mine; writeState(); flip(t); });
    ctx.on('sf-tech', t => { Store.state.settings.techOnly = !Store.state.settings.techOnly; Store.save('settings'); flip(t); });
    ctx.on('sf-clear', () => { memo.f = []; memo.g = []; memo.th = []; memo.mine = false; memo.live = false; writeState(); if (!closeSheet()) ctx.rerender({ top: true }); });
    ctx.on('sf-done', () => closeSheet());
    const off = bus.on('plan', () => { if (memo.mine) ctx.rerender(); });
    return () => { off(); if (stop) stop(); };
  },
});
