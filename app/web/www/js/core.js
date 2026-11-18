// SC26 Atlas: data layer. Loads the bundled program, builds indexes, and
// provides time helpers, the local store, search, interest matching and
// walking estimates. No DOM code lives here.

export const DB = {};
export const FLAG = { BEST_PAPER: 1, BEST_STUDENT: 2, GB: 4, BREAK: 8, POSTER: 16, LIVE: 32, REC: 64, TEXT: 128 };

// ---------------------------------------------------------------- event bus
const listeners = {};
export const bus = {
  on(evt, fn) { (listeners[evt] = listeners[evt] || new Set()).add(fn); return () => listeners[evt].delete(fn); },
  // iterate over a copy: a listener may re-render a view, which subscribes again while we are still emitting
  emit(evt, data) { Array.from(listeners[evt] || []).forEach(fn => { try { fn(data); } catch (e) { console.error(e); } }); },
};

// -------------------------------------------------------------------- store
const STORE_KEY = 'sc26atlas.v1';
const DEFAULTS = {
  plan: {},                       // item id -> timestamp added
  interests: { themes: [], tags: [], keywords: [], formats: [] },
  follows: { people: [], orgs: [] },   // person ids, org names
  notes: {},                      // item id -> text
  reminders: {},                  // item id -> minutes before
  settings: { techOnly: true, passes: ['TP', 'W', 'T', 'EX'], sim: null, onboarded: false },
  builder: null,                  // last schedule-builder options
  recent: [],                     // recent searches
};
let state = null;
function loadState() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (e) { s = {}; }
  state = JSON.parse(JSON.stringify(DEFAULTS));
  for (const k of Object.keys(DEFAULTS)) {
    if (s[k] == null) continue;
    if (Array.isArray(DEFAULTS[k]) || typeof DEFAULTS[k] !== 'object' || DEFAULTS[k] === null) state[k] = s[k];
    else state[k] = Object.assign(state[k], s[k]);
  }
}
function saveState() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { console.warn('save failed', e); }
}
loadState();

export const Store = {
  get state() { return state; },
  save(evt) { saveState(); if (evt) bus.emit(evt); },
  reset() { localStorage.removeItem(STORE_KEY); loadState(); bus.emit('plan'); bus.emit('interests'); bus.emit('settings'); },
  exportJSON() { return JSON.stringify(state); },
};

export const Plan = {
  has(id) { return Object.prototype.hasOwnProperty.call(state.plan, id); },
  add(id) { if (!this.has(id)) { state.plan[id] = Date.now(); Store.save('plan'); } },
  remove(id) {
    if (this.has(id)) {
      delete state.plan[id];
      if (state.reminders[id] != null) { delete state.reminders[id]; Native.cancelReminder(id); }
      Store.save('plan');
    }
  },
  toggle(id) { if (this.has(id)) { this.remove(id); return false; } this.add(id); return true; },
  ids() { return Object.keys(state.plan); },
  items() { return this.ids().map(id => DB.byId.get(id)).filter(Boolean).sort((a, b) => a.s - b.s || a.e - b.e); },
  count() { return this.ids().length; },
  clear() { for (const id of Object.keys(state.reminders)) Native.cancelReminder(id); state.plan = {}; state.reminders = {}; Store.save('plan'); },
};

export const Follows = {
  hasPerson(id) { return state.follows.people.includes(id); },
  togglePerson(id) {
    const a = state.follows.people; const i = a.indexOf(id);
    if (i >= 0) a.splice(i, 1); else a.push(id);
    Store.save('follows'); return i < 0;
  },
  hasOrg(name) { return state.follows.orgs.includes(name); },
  toggleOrg(name) {
    const a = state.follows.orgs; const i = a.indexOf(name);
    if (i >= 0) a.splice(i, 1); else a.push(name);
    Store.save('follows'); return i < 0;
  },
};

// ------------------------------------------------------------ native bridge
// window.AndroidBridge exists inside the Android app. In a plain browser the
// same calls fall back to web APIs so every feature can be exercised there.
const B = () => (typeof window !== 'undefined' && window.AndroidBridge) || null;
export const Native = {
  get available() { return !!B(); },
  share(title, text) {
    if (B()) { B().share(String(title), String(text)); return true; }
    if (navigator.share) { navigator.share({ title, text }).catch(() => {}); return true; }
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).catch(() => {}); return 'copied'; }
    return false;
  },
  shareFile(name, mime, content) {
    if (B()) { B().shareFile(String(name), String(mime), String(content)); return true; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: mime }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    return true;
  },
  addCalendarEvent(title, startMs, endMs, location, description) {
    if (B()) { B().addCalendarEvent(String(title), String(startMs), String(endMs), String(location || ''), String(description || '')); return true; }
    return false;
  },
  openExternal(url) {
    if (B()) { B().openExternal(String(url)); return; }
    window.open(url, '_blank', 'noopener');
  },
  scheduleReminder(id, title, text, atMs) {
    if (B()) { B().scheduleReminder(String(id), String(title), String(text), String(atMs)); return true; }
    return false;
  },
  cancelReminder(id) { if (B()) { try { B().cancelReminder(String(id)); } catch (e) { /* ignore */ } } },
  notificationsAllowed() { try { return B() ? String(B().notificationsAllowed()) === 'true' : false; } catch (e) { return false; } },
  appVersion() { try { return B() ? String(B().appVersion()) : 'web'; } catch (e) { return 'web'; } },
  haptic() { try { if (B()) B().haptic(); } catch (e) { /* ignore */ } },
};

// --------------------------------------------------------------------- time
let TZ = -360;           // minutes east of UTC for conference time
let DAY0 = 0;            // conference-local minute of the first listed day, 00:00
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Current time in epoch minutes. Honors the simulated clock from Settings or ?now=. */
export function nowMin() {
  const sim = state.settings.sim;
  if (sim && sim.at != null) return Math.floor((sim.at + (Date.now() - sim.set)) / 60000);
  return Math.floor(Date.now() / 60000);
}
/** Set a simulated "now" from conference-local 'YYYY-MM-DDTHH:MM', or clear it with null. */
export function setSimTime(localIso) {
  if (!localIso) { state.settings.sim = null; Store.save('settings'); return; }
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(localIso);
  if (!m) return;
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - TZ * 60000;
  state.settings.sim = { at: utc, set: Date.now(), label: localIso };
  Store.save('settings');
}
export const dayOf = m => Math.floor((m + TZ - DAY0) / 1440);
export const minOfDay = m => (((m + TZ) % 1440) + 1440) % 1440;
export function fmtClock(mod) {
  const h = Math.floor(mod / 60), mm = mod % 60;
  const ap = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return h12 + ':' + (mm < 10 ? '0' : '') + mm + ' ' + ap;
}
export const fmtTime = m => fmtClock(minOfDay(m));
export function fmtRange(s, e) {
  const a = fmtTime(s), b = fmtTime(e);
  if (a.slice(-2) === b.slice(-2)) return a.slice(0, -3) + '–' + b;
  return a + '–' + b;
}
export function fmtDur(min) {
  if (min < 60) return min + ' min';
  const h = Math.floor(min / 60), m = min % 60;
  return h + ' h' + (m ? ' ' + m + ' min' : '');
}
/** Date parts of a conference day index. */
export function dayInfo(d) {
  const t = new Date((DAY0 + d * 1440) * 60000);   // DAY0 is already local, read it as UTC
  return {
    d, dow: DOW[t.getUTCDay()], dowLong: DOW_LONG[t.getUTCDay()], date: t.getUTCDate(), mon: MON[t.getUTCMonth()],
    label: DOW[t.getUTCDay()] + ' ' + t.getUTCDate() + ' ' + MON[t.getUTCMonth()],
    long: DOW_LONG[t.getUTCDay()] + ', ' + MON[t.getUTCMonth()] + ' ' + t.getUTCDate(),
  };
}
export function fmtWhen(it) {
  return dayInfo(dayOf(it.s)).label + ' · ' + fmtRange(it.s, it.e);
}
/** "in 25 min", "now", "ended", or '' when far away. */
export function relTime(it, now = nowMin()) {
  if (now >= it.s && now < it.e) return 'now';
  if (now >= it.e) return 'ended';
  const d = it.s - now;
  if (d <= 90) return 'in ' + d + ' min';
  if (d < 24 * 60 && dayOf(it.s) === dayOf(now)) return 'in ' + Math.round(d / 60) + ' h';
  return '';
}
export function epochMs(m) { return m * 60000; }

// ------------------------------------------------------------- text helpers
export function norm(s) {
  return (s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
export function tokens(s) {
  return norm(s).match(/[a-z0-9]+(?:[+#]+)?/g) || [];
}
const COUNTRY_FLAG = {
  'United States': '🇺🇸', China: '🇨🇳', Germany: '🇩🇪', Japan: '🇯🇵', 'United Kingdom': '🇬🇧', France: '🇫🇷', Switzerland: '🇨🇭',
  Italy: '🇮🇹', Spain: '🇪🇸', Canada: '🇨🇦', India: '🇮🇳', 'South Korea': '🇰🇷', Brazil: '🇧🇷', Norway: '🇳🇴', Sweden: '🇸🇪',
  'Hong Kong': '🇭🇰', Singapore: '🇸🇬', Czechia: '🇨🇿', Taiwan: '🇹🇼', Vietnam: '🇻🇳', Australia: '🇦🇺', 'Saudi Arabia': '🇸🇦',
  Finland: '🇫🇮', Israel: '🇮🇱', Netherlands: '🇳🇱', Belgium: '🇧🇪', Poland: '🇵🇱', 'South Africa': '🇿🇦', Portugal: '🇵🇹',
  'Türkiye': '🇹🇷', Colombia: '🇨🇴', Ireland: '🇮🇪', 'Costa Rica': '🇨🇷', Hungary: '🇭🇺', Austria: '🇦🇹', 'New Zealand': '🇳🇿',
  Macau: '🇲🇴', Uruguay: '🇺🇾', Luxembourg: '🇱🇺', Eswatini: '🇸🇿', Bangladesh: '🇧🇩', Kenya: '🇰🇪', Denmark: '🇩🇰', Greece: '🇬🇷',
  Mexico: '🇲🇽', Argentina: '🇦🇷', Chile: '🇨🇱', 'United Arab Emirates': '🇦🇪', Qatar: '🇶🇦', Thailand: '🇹🇭', Malaysia: '🇲🇾',
  Indonesia: '🇮🇩', Pakistan: '🇵🇰', Egypt: '🇪🇬', Nigeria: '🇳🇬', Estonia: '🇪🇪', Slovenia: '🇸🇮', Croatia: '🇭🇷', Romania: '🇷🇴',
  Bulgaria: '🇧🇬', Serbia: '🇷🇸', Slovakia: '🇸🇰', Iceland: '🇮🇸', Cyprus: '🇨🇾', Iran: '🇮🇷', Philippines: '🇵🇭', Peru: '🇵🇪',
  Ecuador: '🇪🇨', Morocco: '🇲🇦', Ghana: '🇬🇭', Russia: '🇷🇺',
};
export const flagOf = c => (c && COUNTRY_FLAG[c.name]) || '🌐';
export const SECTOR = { edu: 'University', lab: 'Lab / research center', com: 'Industry', oth: 'Other' };

// --------------------------------------------------------------------- load
export async function loadData(onProgress = () => {}) {
  const get = async (url) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(url + ' -> HTTP ' + r.status);
    return r.json();
  };
  onProgress('Loading program…');
  const [core, text] = await Promise.all([get('data/core.json'), get('data/text.json')]);
  onProgress('Indexing…');
  Object.assign(DB, core);
  DB.text = text.items;
  DB.bios = text.bios || {};
  TZ = DB.meta.tzOffsetMin;
  const d0 = DB.meta.days[0].split('-').map(Number);
  DAY0 = Date.UTC(d0[0], d0[1] - 1, d0[2]) / 60000;
  DB.nDays = DB.meta.days.length;
  DB.fmtIdx = {}; DB.formats.forEach((f, i) => { f.i = i; DB.fmtIdx[f.id] = i; });
  DB.themeIdx = {}; DB.themes.forEach((t, i) => { t.i = i; t.items = []; DB.themeIdx[t.id] = i; });
  DB.tags.forEach((t, i) => { t.i = i; t.items = []; });
  DB.rooms.forEach((r, i) => { r.i = i; r.items = []; });
  DB.countries.forEach((c, i) => { c.i = i; c.people = []; c.orgs = new Set(); });
  DB.orgs.forEach((o, i) => { o.i = i; o.people = []; o.items = new Set(); });
  DB.people.forEach((p, i) => { p.i = i; p.items = []; });
  DB.byId = new Map();
  DB.personById = new Map(DB.people.map(p => [p.id, p]));
  DB.orgByName = new Map(DB.orgs.map(o => [o.n, o]));
  DB.items.forEach((it, i) => {
    it.i = i;
    it.fl = it.fl || 0;
    it.fs = it.fs || [it.f];
    it.g = it.g || []; it.p = it.p || []; it.th = it.th || []; it.ch = it.ch || []; it.sim = it.sim || [];
    it.day = dayOf(it.s);
    it.dur = it.e - it.s;
    it.brk = !!(it.fl & FLAG.BREAK);
    it.grp = DB.formats[it.f].grp;
    it.leaf = !(it.k === 'S' && it.ch.length);
    DB.byId.set(it.id, it);
    if (it.pid) DB.byId.set(it.id + '/' + it.pid, it);
    if (it.brk) return;
    if (it.r != null) DB.rooms[it.r].items.push(i);
    for (const g of it.g) DB.tags[g].items.push(i);
    for (const [t] of it.th) DB.themes[t].items.push(i);
    for (const [pi, role, pres] of it.p) {
      const p = DB.people[pi];
      p.items.push([i, role, pres]);
      for (const o of p.o) DB.orgs[o].items.add(i);
    }
  });
  DB.people.forEach(p => {
    for (const o of p.o) DB.orgs[o].people.push(p.i);
    if (p.c >= 0) { DB.countries[p.c].people.push(p.i); for (const o of p.o) DB.countries[p.c].orgs.add(o); }
    p.items.sort((a, b) => DB.items[a[0]].s - DB.items[b[0]].s);
  });
  DB.orgs.forEach(o => { o.ni = o.items.size; });
  // conference window
  let lo = Infinity, hi = -Infinity;
  for (const it of DB.items) { if (it.s < lo) lo = it.s; if (it.e > hi) hi = it.e; }
  DB.start = lo; DB.end = hi;
  // ?now=2026-11-18T10:40 simulates the clock (handy for demos and tests)
  try {
    const q = new URLSearchParams(location.search).get('now');
    if (q) setSimTime(q);
  } catch (e) { /* ignore */ }
  return DB;
}

/**
 * Hand every saved, still-upcoming reminder to Android again. Alarms are lost when the phone
 * restarts, and scheduling the same id twice simply replaces the first one.
 */
export function resyncReminders() {
  if (!Native.available) return 0;
  let n = 0;
  for (const [id, before] of Object.entries(state.reminders)) {
    const it = DB.byId.get(id);
    const at = it ? (it.s - before) * 60000 : 0;
    if (!it || at <= Date.now()) { delete state.reminders[id]; continue; }
    const r = it.r != null ? DB.rooms[it.r] : null;
    Native.scheduleReminder(id, it.t, 'Starts at ' + fmtTime(it.s) + (r ? ' in ' + r.n : ''), at);
    n++;
  }
  saveState();
  return n;
}

// ------------------------------------------------------------ item helpers
export const fmtOf = it => DB.formats[it.f];
export const parentOf = it => (it.k === 'P' && it.par != null ? DB.items[it.par] : null);
export const roomOf = it => (it.r != null ? DB.rooms[it.r] : null);
export const textOf = it => DB.text[it.i] || '';
export function kindLabel(it) {
  const f = fmtOf(it);
  if (it.sub) return it.sub;
  if (it.k === 'P') {
    if (f.id === 'workshop') return 'Workshop talk';
    if (f.id === 'exforum') return 'Exhibitor Forum talk';
    if (f.id === 'tutorial') return 'Tutorial';
    return f.n;
  }
  if (it.ch.length && (f.id === 'paper' || f.id === 'poster' || f.id === 'invited' || f.id === 'gb')) return f.n + ' session';
  return f.n;
}
/** Is this item visible under the current "technical program only" setting? */
export function visible(it) {
  if (it.brk) return false;
  if (state.settings.techOnly && it.grp !== 'tech') return false;
  return true;
}
export function speakersOf(it, max = 3) {
  // presenting people first, then the rest, session chairs last
  const chairRole = DB.roles.indexOf('chair');
  const arr = it.p.slice().sort((a, b) => (a[1] === chairRole) - (b[1] === chairRole) || b[2] - a[2]);
  const seen = new Set(); const out = [];
  for (const x of arr) { if (!seen.has(x[0])) { seen.add(x[0]); out.push(DB.people[x[0]]); } }
  return max ? out.slice(0, max) : out;
}
export function photoUrl(p) {
  if (p.ph) return 'img/p/' + p.id + '.webp';
  if (p.px) return DB.meta.photoBase + p.id + '.' + p.px;
  return null;
}
/** Poster preview: bundled file, else the online copy (the caller hides it when it fails to load). */
export function posterUrl(it) {
  if (it.img) return 'img/poster/' + it.img;
  if (it.ir && DB.meta.posterBase) return DB.meta.posterBase + it.ir;
  return null;
}
export function siteUrl(it) {
  if (it.k === 'S' && !it.pid) return DB.meta.siteBase + 'session/?sess=' + it.id;
  const sid = it.k === 'S' ? it.id : it.id.split('/')[0];
  const pid = it.k === 'S' ? it.pid : it.id.split('/')[1];
  return DB.meta.siteBase + 'presentation/?id=' + pid + '&sess=' + sid;
}
export function itemsOnDay(d) { return DB.items.filter(it => it.day === d); }
export function overlaps(a, b) { return a.s < b.e && b.s < a.e; }
/** Items in the plan that overlap in time (parent/child pairs do not count). */
export function planConflicts() {
  const list = Plan.items(); const out = new Map();
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    if (b.s >= a.e) break;
    if (a.par === b.i || b.par === a.i) continue;
    if (overlaps(a, b)) {
      (out.get(a.id) || out.set(a.id, []).get(a.id)).push(b);
      (out.get(b.id) || out.set(b.id, []).get(b.id)).push(a);
    }
  }
  return out;
}

// ---------------------------------------------------------- walking times
const BUILDING_HOP = { 'West Building|South Building': 9, 'West Building|Lakeside Center': 16, 'South Building|Lakeside Center': 9 };
function westWing(r) { const m = /^W(1\d\d)/.exec(r.n); return m ? (+m[1] >= 190 ? 'north' : 'south') : null; }
/** Rough walking minutes between two rooms, or null when unknown. */
export function walkMin(a, b) {
  if (!a || !b) return null;
  if (a.i === b.i) return 0;
  if (!a.l || !b.l) return null;
  if (a.b !== b.b) return BUILDING_HOP[a.b + '|' + b.b] || BUILDING_HOP[b.b + '|' + a.b] || 12;
  // floor plans are 800 x 1000 units; one unit is roughly 0.42 m, crowds walk about 70 m/min
  const dx = (a.x - b.x) * 800, dy = (a.y - b.y) * 1000;
  const meters = (Math.abs(dx) + Math.abs(dy)) * 0.42;
  let min = 1 + meters / 70;
  if (a.l !== b.l) min += 3;   // escalators between levels
  // West level 1 has two wings (W175 to W187, and W190 to W196) with no direct corridor between them
  else if (a.l === 'West1' && westWing(a) && westWing(b) && westWing(a) !== westWing(b)) min += 3;
  return Math.max(1, Math.round(min));
}

// ------------------------------------------------------------------- search
let IDX = null;
function buildIndex() {
  const post = new Map();   // token -> Map(doc -> weight)
  const add = (tok, doc, w) => {
    let m = post.get(tok); if (!m) { m = new Map(); post.set(tok, m); }
    m.set(doc, (m.get(doc) || 0) + w);
  };
  const N = DB.items.length;
  for (const it of DB.items) {
    if (it.brk) continue;
    const seenT = new Set();
    for (const t of tokens(it.t)) { if (!seenT.has(t)) { seenT.add(t); add(t, it.i, 6); } }
    // session name of a merged talk, or the talk's own variant of the title
    for (const t of tokens((it.st || '') + ' ' + (it.pt || ''))) { if (!seenT.has(t)) { seenT.add(t); add(t, it.i, 4); } }
    const body = tokens(textOf(it)); const tf = new Map();
    for (const t of body) tf.set(t, (tf.get(t) || 0) + 1);
    for (const [t, c] of tf) add(t, it.i, 1 + Math.log(c));
    for (const [pi] of it.p) {
      const p = DB.people[pi];
      for (const t of new Set(tokens(p.n))) add(t, it.i, 3);
      for (const o of p.o.slice(0, 2)) for (const t of new Set(tokens(DB.orgs[o].n))) add(t, it.i, 0.8);
    }
    for (const g of it.g) for (const t of tokens(DB.tags[g].n)) add(t, it.i, 1.5);
    for (const [ti] of it.th) for (const t of tokens(DB.themes[ti].n)) add(t, it.i, 1.2);
    for (const t of tokens(fmtOf(it).n)) add(t, it.i, 1);
    const r = roomOf(it); if (r) for (const t of tokens(r.n)) add(t, it.i, 1.5);
    if (it.kw) for (const k of it.kw) for (const t of tokens(k)) add(t, it.i, 1);
  }
  const vocab = Array.from(post.keys()).sort();
  const idf = new Map();
  for (const [t, m] of post) idf.set(t, Math.log(1 + N / m.size));
  IDX = { post, vocab, idf, people: DB.people.map(p => norm(p.n)), orgs: DB.orgs.map(o => norm(o.n)) };
}
function expand(tok, isLast) {
  // exact token, plus prefix matches for the token being typed
  const out = [];
  if (IDX.post.has(tok)) out.push([tok, 1]);
  if (tok.length >= 2 && (isLast || tok.length >= 4)) {
    let lo = 0, hi = IDX.vocab.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (IDX.vocab[mid] < tok) lo = mid + 1; else hi = mid; }
    for (let i = lo, n = 0; i < IDX.vocab.length && n < 40; i++) {
      const v = IDX.vocab[i];
      if (!v.startsWith(tok)) break;
      if (v !== tok) { out.push([v, 0.6]); n++; }
    }
  }
  return out;
}
/** Ranked item search. Returns [{it, score}] best first. */
export function searchItems(q, { limit = 200, filter = null } = {}) {
  if (!IDX) buildIndex();
  const toks = tokens(q);
  if (!toks.length) return [];
  const per = [];
  toks.forEach((tok, k) => {
    const m = new Map();
    for (const [v, w] of expand(tok, k === toks.length - 1)) {
      const idf = IDX.idf.get(v);
      for (const [doc, wt] of IDX.post.get(v)) {
        const sc = w * idf * wt; if (sc > (m.get(doc) || 0)) m.set(doc, sc);
      }
    }
    per.push(m);
  });
  const run = (needAll) => {
    const acc = new Map();
    per.forEach(m => { for (const [doc, sc] of m) { const a = acc.get(doc) || [0, 0]; a[0] += sc; a[1]++; acc.set(doc, a); } });
    const qn = norm(q).trim(); const res = [];
    for (const [doc, [sc, hits]] of acc) {
      if (needAll && hits < per.length) continue;
      const it = DB.items[doc];
      if (filter && !filter(it)) continue;
      let s = sc * (hits / per.length);
      if (toks.length > 1 && norm(it.t).includes(qn)) s *= 1.8;
      res.push({ it, score: s });
    }
    return res;
  };
  let res = run(true);
  if (!res.length && toks.length > 1) res = run(false);
  res.sort((a, b) => b.score - a.score || a.it.s - b.it.s);
  return res.slice(0, limit);
}
function matchNames(list, q, limit) {
  const toks = tokens(q); if (!toks.length) return [];
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const name = list[i]; let ok = true, sc = 0;
    for (const t of toks) {
      const k = name.indexOf(t);
      if (k < 0) { ok = false; break; }
      sc += (k === 0 || name[k - 1] === ' ') ? 2 : 1;
    }
    if (ok) out.push([i, sc]);
  }
  out.sort((a, b) => b[1] - a[1]);
  return out.slice(0, limit * 4);
}
export function searchPeople(q, limit = 30) {
  if (!IDX) buildIndex();
  return matchNames(IDX.people, q, limit).map(([i, sc]) => ({ p: DB.people[i], score: sc + Math.min(2, DB.people[i].w / 10) }))
    .sort((a, b) => b.score - a.score).slice(0, limit).map(x => x.p);
}
export function searchOrgs(q, limit = 20) {
  if (!IDX) buildIndex();
  return matchNames(IDX.orgs, q, limit).map(([i, sc]) => ({ o: DB.orgs[i], score: sc + Math.min(2, DB.orgs[i].np / 40) }))
    .sort((a, b) => b.score - a.score).slice(0, limit).map(x => x.o);
}
export function searchThemes(q) {
  const toks = tokens(q); if (!toks.length) return [];
  return DB.themes.filter(t => { const n = norm(t.n); return toks.every(x => n.includes(x)); });
}
export function warmSearch() { if (!IDX) buildIndex(); }

// ---------------------------------------------------------------- interests
/** Compile the saved interests into fast lookup sets. */
export function interestProfile(src = state.interests) {
  const prof = {
    themes: new Set((src.themes || []).map(id => DB.themeIdx[id]).filter(v => v != null)),
    tags: new Set((src.tags || []).map(id => DB.tags.findIndex(t => t.id === id)).filter(v => v >= 0)),
    people: new Set(state.follows.people.map(id => DB.personById.get(id)).filter(Boolean).map(p => p.i)),
    orgs: new Set(state.follows.orgs.map(n => DB.orgByName.get(n)).filter(Boolean).map(o => o.i)),
    kw: new Map(), keywords: (src.keywords || []).slice(),
  };
  for (const k of prof.keywords) {
    const res = searchItems(k, { limit: 400 });
    const top = res.length ? res[0].score : 1;
    for (const r of res) {
      const v = Math.min(1, 0.35 + 0.65 * r.score / top);
      if (v > (prof.kw.get(r.it.i) || 0)) prof.kw.set(r.it.i, v);
    }
  }
  prof.empty = !prof.themes.size && !prof.tags.size && !prof.kw.size && !prof.people.size && !prof.orgs.size;
  return prof;
}
function leafRelevance(it, prof) {
  // One matching theme tops out at 0.8 so that items matching several interests can rank above it.
  let th = 0, n = 0; const why = [];
  for (const [t, sc] of it.th) {
    if (prof.themes.has(t)) {
      const v = 0.5 + 0.3 * sc / 9;
      if (v > th) th = v;
      n++;
      why.push({ k: 'theme', i: t });
    }
  }
  let score = Math.min(0.97, th + (n > 1 ? Math.min(0.16, 0.08 * (n - 1)) : 0));
  let tg = 0;
  for (const g of it.g) if (prof.tags.has(g)) { tg += 0.4; why.push({ k: 'tag', i: g }); }
  score = 1 - (1 - score) * (1 - Math.min(0.6, tg));
  const kw = prof.kw.get(it.i);
  if (kw) { score = 1 - (1 - score) * (1 - kw * 0.85); why.push({ k: 'kw' }); }
  for (const [pi] of it.p) {
    if (prof.people.has(pi)) { score = 1 - (1 - score) * 0.35; why.push({ k: 'person', i: pi }); break; }
  }
  if (prof.orgs.size) {
    let hit = -1;
    for (const [pi] of it.p) { for (const o of DB.people[pi].o) if (prof.orgs.has(o)) { hit = o; break; } if (hit >= 0) break; }
    if (hit >= 0) { score = 1 - (1 - score) * 0.75; why.push({ k: 'org', i: hit }); }
  }
  return { score, why };
}
/** How well an item matches the interest profile: {score 0..1, why[]}. Sessions blend in their talks. */
export function relevance(it, prof) {
  const own = leafRelevance(it, prof);
  if (it.k !== 'S' || !it.ch.length) return own;
  const kids = it.ch.map(c => DB.items[c]).filter(c => !c.brk).map(c => leafRelevance(c, prof).score).sort((a, b) => b - a);
  if (!kids.length) return own;
  const top3 = kids.slice(0, 3); const mean3 = top3.reduce((a, b) => a + b, 0) / top3.length;
  const hit = kids.filter(v => v >= 0.45).length / kids.length;
  const blend = 0.5 * kids[0] + 0.3 * mean3 + 0.2 * hit;
  return { score: Math.max(own.score * 0.9, Math.min(1, 0.55 * blend + 0.45 * Math.max(own.score, blend))), why: own.why };
}

// ------------------------------------------------------------------ co-authors
/** Map(personIdx -> shared item count) for one person. */
export function coauthors(p) {
  const m = new Map();
  for (const [ii] of p.items) {
    const it = DB.items[ii];
    if (it.brk || new Set(it.p.map(x => x[0])).size > 40) continue;   // same cut-off as the network view
    for (const [pi] of it.p) if (pi !== p.i) m.set(pi, (m.get(pi) || 0) + 1);
  }
  return m;
}

// ----------------------------------------------------------------- calendar
function icsDate(m) {
  const d = new Date(m * 60000);
  const z = n => (n < 10 ? '0' : '') + n;
  return d.getUTCFullYear() + z(d.getUTCMonth() + 1) + z(d.getUTCDate()) + 'T' + z(d.getUTCHours()) + z(d.getUTCMinutes()) + '00Z';
}
const icsEsc = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
export function toICS(items) {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SC26 Atlas//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  for (const it of items) {
    const r = roomOf(it);
    L.push('BEGIN:VEVENT', 'UID:' + it.id.replace(/[^A-Za-z0-9]/g, '-') + '@sc26atlas', 'DTSTAMP:' + icsDate(nowMin()),
      'DTSTART:' + icsDate(it.s), 'DTEND:' + icsDate(it.e), 'SUMMARY:' + icsEsc(it.t),
      'LOCATION:' + icsEsc(r ? r.n + (r.b ? ', ' + r.b + ' ' + r.f : '') + ', McCormick Place, Chicago' : 'McCormick Place, Chicago'),
      'DESCRIPTION:' + icsEsc(kindLabel(it) + ' · ' + speakersOf(it, 4).map(p => p.n).join(', ') + '\n' + siteUrl(it)),
      'END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.join('\r\n');
}
export function planAsText(items) {
  const out = ['My SC26 plan', ''];
  let d = -1;
  for (const it of items) {
    if (it.day !== d) { d = it.day; out.push('', dayInfo(d).long.toUpperCase()); }
    const r = roomOf(it);
    out.push(fmtRange(it.s, it.e) + '  ' + it.t + (r ? '  [' + r.n + ']' : ''));
  }
  return out.join('\n');
}
