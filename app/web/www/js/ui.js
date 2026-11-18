// SC26 Atlas: shared UI building blocks. Views build HTML strings with these
// helpers; clicks are handled by delegation in router.js through data-go
// (navigate) and data-act (action) attributes.
import {
  DB, FLAG, Plan, Follows, fmtOf, roomOf, speakersOf, photoUrl, fmtRange, fmtTime, dayInfo, relTime, kindLabel,
  nowMin, flagOf, norm, tokens,
} from './core.js';

export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h5v-6h4v6h5V9.5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.5 3.2-5.5 6.5-5.5s5.900 2 6.500 5.500"/><circle cx="17.500" cy="9" r="2.500"/><path d="M17 14.600c2.500.200 4.200 1.800 4.700 4.400"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4 4-6.500 8-6.500s7.200 2.500 8 6.500"/>',
  bookmark: '<path d="M6 3h12v18l-6-4.500L6 21z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20.500 20.500-4.300-4.300"/>',
  star: '<path d="m12 3 2.700 5.600 6.100.900-4.400 4.300 1 6.100L12 17l-5.400 2.900 1-6.100-4.400-4.300 6.100-.900z"/>',
  pin: '<path d="M12 21s-6.500-5.700-6.500-11A6.500 6.500 0 0 1 12 3.500 6.500 6.500 0 0 1 18.500 10c0 5.300-6.500 11-6.500 11z"/><circle cx="12" cy="10" r="2.300"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.200 2"/>',
  chevR: '<path d="m9 5 7 7-7 7"/>',
  chevL: '<path d="m15 5-7 7 7 7"/>',
  chevD: '<path d="m5 9 7 7 7-7"/>',
  back: '<path d="M20 12H5M11 5l-7 7 7 7"/>',
  share: '<circle cx="6" cy="12" r="2.500"/><circle cx="17.500" cy="5.500" r="2.500"/><circle cx="17.500" cy="18.500" r="2.500"/><path d="m8.200 10.800 7-4M8.200 13.200l7 4"/>',
  bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l1.500 2.500h-15z"/><path d="M10 21h4"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  filter: '<path d="M3 5h18l-7 8.500V20l-4-2v-4.500z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.500v3M12 18.500v3M2.500 12h3M18.500 12h3M5.300 5.300l2.100 2.100M16.600 16.600l2.100 2.100M5.300 18.700l2.100-2.100M16.600 7.400l2.100-2.100"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
  sparkles: '<path d="M10 3l1.800 4.700L16.500 9.500l-4.700 1.800L10 16l-1.800-4.700L3.500 9.500l4.700-1.800z"/><path d="M18 14l.900 2.300 2.300.900-2.300.900L18 20.400l-.900-2.300-2.300-.900 2.300-.900z"/>',
  grid: '<rect x="3.500" y="3.500" width="7" height="7" rx="1.500"/><rect x="13.500" y="3.500" width="7" height="7" rx="1.500"/><rect x="3.500" y="13.500" width="7" height="7" rx="1.500"/><rect x="13.500" y="13.500" width="7" height="7" rx="1.500"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.800" cy="6" r="1"/><circle cx="3.800" cy="12" r="1"/><circle cx="3.800" cy="18" r="1"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.200 3 14.800 0 18M12 3c-3 3.200-3 14.800 0 18"/>',
  network: '<circle cx="5" cy="6" r="2.300"/><circle cx="19" cy="7" r="2.300"/><circle cx="12" cy="18" r="2.300"/><circle cx="12" cy="11" r="1.800"/><path d="m6.800 7.300 3.700 2.700M17.200 8.200l-3.700 2M12 12.800v3"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 12.500 9 5 9-5M3 16.500l9 5 9-5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.500v.500"/>',
  check: '<path d="m5 12.500 4.500 4.500L19 7.500"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6.500 7l1 13h9l1-13"/>',
  download: '<path d="M12 4v11M7.500 10.500 12 15l4.500-4.500M4.500 19.500h15"/>',
  wand: '<path d="m4 20 11-11M14 5l1-2 1 2 2 1-2 1-1 2-1-2-2-1zM18.500 12.500l.700-1.500.700 1.500 1.500.700-1.500.700-.700 1.500-.700-1.500-1.500-.700z"/>',
  flame: '<path d="M12 3c1 3.500 5 5.500 5 10a5 5 0 0 1-10 0c0-2 1-3.200 2-4.200.300 1.700 1.200 2.500 2 2.700C10.500 9 11 5.500 12 3z"/>',
  book: '<path d="M4 5.500A2.500 2.500 0 0 1 6.500 3H20v15H6.500A2.500 2.500 0 0 0 4 20.500z"/><path d="M4 20.500A2.500 2.500 0 0 0 6.500 21H20v-3"/>',
  award: '<circle cx="12" cy="9" r="5.500"/><path d="m8.500 13.500-1.500 7.500 5-3 5 3-1.500-7.500"/>',
  image: '<rect x="3" y="4.500" width="18" height="15" rx="2.500"/><circle cx="8.500" cy="10" r="1.700"/><path d="m4 18 5.500-5 4 3.500 2.500-2 4 3.500"/>',
  walk: '<circle cx="13" cy="4.500" r="1.800"/><path d="m9 21 2.500-6.500L9.500 12l1.500-4.500 3 1 1.500 3 3 1M11 8l-3.500 1.500L6 13M14.500 21l-1-4.500"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  zap: '<path d="M13 2.500 5 13.500h6l-1 8 8-11h-6z"/>',
  live: '<circle cx="12" cy="12" r="3"/><path d="M6.500 6.500a8 8 0 0 0 0 11M17.500 6.500a8 8 0 0 1 0 11"/>',
  chart: '<path d="M4 20V4M4 20h16M8 16v-5M12 16V8M16 16v-3"/>',
  building: '<rect x="5" y="3" width="14" height="18" rx="1.500"/><path d="M9 7.500h1M14 7.500h1M9 11.500h1M14 11.500h1M9 15.500h1M14 15.500h1"/>',
  note: '<path d="M5 3.500h10l4 4V20.500H5z"/><path d="M8.500 12h7M8.500 16h5"/>',
  swap: '<path d="M4 8h14l-3-3M20 16H6l3 3"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.300"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.500 11.500a6.500 6.500 0 0 0 13 0M12 18v3"/>',
  more: '<circle cx="5" cy="12" r="1.500"/><circle cx="12" cy="12" r="1.500"/><circle cx="19" cy="12" r="1.500"/>',
  heart: '<path d="M12 20.500s-8-4.700-8-10.500a4.500 4.500 0 0 1 8-2.800A4.500 4.500 0 0 1 20 10c0 5.800-8 10.500-8 10.500z"/>',
};
export function icon(name, cls = '') {
  return '<svg class="ic ' + cls + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.800" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
}

export function hueOf(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h % 360;
}
export function initials(name) {
  const parts = name.replace(/\(.*?\)/g, '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const a = parts[0][0] || ''; const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (a + b).toUpperCase();
}
/** Round portrait: bundled photo, online photo, or colored initials. */
export function avatar(p, size = 40, o = {}) {
  let url = photoUrl(p);
  // on a profile page it is worth one request to see whether the program site has a photo
  if (!url && o.guess && /^\d{5,7}$/.test(p.id)) url = DB.meta.photoBase + p.id + '.jpg';
  const img = url ? '<img loading="lazy" alt="" src="' + esc(url) + '" onerror="this.remove()">' : '';
  return '<span class="av" style="--s:' + size + 'px;--h:' + hueOf(p.n) + '">' + esc(initials(p.n)) + img + '</span>';
}

export function pill(text, color) {
  return '<span class="pill" style="--c:' + color + '">' + esc(text) + '</span>';
}
export function fmtPill(it) {
  const f = fmtOf(it);
  return pill(kindLabel(it), f.c);
}
export function starBtn(it, cls = '') {
  const on = Plan.has(it.id);
  return '<button class="star ' + cls + (on ? ' on' : '') + '" data-act="star" data-id="' + esc(it.id) + '" aria-pressed="' + on + '" aria-label="' + (on ? 'Remove from my plan' : 'Add to my plan') + '">' + icon('star') + '</button>';
}
export function chip(label, o = {}) {
  const attrs = (o.go ? ' data-go="' + esc(o.go) + '"' : '') + (o.act ? ' data-act="' + esc(o.act) + '"' : '') +
    (o.id != null ? ' data-id="' + esc(o.id) + '"' : '') + (o.color ? ' style="--c:' + o.color + '"' : '');
  return '<button class="chip' + (o.on ? ' on' : '') + (o.color ? ' tinted' : '') + (o.cls ? ' ' + o.cls : '') + '"' + attrs + '>' +
    (o.icon ? icon(o.icon) : '') + '<span>' + esc(label) + '</span>' + (o.count != null ? '<i>' + o.count + '</i>' : '') + '</button>';
}
export function themeChips(it, max = 3) {
  return it.th.slice(0, max).map(([t]) => chip(DB.themes[t].n, { go: '#/theme/' + DB.themes[t].id, color: DB.themes[t].c, cls: 'sm' })).join('');
}
export function relBadge(it, now = nowMin()) {
  const r = relTime(it, now);
  if (!r) return '';
  return '<span class="rel ' + (r === 'now' ? 'now' : r === 'ended' ? 'past' : 'soon') + '">' + (r === 'now' ? 'Live now' : r) + '</span>';
}
export function awardBadges(it) {
  let s = '';
  if (it.fl & FLAG.GB) s += '<span class="badge gold">' + icon('award') + 'Gordon Bell finalist</span>';
  if (it.fl & FLAG.BEST_PAPER) s += '<span class="badge gold">' + icon('award') + 'Best Paper finalist</span>';
  if (it.fl & FLAG.BEST_STUDENT) s += '<span class="badge gold">' + icon('award') + 'Best Student Paper finalist</span>';
  return s;
}

/**
 * Card for a session or talk.
 * opts: showDay, score (0..1 match), why (html), noStar, dense, parent (show parent session name)
 */
export function itemCard(it, o = {}) {
  const f = fmtOf(it); const r = roomOf(it);
  const sp = speakersOf(it, 3); const more = new Set(it.p.map(x => x[0])).size - sp.length;
  const when = (o.showDay ? dayInfo(it.day).label + ' · ' : '') + fmtRange(it.s, it.e);
  const par = o.parent && it.k === 'P' ? DB.items[it.par] : null;
  return '<div class="card it' + (o.dense ? ' dense' : '') + (nowMin() >= it.e ? ' past' : '') + '" data-go="#/item/' + esc(it.id) + '" style="--c:' + f.c + '">' +
    '<div class="it-main">' +
    '<div class="it-meta">' + fmtPill(it) + '<span class="time">' + when + '</span>' + relBadge(it) + '</div>' +
    (it.st ? '<div class="it-kick">' + esc(it.st) + '</div>' : '') +
    '<div class="it-title">' + esc(it.t) + '</div>' +
    (par ? '<div class="it-par">in ' + esc(par.t) + '</div>' : '') +
    '<div class="it-sub">' +
    (r ? '<span class="loc">' + icon('pin') + esc(r.n) + '</span>' : '') +
    (sp.length ? '<span class="who">' + esc(sp.map(p => p.n).join(', ')) + (more > 0 ? ' +' + more : '') + '</span>' : '') +
    (it.k === 'S' && it.ch.length ? '<span class="cnt">' + it.ch.length + (f.id === 'poster' || f.id === 'art' ? ' items' : ' talks') + '</span>' : '') +
    '</div>' +
    (o.score != null ? '<div class="match"><span class="bar"><i style="width:' + Math.round(o.score * 100) + '%"></i></span><b>' + Math.round(o.score * 100) + '% match</b>' + (o.why || '') + '</div>' : '') +
    (o.extra || '') +
    '</div>' +
    (o.noStar ? '' : starBtn(it)) +
    '</div>';
}
/** Compact single-line row for a talk inside a session agenda. */
export function talkRow(it, o = {}) {
  const sp = speakersOf(it, 2);
  if (it.brk) return '<div class="talk brk"><span class="t">' + fmtTime(it.s) + '</span><span class="tt">' + esc(it.t) + '</span></div>';
  const now = nowMin();
  return '<div class="talk' + (now >= it.e ? ' past' : now >= it.s ? ' live' : '') + '" data-go="#/item/' + esc(it.id) + '">' +
    '<span class="t">' + (o.noTime ? '' : fmtTime(it.s)) + '</span>' +
    '<span class="tt"><b>' + esc(it.t) + '</b>' + (sp.length ? '<em>' + esc(sp.map(p => p.n).join(', ')) + '</em>' : '') + '</span>' +
    starBtn(it, 'sm') + '</div>';
}
export function personRow(p, o = {}) {
  const org = p.o.length ? DB.orgs[p.o[0]].n : '';
  const c = p.c >= 0 ? DB.countries[p.c] : null;
  const sub = o.sub != null ? o.sub : esc(org);
  return '<div class="row person" data-go="#/person/' + esc(p.id) + '">' + avatar(p, o.size || 44) +
    '<div class="row-main"><div class="row-title' + (c ? ' wf"><span class="nm">' + esc(p.n) + '</span><span class="flag">' + flagOf(c) + '</span>' : '">' + esc(p.n)) + '</div>' +
    '<div class="row-sub">' + sub + '</div></div>' +
    (o.right != null ? '<div class="row-right">' + o.right + '</div>' : icon('chevR', 'dim')) + '</div>';
}
export function orgRow(o, opt = {}) {
  const c = o.c >= 0 ? DB.countries[o.c] : null;
  return '<div class="row org" data-go="#/org/' + o.i + '"><span class="av sq" style="--s:44px;--h:' + hueOf(o.n) + '">' + icon('building') + '</span>' +
    '<div class="row-main"><div class="row-title' + (c ? ' wf"><span class="nm">' + esc(o.n) + '</span><span class="flag">' + flagOf(c) + '</span>' : '">' + esc(o.n)) + '</div>' +
    '<div class="row-sub">' + (opt.sub != null ? opt.sub : o.np + ' contributors · ' + o.ni + ' program items') + '</div></div>' +
    (opt.right != null ? '<div class="row-right">' + opt.right + '</div>' : icon('chevR', 'dim')) + '</div>';
}
export function section(title, body, o = {}) {
  return '<section class="sec' + (o.cls ? ' ' + o.cls : '') + '"><div class="sec-h"><h2>' + esc(title) + '</h2>' +
    (o.sub ? '<span class="sec-sub">' + o.sub + '</span>' : '') +
    (o.moreGo ? '<button class="link" data-go="' + esc(o.moreGo) + '">' + esc(o.more || 'See all') + icon('chevR') + '</button>' : '') +
    '</div>' + body + '</section>';
}
export function emptyState(ic, title, text, cta = '') {
  return '<div class="empty">' + icon(ic) + '<h3>' + esc(title) + '</h3><p>' + text + '</p>' + cta + '</div>';
}
export function statTile(value, label, o = {}) {
  return '<div class="stat"' + (o.go ? ' data-go="' + esc(o.go) + '"' : '') + '><b data-count="' + value + '">' + Number(value).toLocaleString('en-US') + '</b><span>' + esc(label) + '</span></div>';
}
/** Wrap query words found in text with <mark>. Text is escaped. */
export function highlight(text, q) {
  const toks = tokens(q).filter(t => t.length > 1);
  if (!toks.length) return esc(text);
  const n = norm(text);
  if (n.length !== text.length) return esc(text);   // accents changed the length: skip marking
  const marks = [];
  for (const t of toks) {
    let k = 0;
    while ((k = n.indexOf(t, k)) >= 0) { marks.push([k, k + t.length]); k += t.length; }
  }
  if (!marks.length) return esc(text);
  marks.sort((a, b) => a[0] - b[0]);
  let out = '', pos = 0;
  for (const [a, b] of marks) {
    if (a < pos) continue;
    out += esc(text.slice(pos, a)) + '<mark>' + esc(text.slice(a, b)) + '</mark>'; pos = b;
  }
  return out + esc(text.slice(pos));
}

// ------------------------------------------------------------------- toast
let toastTimer = null;
export function toast(msg, ms = 2200) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ------------------------------------------------------------ bottom sheet
let sheetClose = null;
export function openSheet(html, o = {}) {
  closeSheet();
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = '<div class="sheet-bg" data-act="sheet-close"></div><div class="sheet' + (o.tall ? ' tall' : '') + '" role="dialog" aria-modal="true">' +
    '<div class="sheet-grip"></div>' + (o.title ? '<div class="sheet-h"><h3>' + esc(o.title) + '</h3><button class="iconbtn" data-act="sheet-close" aria-label="Close">' + icon('x') + '</button></div>' : '') +
    '<div class="sheet-body">' + html + '</div></div>';
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('open'));
  sheetClose = () => {
    sheetClose = null;
    wrap.classList.remove('open');
    setTimeout(() => wrap.remove(), 220);
    if (o.onClose) o.onClose();
  };
  return wrap.querySelector('.sheet-body');
}
export function closeSheet() { if (sheetClose) { sheetClose(); return true; } return false; }
export const sheetOpen = () => !!sheetClose;

// ---------------------------------------------------------------- lazy list
/**
 * Render a long list in chunks as the user scrolls.
 * render(from, to) returns the HTML for items [from, to).
 */
const activeLists = new Set();
/** Ask every lazy list on screen for its next chunk. Returns true when at least one grew. */
export function growLists() {
  let grew = false;
  for (const more of Array.from(activeLists)) if (more()) grew = true;
  return grew;
}
export function lazyList(container, total, render, chunk = 30) {
  let done = 0; let io = null;
  const sentinel = document.createElement('div');
  sentinel.className = 'sentinel';
  const finish = () => { if (io) io.disconnect(); sentinel.remove(); activeLists.delete(more); };
  const more = () => {
    if (done >= total || !sentinel.isConnected) { finish(); return false; }
    const to = Math.min(total, done + chunk);
    sentinel.insertAdjacentHTML('beforebegin', render(done, to));
    done = to;
    if (done >= total) finish();
    return true;
  };
  container.appendChild(sentinel);
  more();
  if (done < total) {
    activeLists.add(more);
    io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) more(); }, { rootMargin: '600px' });
    io.observe(sentinel);
  }
  return () => { if (io) io.disconnect(); activeLists.delete(more); };
}

/** Animate numbers in elements carrying data-count from 0 to their value. */
export function countUp(root) {
  const els = root.querySelectorAll('[data-count]');
  const t0 = performance.now(); const D = 900;
  const step = (t) => {
    const k = Math.min(1, (t - t0) / D); const e = 1 - Math.pow(1 - k, 3);
    els.forEach(el => { el.textContent = Math.round(+el.dataset.count * e).toLocaleString('en-US'); });
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function followBtn(p) {
  const on = Follows.hasPerson(p.id);
  return '<button class="btn sm' + (on ? ' on' : '') + '" data-act="follow-person" data-id="' + esc(p.id) + '">' + icon('heart') + '<span>' + (on ? 'Following' : 'Follow') + '</span></button>';
}
