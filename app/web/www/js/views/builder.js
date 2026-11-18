// Schedule builder: pick interests, get a conflict-free plan for each day.
//
// Every candidate session or talk gets a match score (0..1) against the
// interest profile. For each day a dynamic program then picks the set of
// non-overlapping candidates with the highest total of score x minutes, where
// moving between rooms needs enough time to walk there.
import {
  DB, FLAG, Plan, Store, nowMin, dayOf, dayInfo, fmtRange, fmtDur, minOfDay, fmtClock, roomOf, fmtOf, relevance,
  interestProfile, walkMin, overlaps, parentOf,
} from '../core.js';
import { registerView, go } from '../router.js';
import { esc, icon, itemCard, chip, section, emptyState, openSheet, closeSheet, toast, talkRow } from '../ui.js';

const DEFAULT_FORMATS = ['keynote', 'plenary', 'invited', 'gb', 'award', 'paper', 'panel', 'bof', 'tutorial', 'workshop'];
const OPTIONAL_FORMATS = ['poster', 'art', 'nre', 'exforum', 'rth', 'early', 'students'];
const HEADLINERS = new Set(['keynote', 'plenary']);
const PASSES = [['TP', 'Technical Program'], ['W', 'Workshops'], ['T', 'Tutorials'], ['EX', 'Exhibits']];
const HOP_PENALTY = 5;     // value-minutes lost for every room change, so the plan prefers staying put
const MIN_REL = 0.3;
let result = null;         // last generated plan, kept while the app is open

function opts() {
  const b = Store.state.builder || {};
  const now = nowMin();
  const today = Math.max(0, dayOf(now));
  const live = [];
  for (let d = 0; d < DB.nDays; d++) if (DB.items.some(it => it.day === d && it.grp === 'tech' && it.k === 'S')) live.push(d);
  const future = live.filter(d => d >= today && now < DB.end);
  return {
    days: Array.isArray(b.days) && b.days.length ? b.days.filter(d => live.includes(d)) : (future.length ? future : live),
    formats: Array.isArray(b.formats) && b.formats.length ? b.formats : DEFAULT_FORMATS.slice(),
    lunch: !!b.lunch, hop: b.hop !== false, headliners: b.headliners !== false, keep: b.keep !== false,
    start: b.start || 480, end: b.end || 1140, liveDays: live,
  };
}
function saveOpts(o) {
  Store.state.builder = { days: o.days, formats: o.formats, lunch: o.lunch, hop: o.hop, headliners: o.headliners, keep: o.keep, start: o.start, end: o.end };
  Store.save();
}

function whyChips(why) {
  const out = []; const seen = new Set();
  for (const w of why) {
    const key = w.k + ':' + (w.i == null ? '' : w.i); if (seen.has(key)) continue; seen.add(key);
    if (w.k === 'theme') out.push('<span class="why" style="--c:' + DB.themes[w.i].c + '">' + esc(DB.themes[w.i].n) + '</span>');
    else if (w.k === 'tag') out.push('<span class="why">' + esc(DB.tags[w.i].n) + '</span>');
    else if (w.k === 'kw') out.push('<span class="why">keyword</span>');
    else if (w.k === 'person') out.push('<span class="why">' + esc(DB.people[w.i].n) + '</span>');
    else if (w.k === 'org') out.push('<span class="why">' + esc(DB.orgs[w.i].n) + '</span>');
    if (out.length === 3) break;
  }
  return out.join('');
}

/** Build the plan. Returns { days: [{d, units, alts}], posters, stats }. */
export function buildPlan(o, prof) {
  const fset = new Set(o.formats.map(id => DB.fmtIdx[id]).filter(v => v != null));
  const passes = new Set(Store.state.settings.passes || []);
  const regOk = it => { const r = (parentOf(it) || it).reg; return !r || !r.length || !passes.size || r.some(x => passes.has(x)); };
  const cache = new Map();
  const rel = it => { let r = cache.get(it.i); if (!r) { r = relevance(it, prof); cache.set(it.i, r); } return r; };
  const days = [];
  const now = nowMin();
  for (const d of o.days.slice().sort((a, b) => a - b)) {
    const locked = o.keep ? Plan.items().filter(it => it.day === d && !it.brk) : [];
    const units = [];
    const push = (it, forceLocked) => {
      const r = rel(it); let score = r.score;
      const f = fmtOf(it).id;
      // the main keynote and plenary, not their overflow rooms or meet-and-greets
      if (o.headliners && HEADLINERS.has(f) && it.k === 'S' && !/overflow|meet and greet/i.test(it.t)) score = Math.max(score, 0.85);
      const isLocked = forceLocked || false;
      if (!isLocked && (score < MIN_REL || it.e <= now)) return;   // nothing that is already over
      units.push({ it, s: it.s, e: it.e, rel: score, why: r.why, room: roomOf(it), locked: isLocked,
        val: isLocked ? 1e6 : Math.pow(score, 1.5) * Math.min(it.dur, 180) });
    };
    for (const it of locked) push(it, true);
    const lockedIds = new Set(locked.map(it => it.i));
    for (const it of DB.items) {
      if (it.day !== d || it.k !== 'S' || it.brk || lockedIds.has(it.i)) continue;
      if (!it.fs.some(f => fset.has(f))) continue;
      if (!regOk(it)) continue;
      const fid = fmtOf(it).id;
      const longRunning = it.dur > 300 && fid !== 'tutorial' && fid !== 'workshop';
      const inWindow = x => minOfDay(x.s) >= o.start && minOfDay(x.s) + x.dur <= o.end;
      if (!longRunning && inWindow(it) && it.dur >= 10) push(it, false);
      if (o.hop && it.ch.length && fid !== 'poster' && fid !== 'art') {
        for (const ci of it.ch) {
          const c = DB.items[ci];
          if (c.brk || c.dur < 10 || lockedIds.has(c.i) || !inWindow(c) || c.day !== d) continue;
          push(c, false);
        }
      }
    }
    // nothing may overlap an item the user already committed to
    let cands = units.filter(u => u.locked || !locked.some(l => overlaps(l, u.it)));
    if (o.lunch) {
      const ls = 12 * 60 + 15, le = 13 * 60 + 15;
      cands = cands.filter(u => u.locked || !(minOfDay(u.s) < le && minOfDay(u.s) + u.it.dur > ls));
    }
    cands.sort((a, b) => a.e - b.e || a.s - b.s);
    const n = cands.length;
    const best = new Float64Array(n), prev = new Int32Array(n).fill(-1);
    for (let i = 0; i < n; i++) {
      const u = cands[i]; let b = 0, bp = -1;
      for (let j = 0; j < i; j++) {
        const v = cands[j];
        if (v.e > u.s) continue;
        let hop = 0;
        if (v.room && u.room && v.room.i !== u.room.i) {
          const w = walkMin(v.room, u.room);
          if (!(u.locked && v.locked) && u.s - v.e < (w == null ? 4 : w) - 2) continue;
          hop = HOP_PENALTY;
        }
        const val = best[j] - hop;
        if (val > b) { b = val; bp = j; }
      }
      best[i] = u.val + b; prev[i] = bp;
    }
    let k = -1, top = 0;
    for (let i = 0; i < n; i++) if (best[i] > top) { top = best[i]; k = i; }
    const chosen = [];
    while (k >= 0) { chosen.push(cands[k]); k = prev[k]; }
    chosen.reverse();
    const chosenIds = new Set(chosen.map(u => u.it.i));
    const alts = new Map();
    for (const u of chosen) {
      const list = cands.filter(v => !chosenIds.has(v.it.i) && !v.locked && v.it.par !== u.it.i && u.it.par !== v.it.i &&
        Math.min(u.e, v.e) - Math.max(u.s, v.s) >= 0.5 * Math.min(u.it.dur, v.it.dur))
        .sort((a, b) => b.rel - a.rel).slice(0, 4);
      if (list.length) alts.set(u.it.i, list);
    }
    days.push({ d, units: chosen, alts, considered: n });
  }
  // posters are on display for days, so they are suggested, not scheduled
  const posters = DB.items.filter(it => (it.fl & FLAG.POSTER) && it.k === 'P' && !it.brk).map(it => ({ it, r: rel(it) }))
    .filter(x => x.r.score >= 0.5).sort((a, b) => b.r.score - a.r.score).slice(0, 8);
  return { days, posters, at: Date.now() };
}

function interestsUI() {
  const st = Store.state.interests;
  const themes = DB.themes.slice().sort((a, b) => b.cnt - a.cnt);
  return '<div class="chips" id="b-themes">' + themes.map(t => chip(t.n, { act: 'b-theme', id: t.id, color: t.c, on: st.themes.includes(t.id), count: t.cnt })).join('') + '</div>' +
    '<details class="more-opts"><summary>Official SC26 tags' + (st.tags.length ? ' <i>' + st.tags.length + ' picked</i>' : '') + '</summary><div class="chips">' +
    DB.tags.map(t => chip(t.n, { act: 'b-tag', id: t.id, on: st.tags.includes(t.id), count: t.items.length })).join('') + '</div></details>' +
    '<div class="field" style="margin-top:12px">' + icon('plus') + '<input id="b-kw" type="text" enterkeyhint="done" autocomplete="off" autocapitalize="off" placeholder="Add a keyword, e.g. checkpointing"></div>' +
    '<div class="chips" id="b-kws" style="margin-top:10px">' + st.keywords.map(k => chip(k, { act: 'b-kwdel', id: k, on: true, icon: 'x' })).join('') + '</div>';
}

function resultHTML(o) {
  const all = result.days.flatMap(x => x.units);
  if (!all.length) {
    return emptyState('calendar', 'No matches for these choices', 'Nothing on the selected days reaches a useful match. Add more themes, more formats or more days.', '<button class="btn" data-act="b-edit">Change my choices</button>');
  }
  const newOnes = all.filter(u => !Plan.has(u.it.id));
  const mins = all.reduce((a, u) => a + u.it.dur, 0);
  const avg = all.filter(u => !u.locked).reduce((a, u) => a + u.rel, 0) / Math.max(1, all.filter(u => !u.locked).length);
  let h = '<div class="card pad glow b-summary"><div class="b-sum-row"><div><b>' + all.length + '</b><span>blocks</span></div><div><b>' + fmtDur(mins).replace(' min', 'm').replace(' h', 'h') + '</b><span>of program</span></div><div><b>' + Math.round(avg * 100) + '%</b><span>average match</span></div></div>' +
    '<div class="btnrow" style="margin-top:14px"><button class="btn" data-act="b-edit">' + icon('sliders') + 'Adjust</button>' +
    '<button class="btn primary" data-act="b-addall"' + (newOnes.length ? '' : ' disabled') + '>' + icon('star') + (newOnes.length ? 'Add ' + newOnes.length + ' to My Plan' : 'All in My Plan') + '</button></div></div>';
  for (const day of result.days) {
    const di = dayInfo(day.d);
    if (!day.units.length) { h += section(di.long, '<p class="muted" style="padding:0 2px">No strong match on this day.</p>'); continue; }
    let body = ''; let prevU = null;
    for (const u of day.units) {
      if (prevU) {
        const gap = u.s - prevU.e;
        const w = prevU.room && u.room && prevU.room.i !== u.room.i ? walkMin(prevU.room, u.room) : 0;
        if (gap >= 20 || w) {
          body += '<div class="gap' + (w && gap < w + 3 ? ' tight' : '') + '"' + (w ? ' data-go="#/map/' + u.room.i + '?from=' + prevU.room.i + '"' : '') + '>' +
            (w ? icon('walk') + '<span>' + (gap > 0 ? fmtDur(gap) + ' gap · ' : '') + 'about ' + w + ' min walk to ' + esc(u.room.n) + '</span>' : icon('clock') + '<span>' + fmtDur(gap) + ' free</span>') + '</div>';
        }
      }
      const alt = day.alts.get(u.it.i);
      body += itemCard(u.it, { parent: true, score: u.locked ? null : u.rel, why: whyChips(u.why),
        extra: '<div class="b-tools">' + (u.locked ? '<span class="badge gold">' + icon('star') + 'Already in your plan</span>' : '') +
          (alt ? '<button class="btn sm" data-act="b-swap" data-id="' + esc(u.it.id) + '">' + icon('swap') + alt.length + ' alternative' + (alt.length === 1 ? '' : 's') + '</button>' : '') +
          (u.locked ? '' : '<button class="btn sm ghost" data-act="b-drop" data-id="' + esc(u.it.id) + '">' + icon('x') + 'Skip</button>') + '</div>' });
      prevU = u;
    }
    h += section(di.long, body, { sub: day.units.length + ' blocks · ' + fmtDur(day.units.reduce((a, u) => a + u.it.dur, 0)) });
  }
  if (result.posters.length) {
    h += section('Posters worth a stop', result.posters.map(x => itemCard(x.it, { dense: true, score: x.r.score })).join(''), { sub: 'on display Tue to Thu', moreGo: '#/posters', more: 'Gallery' });
  }
  h += '<div class="btnrow" style="margin-top:18px"><button class="btn" data-go="#/people?tab=foryou">' + icon('users') + 'People to meet</button><button class="btn" data-go="#/galaxy">' + icon('sparkles') + 'See on the galaxy</button></div>' +
    '<p class="note" style="margin-top:14px">The plan maximizes match times minutes without overlaps and leaves time to walk between rooms. Walking times are estimates from the floor plans.</p>';
  return h;
}

registerView('builder', {
  title: 'Schedule builder', tab: 'plan',
  render(el, ctx) {
    const o = opts();
    const showResult = ctx.query.step === 'result' && result;
    if (showResult) {
      ctx.setTitle('Your suggested plan');
      el.innerHTML = '<div id="b-result">' + resultHTML(o) + '</div>';
    } else {
      const st = Store.state.interests;
      const hours = (from, to, sel) => { let s = ''; for (let m = from; m <= to; m += 30) s += '<option value="' + m + '"' + (m === sel ? ' selected' : '') + '>' + fmtClock(m) + '</option>'; return s; };
      el.innerHTML = '<p class="lead">Tell the app what you care about. It scores every session and talk, then lays out the best conflict-free route through each day.</p>' +
        section('1 · What are you into?', '<div class="card pad">' + interestsUI() + '</div>', { sub: '<span id="b-count"></span>' }) +
        section('2 · Which days?', '<div class="chips">' + o.liveDays.map(d => chip(dayInfo(d).dow + ' ' + dayInfo(d).date, { act: 'b-day', id: d, on: o.days.includes(d) })).join('') + '</div>') +
        section('3 · What kinds of sessions?', '<div class="chips">' + DEFAULT_FORMATS.concat(OPTIONAL_FORMATS).filter(id => DB.fmtIdx[id] != null).map(id => { const f = DB.formats[DB.fmtIdx[id]]; return chip(f.n, { act: 'b-fmt', id, color: f.c, on: o.formats.includes(id) }); }).join('') + '</div>' +
          '<div class="card pad" style="margin-top:12px">' +
          '<div class="toggle"><div><b>Hop between talks</b><span>Pick single talks inside paper sessions and workshops, not only whole sessions</span></div><button class="sw' + (o.hop ? ' on' : '') + '" data-act="b-opt" data-id="hop" aria-label="Hop between talks"></button></div>' +
          '<div class="toggle"><div><b>Always include the keynote and plenary</b><span>Even when they do not match your topics</span></div><button class="sw' + (o.headliners ? ' on' : '') + '" data-act="b-opt" data-id="headliners" aria-label="Include keynote and plenary"></button></div>' +
          '<div class="toggle"><div><b>Keep what is in My Plan</b><span>Starred sessions stay fixed and the rest is built around them</span></div><button class="sw' + (o.keep ? ' on' : '') + '" data-act="b-opt" data-id="keep" aria-label="Keep my plan"></button></div>' +
          '<div class="toggle"><div><b>Keep lunch free</b><span>Nothing between 12:15 and 1:15 PM (this drops lunchtime BoFs)</span></div><button class="sw' + (o.lunch ? ' on' : '') + '" data-act="b-opt" data-id="lunch" aria-label="Keep lunch free"></button></div>' +
          '<div class="toggle"><div><b>Day starts and ends</b><span>Only sessions inside this window</span></div><div class="selpair"><select id="b-start">' + hours(420, 720, o.start) + '</select><select id="b-end">' + hours(900, 1320, o.end) + '</select></div></div></div>') +
        section('4 · Your registration', '<div class="chips">' + PASSES.map(([id, n]) => chip(n, { act: 'b-pass', id, on: (Store.state.settings.passes || []).includes(id) })).join('') + '</div><p class="note" style="margin-top:8px">Sessions that need a pass you do not have are left out.</p>') +
        '<div class="b-go"><button class="btn primary block" data-act="b-build">' + icon('wand') + 'Build my schedule</button></div>';
      const upd = () => {
        const n = st.themes.length + st.tags.length + st.keywords.length;
        el.querySelector('#b-count').textContent = n ? n + ' picked' : 'pick a few';
      };
      upd();
      const flip = (arr, v) => { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); return i < 0; };
      ctx.on('b-theme', t => { t.classList.toggle('on', flip(st.themes, t.dataset.id)); Store.save('interests'); upd(); });
      ctx.on('b-tag', t => { t.classList.toggle('on', flip(st.tags, t.dataset.id)); Store.save('interests'); upd(); });
      const kwHost = el.querySelector('#b-kws'), kwIn = el.querySelector('#b-kw');
      const addKw = () => {
        const v = kwIn.value.trim().replace(/\s+/g, ' ');
        if (v.length < 2) return;
        if (!st.keywords.some(k => k.toLowerCase() === v.toLowerCase())) { st.keywords.push(v); Store.save('interests'); kwHost.insertAdjacentHTML('beforeend', chip(v, { act: 'b-kwdel', id: v, on: true, icon: 'x' })); }
        kwIn.value = ''; upd();
      };
      kwIn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addKw(); } });
      kwIn.addEventListener('blur', addKw);
      ctx.on('b-kwdel', t => { const i = st.keywords.indexOf(t.dataset.id); if (i >= 0) st.keywords.splice(i, 1); Store.save('interests'); t.remove(); upd(); });
      ctx.on('b-day', t => { const on = flip(o.days, +t.dataset.id); t.classList.toggle('on', on); saveOpts(o); });
      ctx.on('b-fmt', t => { const on = flip(o.formats, t.dataset.id); t.classList.toggle('on', on); saveOpts(o); });
      ctx.on('b-opt', t => { const k = t.dataset.id; o[k] = !o[k]; t.classList.toggle('on', o[k]); saveOpts(o); });
      ctx.on('b-pass', t => { const a = Store.state.settings.passes; t.classList.toggle('on', flip(a, t.dataset.id)); Store.save('settings'); });
      el.querySelector('#b-start').addEventListener('change', e => { o.start = +e.target.value; saveOpts(o); });
      el.querySelector('#b-end').addEventListener('change', e => { o.end = +e.target.value; saveOpts(o); });
      ctx.on('b-build', () => {
        addKw();
        const prof = interestProfile();
        if (prof.empty) { toast('Pick at least one theme, tag or keyword first'); el.querySelector('#b-themes').scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
        if (!o.days.length) { toast('Pick at least one day'); return; }
        if (!o.formats.length) { toast('Pick at least one kind of session'); return; }
        saveOpts(o);
        result = buildPlan(o, prof);
        go('#/builder?step=result');
      });
    }

    // actions on the result screen
    const redraw = () => { const host = el.querySelector('#b-result'); if (host) host.innerHTML = resultHTML(o); };
    const find = id => { for (const day of result.days) { const k = day.units.findIndex(u => u.it.id === id); if (k >= 0) return [day, k]; } return [null, -1]; };
    ctx.on('b-edit', () => go('#/builder', { replace: true }));
    ctx.on('b-addall', () => {
      let n = 0;
      for (const day of result.days) for (const u of day.units) if (!Plan.has(u.it.id)) { Plan.add(u.it.id); n++; }
      toast(n + ' added to My Plan'); go('#/plan');
    });
    ctx.on('b-drop', t => { const [day, k] = find(t.dataset.id); if (day) { day.alts.delete(day.units[k].it.i); day.units.splice(k, 1); redraw(); } });
    ctx.on('b-swap', t => {
      const [day, k] = find(t.dataset.id); if (!day) return;
      const u = day.units[k]; const alts = day.alts.get(u.it.i) || [];
      openSheet('<p class="lead">Running at the same time as “' + esc(u.it.t) + '”.</p>' +
        alts.map(a => itemCard(a.it, { parent: true, dense: true, noStar: true, score: a.rel, why: whyChips(a.why),
          extra: '<div class="b-tools"><button class="btn sm primary" data-act="b-use" data-id="' + esc(a.it.id) + '" data-for="' + esc(u.it.id) + '">Use this</button></div>' })).join(''),
      { title: 'Alternatives', tall: true });
    });
    ctx.on('b-use', t => {
      const [day, k] = find(t.dataset.for); if (!day) return;
      const old = day.units[k]; const alts = day.alts.get(old.it.i) || [];
      const pick = alts.find(a => a.it.id === t.dataset.id); if (!pick) return;
      day.units[k] = pick;
      // the old choice becomes an alternative of the new one
      day.alts.delete(old.it.i);
      day.alts.set(pick.it.i, [old].concat(alts.filter(a => a !== pick)).slice(0, 4));
      // drop neighbors that the new choice now overlaps
      const before = day.units.length;
      day.units = day.units.filter(v => v === pick || v.locked || !overlaps(v.it, pick.it));
      day.units.sort((a, b) => a.s - b.s);
      closeSheet(); redraw();
      toast(before !== day.units.length ? 'Swapped. One overlapping block was removed.' : 'Swapped');
    });
  },
});
