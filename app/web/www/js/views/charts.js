// SC26 Atlas: topic and program insight screens.
//   #/themes             the curated research themes as a block map and ranked bars, plus the official tags
//   #/theme/<themeId>    one theme: when, formats, related themes, organizations, people, items (?d=<day> filters the list)
//   #/tag/<tagIdx>       the same layout for an official SC26 tag
//   #/heatmap            themes or tags by conference day (?s=tags switches rows, ?m=abs switches the color scale)
//   #/formats            program formats: donut, legend with hours, hours per day
//   #/pulse              how many sessions run in parallel through each day
//   #/buzz               word cloud of frequent title terms
import { DB, Store, nowMin, visible, dayInfo, dayOf, minOfDay, fmtTime, fmtClock, roomOf } from '../core.js';
import { registerView, go, setQuery } from '../router.js';
import { esc, icon, chip, section, itemCard, personRow, orgRow, openSheet, lazyList, emptyState, toast } from '../ui.js';

const d3 = window.d3;
const TAG_COLOR = '#818CF8';     // official tags have no color of their own
const HEAT_COLOR = '#22D3EE';    // single hue for magnitude
const INK_DARK = '#071022';
const FONT = 'system-ui, -apple-system, Roboto, "Segoe UI", sans-serif';

// ------------------------------------------------------------------ helpers
const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const num = n => Number(n).toLocaleString('en-US');
const nItems = n => num(n) + (n === 1 ? ' item' : ' items');
const delay = (i, step = 18, cap = 30) => 'animation-delay:' + Math.min(i, cap) * step + 'ms';
const fmtHours = min => { const h = min / 60; return (h >= 10 ? num(Math.round(h)) : String(Math.round(h * 10) / 10)) + ' h'; };
const pctText = f => (f > 0 && f < 0.01 ? '<1%' : Math.round(f * 100) + '%');

function rgba(hex, a) {
  const c = d3.rgb(hex);
  return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + Math.round(a * 1000) / 1000 + ')';
}
/** Near-black or white, whichever reads better on a fill. */
function inkOn(hex) {
  const c = d3.rgb(hex);
  const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const L = 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  return L > 0.19 ? INK_DARK : '#FFFFFF';
}
let measureCtx = null;
function textW(s, size, weight = 600) {
  if (measureCtx === null) { try { measureCtx = document.createElement('canvas').getContext('2d'); } catch (e) { measureCtx = false; } }
  if (!measureCtx) return s.length * size * 0.58;
  measureCtx.font = weight + ' ' + size + 'px ' + FONT;
  return measureCtx.measureText(s).width;
}
/** Conference days Sunday to Friday as day indexes. */
function weekDays() {
  const out = [];
  for (let d = 0; d < DB.nDays; d++) if (dayInfo(d).dow !== 'Sat') out.push(d);
  return out;
}
/** Themes or tags with their visible items. */
function rowsOf(kind) {
  const isTag = kind === 'tags';
  return (isTag ? DB.tags : DB.themes).map(t => {
    const items = t.items.map(i => DB.items[i]).filter(visible);
    return { id: t.id, i: t.i, n: t.n, c: isTag ? TAG_COLOR : t.c, go: isTag ? '#/tag/' + t.i : '#/theme/' + encodeURIComponent(t.id), items, count: items.length };
  });
}
const bySize = (a, b) => b.count - a.count || a.n.localeCompare(b.n);

/** Ranked bar rows. rows: [{n, count, go, c}] */
function barRows(rows) {
  const max = Math.max(1, ...rows.map(r => r.count));
  return '<div class="bars">' + rows.map((r, i) =>
    '<div class="barrow vz-barrow" data-go="' + esc(r.go) + '" style="--c:' + r.c + '">' +
    '<span>' + esc(r.n) + '</span>' +
    '<span class="track"><i style="width:' + (r.count / max * 100).toFixed(1) + '%;' + delay(i) + '"></i></span>' +
    '<b>' + num(r.count) + '</b></div>').join('') + '</div>';
}
function linkTile(goTo, ic, color, title, sub) {
  return '<div class="tile" data-go="' + goTo + '" style="--c:' + color + '">' + icon(ic) + '<b>' + esc(title) + '</b><span>' + esc(sub) + '</span></div>';
}
/** One whole split into parts. parts: [{c, v, label}] */
function stackBar(parts, cls = '') {
  return '<span class="vz-stack ' + cls + '">' + parts.filter(p => p.v > 0).map(p =>
    '<i style="flex-grow:' + p.v + ';background:' + p.c + '"></i>').join('') + '</span>';
}
function legend(parts) {
  return '<div class="legend vz-legend">' + parts.map(p => '<span><i style="--c:' + p.c + '"></i>' + esc(p.label) + (p.val != null ? ' <b>' + p.val + '</b>' : '') + '</span>').join('') + '</div>';
}
function onWidthChange(el, fn) {
  let w = el.clientWidth; let timer = null;
  const h = () => { clearTimeout(timer); timer = setTimeout(() => { if (el.clientWidth && el.clientWidth !== w) { w = el.clientWidth; fn(); } }, 160); };
  window.addEventListener('resize', h);
  return () => { clearTimeout(timer); window.removeEventListener('resize', h); };
}

// ======================================================= themes: block map
/** Text before the first comma or ampersand: "GPUs & Accelerators" -> "GPUs". */
const shortName = n => n.split(/,| & /)[0].trim();
/** Greedy wrap into at most maxLines lines of width maxW. Null when it does not fit. */
function wrapLines(text, size, weight, maxW, maxLines) {
  const words = text.replace(/ & /g, ' &\u00A0').split(' ');
  const lines = []; let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (textW(t, size, weight) <= maxW) { line = t; continue; }
    if (!line || lines.length + 1 >= maxLines || textW(w, size, weight) > maxW) return null;
    lines.push(line); line = w;
  }
  if (line) lines.push(line);
  return lines.length <= maxLines ? lines : null;
}
/**
 * Treemap in horizontal strips. Area is proportional to the count, and every block stays wider
 * than a squarified treemap would make it, which is what lets the names fit on a phone.
 */
function stripCells(data, W, H) {
  const T = d3.sum(data, d => d.count);
  const minW = Math.max(60, W * 0.19), maxH = Math.max(64, H * 0.16), minH = 24;
  const sum = row => d3.sum(row, d => d.count);
  const rows = []; let cur = [], S = 0;
  for (const d of data) {
    const S2 = S + d.count;
    if (cur.length >= 2 && (S2 / T * H > maxH || d.count / S2 * W < minW)) { rows.push(cur); cur = []; S = 0; }
    cur.push(d); S += d.count;
  }
  if (cur.length) rows.push(cur);
  while (rows.length > 1 && sum(rows[rows.length - 1]) / T * H < minH) { const last = rows.pop(); rows[rows.length - 1] = rows[rows.length - 1].concat(last); }
  const cells = []; let y = 0;
  for (const row of rows) {
    const rs = sum(row), h = rs / T * H; let x = 0;
    for (const d of row) { const w = d.count / rs * W; cells.push({ row: d, x0: x, y0: y, x1: x + w, y1: y + h }); x += w; }
    y += h;
  }
  return cells;
}
function blockLabel(row, w, h) {
  const PX = 5, PY = 4;
  const m = Math.min(w, h);
  const sizes = m >= 70 ? [14, 13, 12, 11, 10] : m >= 44 ? [12.5, 11.5, 10.5, 9.5] : [11, 10, 9.5];
  const names = row.n === shortName(row.n) ? [row.n] : [row.n, shortName(row.n)];
  for (const withCount of [true, false]) {
    for (const name of names) {
      for (const size of (name === row.n ? sizes : sizes.filter(v => v <= 12.5))) {
        const lh = size * 1.18;
        const maxLines = Math.floor((h - 2 * PY) / lh) - (withCount ? 1 : 0);
        if (maxLines < 1) continue;
        const lines = wrapLines(name, size, 650, w - 2 * PX, Math.min(4, maxLines));
        if (lines) return { size, lh, lines, withCount, PX, PY };
      }
    }
  }
  return null;
}
function treemapSvg(rows, W) {
  const data = rows.filter(r => r.count > 0).sort(bySize);
  if (!data.length) return '';
  const GAP = 3;
  const H = Math.round(Math.min(W * 1.45, 620));
  let out = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Map of research themes, each block sized by its number of items. The ranked list below has the same numbers.">';
  stripCells(data, W, H).forEach((c, i) => {
    const row = c.row;
    const x0 = c.x0 + (c.x0 > 0.01 ? GAP / 2 : 0), x1 = c.x1 - (c.x1 < W - 0.01 ? GAP / 2 : 0);
    const y0 = c.y0 + (c.y0 > 0.01 ? GAP / 2 : 0), y1 = c.y1 - (c.y1 < H - 0.01 ? GAP / 2 : 0);
    const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
    const ink = inkOn(row.c);
    const lab = blockLabel(row, w, h);
    let text = '';
    if (lab) {
      const n = lab.lines.length + (lab.withCount ? 1 : 0);
      const top = h < 46 ? (h - n * lab.lh) / 2 : lab.PY;          // short blocks center their text
      text = '<text fill="' + ink + '" font-size="' + lab.size + '">' +
        lab.lines.map((ln, j) => '<tspan x="' + lab.PX + '" y="' + (top + lab.lh * (j + 0.5)).toFixed(1) + '">' + esc(ln) + '</tspan>').join('') +
        (lab.withCount ? '<tspan class="vz-blk-n" x="' + lab.PX + '" y="' + (top + lab.lh * (lab.lines.length + 0.5)).toFixed(1) + '">' + num(row.count) + '</tspan>' : '') + '</text>';
    } else if (w >= 20 && h >= 14) {
      text = '<text class="vz-blk-n" fill="' + ink + '" font-size="10.5" x="' + (w / 2).toFixed(1) + '" y="' + (h / 2).toFixed(1) + '" text-anchor="middle">' + num(row.count) + '</text>';
    }
    out += '<g class="vz-blk" data-go="' + esc(row.go) + '" data-id="' + esc(row.id) + '" data-n="' + row.count + '" data-named="' + (lab ? 1 : 0) + '" transform="translate(' + x0.toFixed(1) + ',' + y0.toFixed(1) + ')">' +
      '<g class="vz-blk-in" style="' + delay(i, 16, 40) + '"><rect width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="7" fill="' + row.c + '"/>' + text + '</g></g>';
  });
  return out + '</svg>';
}

registerView('themes', {
  title: 'Themes', tab: 'explore',
  render(el) {
    el.classList.add('vz');
    const themes = rowsOf('themes').sort(bySize);
    const tags = rowsOf('tags').sort(bySize);
    const covered = new Set();
    themes.forEach(r => r.items.forEach(it => covered.add(it.i)));
    el.innerHTML =
      '<p class="lead">The ' + themes.length + ' research themes running through SC26, sized by how many sessions, talks and posters touch each one.</p>' +
      '<div class="card vz-map"></div>' +
      '<p class="note vz-cap">Tap a block to open its theme. One item can sit in several themes.</p>' +
      '<div class="grid2 vz-links">' +
      linkTile('#/heatmap', 'grid', '#22D3EE', 'Topics by day', 'When each theme peaks') +
      linkTile('#/galaxy', 'sparkles', '#C084FC', 'Topic galaxy', 'Every talk on one map') + '</div>' +
      section('All themes, ranked', '<div class="card pad">' + barRows(themes) + '</div>', { sub: num(covered.size) + ' items carry a theme' }) +
      section('Official SC26 tags', '<div class="card pad">' + barRows(tags) + '</div>', { sub: 'labels set by the conference' });
    const host = el.querySelector('.vz-map');
    host.innerHTML = treemapSvg(themes, Math.max(260, Math.min(520, host.clientWidth - 12)));
  },
});

// ===================================================== theme and tag detail
const HOUR0 = 8, HOUR1 = 18;                 // "When it happens" covers 8 AM to 6 PM
const BACKSTAGE = new Set(['chair', 'moderator', 'organizer', 'alternate']);
const listMemo = new Map();                  // list key -> cards rendered, so Back can restore a deep scroll position

function hourLabel(h) {
  if ((h - HOUR0) % 2) return '';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return h12 + (h === HOUR0 ? (h < 12 ? ' AM' : ' PM') : h === 12 ? ' PM' : '');
}
function whenShort(m, now) {
  const d = dayOf(m);
  return (d === dayOf(now) ? 'today' : dayInfo(d).dow) + ' ' + fmtTime(m);
}

function detailView(kind) {
  const isTheme = kind === 'theme';
  const find = args => (isTheme ? DB.themes[DB.themeIdx[args[0]]] : (/^\d+$/.test(args[0] || '') ? DB.tags[+args[0]] : null)) || null;
  return {
    title: args => { const s = find(args); return s ? s.n : (isTheme ? 'Theme' : 'Tag'); },
    tab: 'explore',
    render(el, ctx) {
      el.classList.add('vz');
      const src = find(ctx.args);
      if (!src) {
        el.innerHTML = emptyState('compass', isTheme ? 'Theme not found' : 'Tag not found', 'It is not part of this program.', '<button class="btn" data-go="#/themes">See all themes</button>');
        return undefined;
      }
      const storeKey = isTheme ? 'themes' : 'tags';
      const color = isTheme ? src.c : TAG_COLOR;
      const items = src.items.map(i => DB.items[i]).filter(visible);
      const now = nowMin();
      const today = dayOf(now);
      const peers = rowsOf(storeKey).sort(bySize);
      const rank = peers.findIndex(r => r.i === src.i) + 1;
      const nSess = items.filter(it => it.k === 'S').length;

      // ---- header
      const interests = () => {
        if (!Array.isArray(Store.state.interests[storeKey])) Store.state.interests[storeKey] = [];
        return Store.state.interests[storeKey];
      };
      const interestBtn = () => {
        const on = interests().includes(src.id);
        return '<button class="btn vz-int' + (on ? ' is-on' : '') + '" data-act="vz-interest" aria-pressed="' + on + '">' + icon(on ? 'check' : 'plus') +
          '<span>' + (on ? 'In my interests' : 'Add to my interests') + '</span></button>';
      };
      let html = '<p class="lead">' + (isTheme ? 'Everything at SC26 that touches this research theme' : 'Everything the SC26 program files under this official tag') +
        ': when it runs, who is behind it, and every session, talk and poster.</p>' +
        '<div class="card pad vz-head" style="--c:' + color + '">' +
        '<div class="vz-head-kind"><i></i>' + (isTheme ? 'Research theme' : 'Official SC26 tag') + (items.length ? ' · #' + rank + ' of ' + peers.length + ' by size' : '') + '</div>' +
        '<h2 class="vz-head-name">' + esc(src.n) + '</h2>' +
        '<div class="vz-head-count"><b>' + num(items.length) + '</b><span>' + (items.length === 1 ? 'item' : 'items') +
        (items.length ? ' · ' + num(nSess) + (nSess === 1 ? ' session, ' : ' sessions, ') + num(items.length - nSess) + ' talks and posters' : '') + '</span></div>' +
        '<div class="btnrow">' + interestBtn() +
        (isTheme ? '<button class="btn" data-go="#/galaxy?theme=' + encodeURIComponent(src.id) + '">' + icon('sparkles') + '<span>See in galaxy</span></button>' : '') +
        '</div></div>';
      ctx.on('vz-interest', (btn) => {
        const arr = interests(); const i = arr.indexOf(src.id);
        if (i >= 0) arr.splice(i, 1); else arr.push(src.id);
        Store.save('interests');
        btn.outerHTML = interestBtn();
        toast(i >= 0 ? 'Removed from your interests' : 'Added to your interests');
      });
      if (!items.length) {
        el.innerHTML = html + emptyState('filter', 'Nothing to show here', Store.state.settings.techOnly
          ? 'No technical program items carry this label. Community and exhibitor sessions are hidden by a setting.' : 'No program items carry this label.',
          Store.state.settings.techOnly ? '<button class="btn" data-go="#/settings">Open Settings</button>' : '');
        return undefined;
      }

      // ---- when it happens
      const byDay = new Map();
      for (const it of items) { if (!byDay.has(it.day)) byDay.set(it.day, []); byDay.get(it.day).push(it); }
      const grid = Array.from(byDay.keys()).sort((a, b) => a - b).map(d => {
        const cells = new Array(HOUR1 - HOUR0).fill(0);
        for (const it of byDay.get(d)) {
          const s = minOfDay(it.s), e = Math.max(s + it.dur, s + 1);
          for (let h = HOUR0; h < HOUR1; h++) if (s < (h + 1) * 60 && e > h * 60) cells[h - HOUR0]++;
        }
        return { d, n: byDay.get(d).length, cells };
      });
      const cellMax = Math.max(1, ...grid.map(g => Math.max(...g.cells)));
      const hours = d3.range(HOUR0, HOUR1);
      html += section('When it happens',
        '<div class="card vz-when">' +
        '<div class="vz-when-head"><span></span><span class="vz-when-hours">' + hours.map(h => '<i>' + hourLabel(h) + '</i>').join('') + '</span><span></span></div>' +
        grid.map((g, gi) => {
          const di = dayInfo(g.d);
          return '<button class="vz-when-row' + (g.d === today ? ' today' : '') + '" data-act="vz-day" data-id="' + g.d + '" aria-pressed="false" aria-label="' +
            esc(di.long + ', ' + nItems(g.n) + '. Tap to filter the list.') + '">' +
            '<span class="vz-when-day"><b>' + di.dow + '</b> ' + di.date + '</span>' +
            '<span class="vz-when-cells">' + g.cells.map((v, k) => '<i style="' + (v ? 'background:' + rgba(color, 0.16 + 0.84 * Math.pow(v / cellMax, 0.8)) + ';' : '') + delay(gi * 2 + k, 14, 40) + '"></i>').join('') + '</span>' +
            '<b class="vz-when-n">' + num(g.n) + '</b></button>';
        }).join('') +
        '<p class="note">Brighter means more items running in that hour (up to ' + num(cellMax) + '). Tap a day to list only that day.</p></div>',
        { sub: '8 AM to 6 PM' });

      // ---- by format
      const fm = d3.rollups(items, v => v.length, it => it.f).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
      const parts = fm.map(([f, n]) => ({ c: DB.formats[f].c, v: n, label: DB.formats[f].n, val: num(n) }));
      html += section('By format', '<div class="card pad">' + stackBar(parts, 'vz-wipe') + legend(parts) + '</div>');

      // ---- often together with
      const co = new Map();
      for (const it of items) for (const [t] of it.th) if (!isTheme || t !== src.i) co.set(t, (co.get(t) || 0) + 1);
      const coTop = Array.from(co).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 8);
      if (coTop.length) {
        html += section('Often together with', '<div class="chips vz-chips">' +
          coTop.map(([t, n]) => chip(DB.themes[t].n, { go: '#/theme/' + encodeURIComponent(DB.themes[t].id), color: DB.themes[t].c, count: n })).join('') + '</div>',
          { sub: 'shared items' });
      }

      // ---- organizations and people
      const orgItems = new Map(), orgPeople = new Map(), ppl = new Map();
      for (const it of items) {
        const st = isTheme ? ((it.th.find(x => x[0] === src.i) || [0, 5])[1]) / 9 : 1;
        const seenOrg = new Set(); const best = new Map();
        for (const [pi, role, pres] of it.p) {
          const p = DB.people[pi];
          for (const o of p.o) {
            if (!seenOrg.has(o)) { seenOrg.add(o); orgItems.set(o, (orgItems.get(o) || 0) + 1); }
            if (!orgPeople.has(o)) orgPeople.set(o, new Set());
            orgPeople.get(o).add(pi);
          }
          // presenting authors count double; chairs and organizers count half
          const w = BACKSTAGE.has(DB.roles[role]) ? 0.5 : (pres ? 2 : 1);
          if (w > (best.get(pi) || 0)) best.set(pi, w);
        }
        for (const [pi, w] of best) {
          if (!ppl.has(pi)) ppl.set(pi, { p: DB.people[pi], score: 0, its: [] });
          const e = ppl.get(pi); e.score += st * w; e.its.push(it);
        }
      }
      const orgTop = Array.from(orgItems).sort((a, b) => b[1] - a[1] || orgPeople.get(b[0]).size - orgPeople.get(a[0]).size || a[0] - b[0]).slice(0, 6);
      if (orgTop.length) {
        html += section('Leading organizations', '<div class="card list">' + orgTop.map(([o, n]) => {
          const np = orgPeople.get(o).size;
          return orgRow(DB.orgs[o], { sub: num(np) + (np === 1 ? ' person' : ' people') + ' involved here', right: '<b>' + num(n) + '</b>' + (n === 1 ? 'item' : 'items') });
        }).join('') + '</div>', { sub: 'by items here' });
      }
      const pplTop = Array.from(ppl.values()).sort((a, b) => b.score - a.score || b.its.length - a.its.length || b.p.w - a.p.w || a.p.n.localeCompare(b.p.n)).slice(0, 8);
      if (pplTop.length) {
        html += section('People to talk to', '<div class="card list vz-people">' + pplTop.map(e => {
          const its = e.its.slice().sort((a, b) => a.s - b.s);
          const nx = its.find(it => it.e > now);
          let line = its.length + (its.length === 1 ? ' item here' : ' items here');
          if (nx) { const r = roomOf(nx); line += ' · ' + (nx.s <= now ? 'on now' : 'next ' + whenShort(nx.s, now)) + (r ? ' in ' + r.n : ''); } else line += ' · all finished';
          const org = e.p.o.length ? DB.orgs[e.p.o[0]].n : '';
          return personRow(e.p, { sub: (org ? '<span class="vz-l1">' + esc(org) + '</span>' : '') + '<span class="vz-l2">' + esc(line) + '</span>' });
        }).join('') + '</div>', { sub: 'most involved here' });
      }

      // ---- the items
      html += '<section class="sec vz-list-sec"><div class="sec-h"><h2>Sessions, talks and posters</h2><span class="sec-sub vz-list-sub"></span></div>' +
        '<div class="hscroll vz-daychips"></div><div class="vz-list"></div></section>';
      el.innerHTML = html;

      const listSec = el.querySelector('.vz-list-sec'), listEl = el.querySelector('.vz-list');
      const subEl = el.querySelector('.vz-list-sub'), chipsEl = el.querySelector('.vz-daychips');
      let dayFilter = /^\d+$/.test(ctx.query.d || '') && byDay.has(+ctx.query.d) ? +ctx.query.d : null;
      let stopLazy = null; let firstPaint = true;
      const paint = () => {
        el.querySelectorAll('.vz-when-row').forEach(r => {
          const on = +r.dataset.id === dayFilter;
          r.classList.toggle('on', on); r.classList.toggle('dim', dayFilter != null && !on); r.setAttribute('aria-pressed', String(on));
        });
        chipsEl.innerHTML = chip('All days', { act: 'vz-day', id: 'all', on: dayFilter == null, count: items.length }) +
          grid.map(g => chip(dayInfo(g.d).dow + ' ' + dayInfo(g.d).date, { act: 'vz-day', id: g.d, on: dayFilter === g.d, count: g.n })).join('');
        const onChip = chipsEl.querySelector('.chip.on');
        if (onChip) chipsEl.scrollLeft += onChip.getBoundingClientRect().left - chipsEl.getBoundingClientRect().left - (chipsEl.clientWidth - onChip.offsetWidth) / 2;
        const t = nowMin();
        const pool = dayFilter == null ? items : byDay.get(dayFilter);
        const up = pool.filter(it => it.e > t).sort((a, b) => a.s - b.s || a.e - b.e || a.i - b.i);
        const past = pool.filter(it => it.e <= t).sort((a, b) => a.s - b.s || a.e - b.e || a.i - b.i);
        const rows = [];
        if (up.length && past.length) rows.push('<div class="vz-subhead">Coming up<span>' + num(up.length) + '</span></div>');
        for (const it of up) rows.push(it);
        if (past.length) rows.push('<div class="vz-subhead">Already happened<span>' + num(past.length) + '</span></div>');
        for (const it of past) rows.push(it);
        subEl.textContent = nItems(pool.length) + (dayFilter != null ? ' on ' + dayInfo(dayFilter).label : '');
        if (stopLazy) stopLazy();
        listEl.innerHTML = '';
        const memoKey = kind + ':' + src.id + ':' + dayFilter;
        const chunk = Math.max(30, firstPaint && ctx.isBack ? (listMemo.get(memoKey) || 0) : 0);
        firstPaint = false;
        stopLazy = lazyList(listEl, rows.length, (a, b) => {
          listMemo.set(memoKey, b);
          return rows.slice(a, b).map(r => (typeof r === 'string' ? r : itemCard(r, { showDay: true, parent: true }))).join('');
        }, chunk);
      };
      paint();
      ctx.on('vz-day', (t) => {
        const d = t.dataset.id === 'all' ? null : +t.dataset.id;
        dayFilter = d == null || d === dayFilter ? null : d;
        setQuery({ d: dayFilter });
        paint();
        if (dayFilter != null && t.classList.contains('vz-when-row')) listSec.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
      });
      return () => { if (stopLazy) stopLazy(); };
    },
  };
}
registerView('theme', detailView('theme'));
registerView('tag', detailView('tag'));

// ================================================================= heatmap
registerView('heatmap', {
  title: 'Topics by day', tab: 'explore',
  render(el, ctx) {
    el.classList.add('vz');
    let mode = ctx.query.m === 'abs' ? 'abs' : 'rel';
    let kind = ctx.query.s === 'tags' ? 'tags' : 'themes';
    const days = weekDays();
    const today = dayOf(nowMin());
    let rows = []; let gmax = 1;
    const one = () => (kind === 'tags' ? 'tag' : 'theme');

    el.innerHTML =
      '<p class="lead">How many sessions, talks and posters each topic has on each conference day; tap a number to list them.</p>' +
      '<div class="seg vz-seg" role="group" aria-label="Rows"><button data-act="vz-src" data-v="themes">Curated themes</button><button data-act="vz-src" data-v="tags">Official tags</button></div>' +
      '<div class="seg vz-seg" role="group" aria-label="Color scale"><button data-act="vz-mode" data-v="rel"></button><button data-act="vz-mode" data-v="abs">Absolute</button></div>' +
      '<div class="vz-hm-key"><span>fewer</span><i></i><span>more</span><em></em></div>' +
      '<div class="card vz-hm"></div>';
    const host = el.querySelector('.vz-hm');

    const paintCells = () => {
      host.querySelectorAll('.vz-hm-cell[data-n]').forEach(c => {
        const n = +c.dataset.n; const r = rows[+c.dataset.r];
        const t = n / (mode === 'rel' ? r.max : gmax);
        const a = 0.13 + 0.82 * Math.pow(t, 0.85);
        c.style.background = rgba(HEAT_COLOR, a);
        c.classList.toggle('hi', a > 0.56);
      });
      el.querySelectorAll('[data-act="vz-mode"]').forEach(b => { const on = b.dataset.v === mode; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
      el.querySelector('[data-act="vz-mode"][data-v="rel"]').textContent = 'Relative to each ' + one();
      el.querySelector('.vz-hm-key em').textContent = mode === 'rel'
        ? 'Each row is colored against its own busiest day.'
        : 'All cells share one scale. The fullest cell holds ' + num(gmax) + ' items.';
    };
    const build = () => {
      rows = rowsOf(kind).filter(r => r.count > 0).sort(bySize);
      gmax = 1;
      for (const r of rows) {
        r.byDay = days.map(d => r.items.filter(it => it.day === d));
        r.max = Math.max(1, ...r.byDay.map(a => a.length));
        if (r.max > gmax) gmax = r.max;
      }
      el.querySelectorAll('[data-act="vz-src"]').forEach(b => { const on = b.dataset.v === kind; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
      host.innerHTML =
        '<div class="vz-hm-row vz-hm-head"><span class="vz-hm-corner">' + (kind === 'tags' ? 'Tag' : 'Theme') + '</span>' +
        days.map(d => { const di = dayInfo(d); return '<span class="vz-hm-dayh' + (d === today ? ' today' : '') + '"><b>' + di.dow + '</b>' + di.date + '</span>'; }).join('') + '</div>' +
        rows.map((r, ri) =>
          '<div class="vz-hm-row" style="' + delay(ri, 14, 26) + '">' +
          '<div class="vz-hm-name" data-go="' + esc(r.go) + '"><i style="background:' + r.c + '"></i><span>' + esc(r.n) + '</span></div>' +
          r.byDay.map((a, k) => (a.length
            ? '<button class="vz-hm-cell" data-act="vz-cell" data-r="' + ri + '" data-k="' + k + '" data-n="' + a.length + '" aria-label="' +
              esc(r.n + ', ' + dayInfo(days[k]).long + ': ' + nItems(a.length)) + '">' + a.length + '</button>'
            : '<span class="vz-hm-cell zero" aria-hidden="true"></span>')).join('') +
          '</div>').join('');
      paintCells();
    };
    build();

    ctx.on('vz-mode', (b) => { if (b.dataset.v === mode) return; mode = b.dataset.v; setQuery({ s: kind === 'tags' ? 'tags' : null, m: mode === 'abs' ? 'abs' : null }); paintCells(); });
    ctx.on('vz-src', (b) => { if (b.dataset.v === kind) return; kind = b.dataset.v; setQuery({ s: kind === 'tags' ? 'tags' : null, m: mode === 'abs' ? 'abs' : null }); build(); });
    ctx.on('vz-cell', (c) => {
      const r = rows[+c.dataset.r]; const k = +c.dataset.k;
      if (!r || !r.byDay[k]) return;
      const list = r.byDay[k].slice().sort((a, b) => a.s - b.s || a.e - b.e || a.i - b.i);
      const di = dayInfo(days[k]);
      openSheet('<p class="lead">' + nItems(list.length) + ' on ' + esc(di.long) + '.</p>' +
        list.map(it => itemCard(it, { parent: true })).join('') +
        '<button class="btn block" data-go="' + esc(r.go) + '">Open the ' + one() + ' page' + icon('chevR') + '</button>',
        { title: r.n, tall: list.length > 3 });
    });
  },
});

// ================================================================= formats
registerView('formats', {
  title: 'Formats', tab: 'explore',
  render(el, ctx) {
    el.classList.add('vz');
    const items = DB.items.filter(visible);
    const total = items.length;
    const stat = new Map();
    for (const it of items) {
      if (!stat.has(it.f)) stat.set(it.f, { f: it.f, fmt: DB.formats[it.f], n: 0, min: 0 });
      const e = stat.get(it.f); e.n++;
      if (it.k === 'S') e.min += it.dur;          // session time only: talks sit inside their session
    }
    const rows = Array.from(stat.values()).sort((a, b) => b.n - a.n || a.f - b.f);
    if (!total) { el.innerHTML = emptyState('chart', 'No program items', 'There is nothing to chart.'); return undefined; }
    const totalMin = d3.sum(rows, r => r.min);

    // donut geometry
    const R = 116, R0 = 82;
    const pie = d3.pie().sort(null).value(r => Math.max(r.n, total * 0.004)).padAngle(0.018);
    const arcs = pie(rows);
    const arc = d3.arc().innerRadius(R0).outerRadius(R).cornerRadius(3);

    // hours per day
    const dayMap = new Map();
    for (const it of items) {
      if (it.k !== 'S') continue;
      if (!dayMap.has(it.day)) dayMap.set(it.day, { d: it.day, tot: 0, by: new Map() });
      const e = dayMap.get(it.day); e.tot += it.dur; e.by.set(it.f, (e.by.get(it.f) || 0) + it.dur);
    }
    const dayRows = Array.from(dayMap.values()).sort((a, b) => a.d - b.d);
    const dayMax = Math.max(1, ...dayRows.map(d => d.tot));

    el.innerHTML =
      '<p class="lead">What SC26 is made of: every slice is one format, sized by its number of sessions, talks and posters.</p>' +
      '<div class="card vz-donut"><div class="vz-donut-box">' +
      '<svg viewBox="-120 -120 240 240" role="img" aria-label="Donut chart of program items by format. The list below has the same numbers.">' +
      arcs.map((a, i) => '<path class="vz-arc" data-act="vz-slice" data-i="' + i + '" data-f="' + a.data.f + '" data-n="' + a.data.n + '" fill="' + a.data.fmt.c + '" d="' + arc(a) + '"/>').join('') +
      '</svg><div class="vz-donut-mid"><b></b><span></span></div></div>' +
      '<p class="note">Tap a slice to read it. Tap a format below to open its sessions.</p></div>' +
      section('Formats by size', '<div class="card list vz-fmt-list">' + rows.map((r, i) =>
        '<div class="row vz-fmt-row" data-go="#/schedule?f=' + encodeURIComponent(r.fmt.id) + '" data-f="' + r.f + '">' +
        '<span class="vz-sw" style="background:' + r.fmt.c + '"></span>' +
        '<div class="row-main"><div class="row-title">' + esc(r.fmt.n) + '</div>' +
        '<div class="row-sub">' + pctText(r.n / total) + ' of items · ' + (r.min ? fmtHours(r.min) + ' of sessions' : 'no sessions of its own') + '</div></div>' +
        '<div class="row-right"><b data-n="' + r.n + '">' + num(r.n) + '</b>' + (r.n === 1 ? 'item' : 'items') + '</div></div>').join('') + '</div>',
        { sub: num(rows.length) + ' formats' }) +
      section('Hours of programming per day', '<div class="card pad vz-hours">' +
        dayRows.map((d, di) => {
          const info = dayInfo(d.d);
          return '<div class="vz-hrow" data-go="#/schedule?d=' + d.d + '"><span class="vz-hrow-day"><b>' + info.dow + '</b> ' + info.date + '</span>' +
            '<span class="vz-hrow-track"><span class="vz-hrow-fill" style="width:' + (d.tot / dayMax * 100).toFixed(1) + '%;' + delay(di, 60) + '">' +
            stackBar(rows.map(r => ({ c: r.fmt.c, v: d.by.get(r.f) || 0 }))) + '</span></span>' +
            '<b class="vz-hrow-n">' + fmtHours(d.tot) + '</b></div>';
        }).join('') +
        legend(rows.filter(r => r.min > 0).map(r => ({ c: r.fmt.c, label: r.fmt.n }))) +
        '<p class="note">Hours add up the scheduled length of every session, so sessions that run side by side all count. Tap a day to open its schedule.</p></div>',
        { sub: fmtHours(totalMin) + ' in total' });

    const svg = el.querySelector('.vz-donut svg');
    const paths = Array.from(svg.querySelectorAll('.vz-arc'));
    const midB = el.querySelector('.vz-donut-mid b'), midS = el.querySelector('.vz-donut-mid span');
    let sel = null; let sweeping = false;
    const paintMid = () => {
      const r = sel == null ? null : rows.find(x => x.f === sel);
      midB.textContent = num(r ? r.n : total);
      midS.textContent = r ? r.fmt.n + ' · ' + pctText(r.n / total) : 'sessions, talks and posters';
      paths.forEach(p => p.classList.toggle('dim', sel != null && +p.dataset.f !== sel));
      el.querySelectorAll('.vz-fmt-row').forEach(x => x.classList.toggle('sel', sel != null && +x.dataset.f === sel));
    };
    const sweep = (t) => {
      const ang = t * 2 * Math.PI;
      paths.forEach((p, i) => {
        const a = arcs[i];
        p.setAttribute('d', t >= 1 ? arc(a) : (ang <= a.startAngle ? '' : arc(Object.assign({}, a, { endAngle: Math.min(a.endAngle, ang) }))));
      });
      if (sel == null) midB.textContent = num(Math.round(total * t));
    };
    paintMid();
    const d3svg = d3.select(svg);
    if (!reduced()) {
      sweeping = true; sweep(0);
      d3svg.transition().duration(900).ease(d3.easeCubicInOut)
        .tween('sweep', () => sweep)
        .on('end interrupt', () => { sweeping = false; sweep(1); paintMid(); });
    }
    ctx.on('vz-slice', (p) => { const f = +p.dataset.f; sel = sel === f ? null : f; if (!sweeping) paintMid(); });
    return () => { d3svg.interrupt(); };
  },
});

// =================================================================== pulse
const PULSE0 = 7 * 60, PULSE1 = 20 * 60, BIN = 15;

registerView('pulse', {
  title: 'Conference pulse', tab: 'explore',
  render(el) {
    el.classList.add('vz');
    const NB = (PULSE1 - PULSE0) / BIN;
    const sessions = DB.items.filter(it => it.k === 'S' && visible(it));
    const dm = new Map();
    let totalMin = 0;
    for (const it of sessions) {
      totalMin += it.dur;
      if (!dm.has(it.day)) dm.set(it.day, { d: it.day, n: 0, bins: new Array(NB).fill(0) });
      const e = dm.get(it.day); e.n++;
      const s = minOfDay(it.s), en = Math.max(s + it.dur, s + 1);
      const b0 = Math.max(0, Math.floor((s - PULSE0) / BIN)), b1 = Math.min(NB - 1, Math.ceil((en - PULSE0) / BIN) - 1);
      for (let b = b0; b <= b1; b++) e.bins[b]++;
    }
    const dayRows = Array.from(dm.values()).sort((a, b) => a.d - b.d);
    if (!dayRows.length) { el.innerHTML = emptyState('chart', 'No sessions', 'There is nothing to chart.'); return undefined; }
    let top = { v: -1, d: 0, b: 0 };
    for (const r of dayRows) {
      r.peak = Math.max(...r.bins); r.peakBin = r.bins.indexOf(r.peak);
      if (r.peak > top.v) top = { v: r.peak, d: r.d, b: r.peakBin };
    }
    const ymax = Math.max(1, top.v);
    const binMin = b => PULSE0 + b * BIN;
    const topInfo = dayInfo(top.d);
    const topClock = fmtClock(binMin(top.b)).split(' ');

    // chart geometry in CSS pixels (the svg scales with its card)
    const W = Math.max(250, Math.min(700, el.clientWidth - 28 - 24)), H = 112, MT = 22, MB = 18;
    const x = m => (m - PULSE0) / (PULSE1 - PULSE0) * W;
    const y = v => H - MB - v / ymax * (H - MT - MB);
    const areaGen = d3.area().x(p => p[0]).y0(y(0)).y1(p => p[1]).curve(d3.curveMonotoneX);
    const lineGen = d3.line().x(p => p[0]).y(p => p[1]).curve(d3.curveMonotoneX);
    const yTicks = d3.ticks(0, ymax, 3).filter(v => v > 0);
    const xTicks = d3.range(8, 21, 2);

    const chart = (r) => {
      const pts = [[x(PULSE0), y(r.bins[0])]].concat(r.bins.map((v, b) => [x(binMin(b) + BIN / 2), y(v)]), [[x(PULSE1), y(r.bins[NB - 1])]]);
      const px = x(binMin(r.peakBin) + BIN / 2), py = y(r.peak);
      const label = r.peak + ' at once · ' + fmtClock(binMin(r.peakBin));
      const lw = textW(label, 11, 650);
      const lx = Math.max(lw / 2 + 2, Math.min(W - lw / 2 - 2, px));
      const gid = 'vz-pg' + r.d;
      return '<svg viewBox="0 0 ' + W + ' ' + H + '" data-d="' + r.d + '" data-peak-x="' + lx.toFixed(1) + '" data-peak-w="' + lw.toFixed(1) + '" data-peak-y="' + py.toFixed(1) + '" role="img" aria-label="' +
        esc('Sessions in parallel on ' + dayInfo(r.d).long + ': peak of ' + r.peak + ' at ' + fmtClock(binMin(r.peakBin))) + '">' +
        '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#22D3EE" stop-opacity=".42"/><stop offset="1" stop-color="#818CF8" stop-opacity=".04"/></linearGradient></defs>' +
        yTicks.map(v => '<line class="vz-grid" x1="0" x2="' + W + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/><text class="vz-ytick" x="' + W + '" y="' + (y(v) - 3).toFixed(1) + '" text-anchor="end">' + v + '</text>').join('') +
        '<line class="vz-axis" x1="0" x2="' + W + '" y1="' + y(0) + '" y2="' + y(0) + '"/>' +
        xTicks.map(h => '<text class="vz-xtick" x="' + x(h * 60).toFixed(1) + '" y="' + (H - 4) + '" text-anchor="middle">' + (h % 12 === 0 ? 12 : h % 12) + (h === 8 ? ' AM' : h === 12 ? ' PM' : '') + '</text>').join('') +
        '<g class="vz-rise"><path d="' + areaGen(pts) + '" fill="url(#' + gid + ')"/><path class="vz-line" d="' + lineGen(pts) + '"/></g>' +
        '<g class="vz-now" style="display:none"><line y1="' + (MT - 12) + '" y2="' + y(0) + '"/><text text-anchor="middle">now</text></g>' +
        '<g class="vz-peak"><circle cx="' + px.toFixed(1) + '" cy="' + py.toFixed(1) + '" r="4"/><text x="' + lx.toFixed(1) + '" y="' + (py - 9).toFixed(1) + '" text-anchor="middle">' + esc(label) + '</text></g>' +
        '</svg>';
    };

    el.innerHTML =
      '<p class="lead">How many sessions run side by side through each day, so you can see when the program is most crowded.</p>' +
      '<div class="stats vz-stats">' +
      '<div class="stat"><b>' + topClock[0] + '<small>' + (topClock[1] || '') + '</small></b><span>busiest moment<br>' + topInfo.dow + ' ' + topInfo.date + ' ' + topInfo.mon + '</span></div>' +
      '<div class="stat"><b>' + num(top.v) + '</b><span>most sessions<br>in parallel</span></div>' +
      '<div class="stat"><b>' + num(Math.round(totalMin / 60)) + '</b><span>hours of<br>programming</span></div></div>' +
      dayRows.map((r, i) => {
        const di = dayInfo(r.d);
        return '<div class="card vz-pulse" data-go="#/schedule?d=' + r.d + '" data-d="' + r.d + '" style="' + delay(i, 70) + '">' +
          '<div class="vz-pulse-h"><b>' + esc(di.long) + '</b><span class="rel now vz-today" style="display:none">Today</span>' +
          '<span class="vz-pulse-n">' + num(r.n) + (r.n === 1 ? ' session' : ' sessions') + '</span>' + icon('chevR', 'dim') + '</div>' + chart(r) + '</div>';
      }).join('') +
      '<p class="note vz-cap">Counted in 15 minute steps from 7 AM to 8 PM. All charts share one scale. Tap a day to open its schedule.</p>';

    const placeNow = () => {
      const now = nowMin(); const d = dayOf(now), m = minOfDay(now);
      el.querySelectorAll('.vz-pulse').forEach(card => {
        const isToday = +card.dataset.d === d;
        card.querySelector('.vz-today').style.display = isToday ? '' : 'none';
        const svg = card.querySelector('svg[data-d]'); const g = svg.querySelector('.vz-now');
        const show = isToday && m >= PULSE0 && m <= PULSE1;
        g.style.display = show ? '' : 'none';
        if (!show) return;
        const nx = x(m);
        g.setAttribute('transform', 'translate(' + nx.toFixed(1) + ',0)');
        // keep the "now" label clear of the peak label
        const clash = Math.abs(nx - +svg.dataset.peakX) < +svg.dataset.peakW / 2 + 18 && +svg.dataset.peakY < MT + 14;
        const t = g.querySelector('text');
        t.setAttribute('x', Math.max(12 - nx, Math.min(W - 12 - nx, 0)).toFixed(1));
        t.setAttribute('y', clash ? y(0) - 6 : MT - 15);
      });
    };
    placeNow();
    const timer = setInterval(placeNow, 30000);
    return () => clearInterval(timer);
  },
});

// ==================================================================== buzz
/** Spiral-pack words into a box W wide; the height grows as needed. Returns placed boxes. */
function cloudLayout(words, W) {
  const lo = Math.sqrt(d3.min(words, w => w.n)), hi = Math.sqrt(d3.max(words, w => w.n));
  const minSize = 12, maxSize = W < 350 ? 32 : 36;
  const ramp = d3.interpolateRgbBasis(['#8C97C4', '#939DF5', '#5FC6F5', '#3FE0F5']);
  const PX = 4, PY = 1;
  const placed = [];
  words.forEach((w, i) => {
    const t = hi > lo ? (Math.sqrt(w.n) - lo) / (hi - lo) : 0.5;
    let size = minSize + (maxSize - minSize) * t;
    const weight = t > 0.45 ? 800 : t > 0.15 ? 700 : 600;
    let tw = textW(w.term, size, weight);
    if (tw + 2 * PX > W) { size *= (W - 2 * PX) / tw * 0.98; tw = textW(w.term, size, weight); }
    const bw = tw + 2 * PX, bh = size * 1.18 + 2 * PY;
    const box = { term: w.term, n: w.n, size, weight, color: ramp(t), w: bw, h: bh, x: (W - bw) / 2, y: -bh / 2 };
    const phase = i * 2.4;
    let th = 0;
    for (let step = 0; step < 12000; step++) {
      const rad = 1.5 * th;
      const bx = W / 2 + rad * Math.cos(th + phase) * 0.8 - bw / 2;
      const by = rad * Math.sin(th + phase) - bh / 2;
      th += 5 / Math.max(5, rad);
      if (bx < 0 || bx + bw > W) continue;
      let hit = false;
      for (const p of placed) { if (bx < p.x + p.w && bx + bw > p.x && by < p.y + p.h && by + bh > p.y) { hit = true; break; } }
      if (!hit) { box.x = bx; box.y = by; box.ok = true; break; }
    }
    if (!box.ok) {      // never seen in practice: drop it below everything else
      box.y = (placed.length ? Math.max(...placed.map(p => p.y + p.h)) : 0) + 2;
    }
    placed.push(box);
  });
  const y0 = Math.min(...placed.map(p => p.y)), y1 = Math.max(...placed.map(p => p.y + p.h));
  placed.forEach(p => { p.y -= y0; });
  placed.height = Math.ceil(y1 - y0);
  return placed;
}

registerView('buzz', {
  title: 'Buzzwords', tab: 'explore',
  render(el, ctx) {
    el.classList.add('vz');
    const words = (DB.buzz || []).filter(w => w && w[0] && w[1] > 0).map(([term, n]) => ({ term: String(term), n: +n })).sort((a, b) => b.n - a.n || a.term.localeCompare(b.term));
    if (!words.length) { el.innerHTML = emptyState('search', 'No buzzwords', 'This program has no frequent title terms.'); return undefined; }
    const goTerm = t => '#/search?q=' + encodeURIComponent(t);
    const top = words.slice(0, 12);
    el.innerHTML =
      '<p class="lead">The words that show up most in SC26 session and talk titles; the bigger and brighter a word, the more titles use it.</p>' +
      '<div class="card vz-cloud-card"><div class="vz-cloud" data-act="vz-word"></div></div>' +
      '<p class="note vz-cap">Tap a word to search the program for it.</p>' +
      section('Top ' + top.length, '<div class="card pad">' + barRows(top.map(w => ({ n: w.term, count: w.n, go: goTerm(w.term), c: HEAT_COLOR }))) + '</div>', { sub: 'titles that use the word' });
    const host = el.querySelector('.vz-cloud');
    let placed = [];
    const draw = () => {
      const W = host.clientWidth;
      if (!W) return;
      placed = cloudLayout(words, W);
      host.style.height = placed.height + 'px';
      host.innerHTML = placed.map((p, i) =>
        '<button class="vz-word" data-q="' + esc(p.term) + '" aria-label="' + esc(p.term + ', ' + p.n + ' titles') + '" style="left:' + p.x.toFixed(1) + 'px;top:' + p.y.toFixed(1) + 'px;width:' + p.w.toFixed(1) + 'px;height:' + p.h.toFixed(1) +
        'px;font-size:' + p.size.toFixed(1) + 'px;font-weight:' + p.weight + ';color:' + p.color + ';' + delay(i, 9, 90) + '">' + esc(p.term) + '</button>').join('');
    };
    draw();
    ctx.on('vz-word', (box, ev) => {
      const hit = ev.target.closest('.vz-word');
      let term = hit ? hit.dataset.q : null;
      if (!term) {              // a near miss still counts: small words are hard to hit with a thumb
        const rc = host.getBoundingClientRect(); const px = ev.clientX - rc.left, py = ev.clientY - rc.top;
        let bd = 26;
        for (const p of placed) {
          const dx = Math.max(p.x - px, 0, px - (p.x + p.w)), dy = Math.max(p.y - py, 0, py - (p.y + p.h));
          const d = Math.hypot(dx, dy);
          if (d < bd) { bd = d; term = p.term; }
        }
      }
      if (term) go(goTerm(term));
    });
    return onWidthChange(host, draw);
  },
});
