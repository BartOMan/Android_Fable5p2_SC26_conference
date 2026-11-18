// Venue map (#/map, #/map/<roomIdx>) and room page (#/room/<roomIdx>).
//
// Map: one floor plan at a time on a light "paper" sheet inside a pan and pinch-zoom
// surface (d3.zoom drives a CSS transform on .mp-world). Room pins and the walking
// line are drawn in screen space above the plan, so they keep their size and stay sharp.
//   query: layer=<layerId>  floor to show
//          from=<roomIdx>   with a room argument: walking hint from that room to the argument
//          sel=<roomIdx|x>  room picked on the map after opening (x = none); keeps Back honest
import { DB, nowMin, dayOf, dayInfo, fmtTime, visible, walkMin } from '../core.js';
import { registerView, setQuery } from '../router.js';
import { esc, icon, chip, itemCard, emptyState, openSheet, closeSheet } from '../ui.js';

const d3 = window.d3;

// ------------------------------------------------------------------ helpers
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const reducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const layerById = id => DB.layers.find(L => L.id === id) || null;
function validRoom(v) {
  if (v == null || v === '' || !/^\d+$/.test(String(v))) return null;
  const n = Number(v);
  return n < DB.rooms.length ? n : null;
}
const levelNum = f => { const m = /(\d+)/.exec(f || ''); return m ? +m[1] : null; };
const isCampus = L => levelNum(L.f) == null;
/** "West 1", "Lakeside 3", "Campus". */
const shortFloor = L => (isCampus(L) ? 'Campus' : L.b.replace(/ (Building|Center)$/, '') + ' ' + levelNum(L.f));
const placeOf = r => [r.b, r.f].filter(Boolean).join(' · ');
const theBuilding = b => (/Building$/.test(b) ? 'the ' + b : b);
const natural = (a, b) => a.n.localeCompare(b.n, 'en', { numeric: true, sensitivity: 'base' });
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));

/** Floors for the switcher: buildings with the most program rooms first, busiest level first, empty levels and the campus overview last. */
function floorOrder() {
  const cnt = {}, perB = {};
  for (const r of DB.rooms) cnt[r.l] = (cnt[r.l] || 0) + 1;
  for (const L of DB.layers) perB[L.b] = (perB[L.b] || 0) + (cnt[L.id] || 0);
  return DB.layers.map((L, i) => ({ L, i, n: cnt[L.id] || 0 })).sort((a, b) =>
    (isCampus(a.L) - isCampus(b.L)) || ((b.n > 0) - (a.n > 0)) || (perB[b.L.b] - perB[a.L.b]) ||
    (a.L.b === b.L.b ? b.n - a.n || levelNum(a.L.f) - levelNum(b.L.f) : a.i - b.i));
}

/** Sessions in a room that the current settings show, in time order. */
function sessionsIn(r) {
  return r.items.map(i => DB.items[i]).filter(it => it.k === 'S' && visible(it)).sort((a, b) => a.s - b.s || a.e - b.e);
}
/** What a room is doing at `now`: running session, next session, pin state. */
function roomStatus(r, now) {
  const list = sessionsIn(r);
  let cur = null, next = null;
  for (const it of list) {
    if (it.s <= now && now < it.e) { if (!cur || it.s > cur.s || (it.s === cur.s && it.e < cur.e)) cur = it; }
    else if (it.s > now && !next) next = it;
  }
  const laterToday = list.some(it => it.s > now && dayOf(it.s) === dayOf(now));
  const hidden = r.items.reduce((n, i) => n + (DB.items[i].k === 'S' && !visible(DB.items[i]) ? 1 : 0), 0);
  return { cur, next, n: list.length, hidden, state: cur ? 'now' : laterToday ? 'later' : 'done' };
}
const STATE_TEXT = { now: 'Session running now', later: 'More sessions later today', done: 'Nothing more today' };
const atText = (it, now) => (dayOf(it.s) === dayOf(now) ? 'at ' + fmtTime(it.s) : 'on ' + dayInfo(dayOf(it.s)).dow + ' at ' + fmtTime(it.s));
function statusLines(st, now, max = 2) {
  let h = '';
  if (st.cur) h += '<div class="mp-line st-now"><b>Now:</b> <span class="mp-t">' + esc(st.cur.t) + '</span> <em>until ' + fmtTime(st.cur.e) + '</em></div>';
  if (st.next && (max > 1 || !st.cur)) h += '<div class="mp-line st-next"><b>Next:</b> <span class="mp-t">' + esc(st.next.t) + '</span> <em>' + atText(st.next, now) + '</em></div>';
  if (!h) {
    h = '<div class="mp-line st-none">' + (st.n ? 'No more sessions in this room.'
      : st.hidden ? 'No technical program sessions here. Other events are hidden by the “Technical program only” setting.'
        : 'No sessions are listed for this room.') + '</div>';
  }
  return h;
}

/** "About 6 min walk from A to B (estimate)". */
function walkText(a, b) {
  const m = walkMin(a, b);
  if (m == null) return 'Walking time from ' + a.n + ' to ' + b.n + ' is not known';
  return 'About ' + m + ' min walk from ' + a.n + ' to ' + b.n + ' (estimate)';
}
/** Plain directions when the two rooms are on different floors or in different buildings. */
function walkDirections(a, b) {
  if (a.l === b.l) return '';
  if (a.b === b.b) {
    const la = levelNum(a.f), lb = levelNum(b.f);
    let s = a.n + ' is on ' + a.f + ' and ' + b.n + ' is on ' + b.f + ' of ' + theBuilding(a.b) + '.';
    if (la != null && lb != null && la !== lb) s += ' Take the escalators or elevators ' + (lb > la ? 'up ' : 'down ') + plural(Math.abs(lb - la), 'level') + '.';
    return s;
  }
  const lead = 'From ' + theBuilding(a.b) + ' (' + a.f + ') to ' + theBuilding(b.b) + ' (' + b.f + '): ';
  const has = n => a.b === n || b.b === n;
  if (has('West Building') && has('South Building')) return lead + 'the two buildings connect through the Grand Concourse.';
  if (has('Lakeside Center')) {
    const viaConcourse = has('West Building');
    if (b.b === 'Lakeside Center') return lead + (viaConcourse ? 'walk through the Grand Concourse, then cross the sky bridge to Lakeside Center.' : 'cross the sky bridge to Lakeside Center.');
    return lead + 'cross the sky bridge from Lakeside Center' + (viaConcourse ? ', then walk through the Grand Concourse to the West Building.' : ' to ' + theBuilding(b.b) + '.');
  }
  return lead + 'follow the signs between the buildings.';
}

/**
 * Combined rooms (W181abc) sit on top of one of their parts (W181b). Move the pin of the
 * combined room a little, across the row of its parts, so both pins can be tapped.
 * Returns Map(roomIdx -> [dx, dy]) in plan units.
 */
function pinNudges(rooms, L) {
  const out = new Map();
  const stem = r => (/^([A-Za-z]+\d+)/.exec(r.n) || [])[1] || null;
  for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
    const a = rooms[i], b = rooms[j];
    if (Math.hypot((a.x - b.x) * L.w, (a.y - b.y) * L.h) >= 12.5) continue;
    const mv = a.n.length >= b.n.length ? a : b;
    if (out.has(mv.i)) continue;
    const sib = rooms.filter(r => stem(r) && stem(r) === stem(mv));
    const xs = sib.map(r => r.x * L.w), ys = sib.map(r => r.y * L.h);
    const alongX = sib.length > 1 && (Math.max(...xs) - Math.min(...xs)) > (Math.max(...ys) - Math.min(...ys));
    out.set(mv.i, alongX ? [0, -9] : [10, 0]);
  }
  return out;
}

// ------------------------------------------------------------ walking routes
// data/routes.json (built by scraper/build_routes.py) holds the venue's walkway network per
// floor: vertices "n" (plan units x scale), edges "e" (vertex pairs) and the vertex of each
// room "r". It is loaded the first time a walking hint needs it. Without it, or when no
// walkway joins two rooms, the map falls back to a straight dashed line.
let ROUTES;                 // undefined until loaded; then {layerId: graph}, or null when it could not be loaded
let routesPromise = null;
function loadRoutes() {
  if (!routesPromise) {
    routesPromise = fetch('data/routes.json').then(r => (r.ok ? r.json() : null)).then(raw => {
      if (!raw || !raw.layers) return null;
      const out = {}, s = raw.scale || 1;
      for (const [id, L] of Object.entries(raw.layers)) {
        const n = L.n.length / 2, x = new Float32Array(n), y = new Float32Array(n), nb = Array.from({ length: n }, () => []);
        for (let i = 0; i < n; i++) { x[i] = L.n[2 * i] / s; y[i] = L.n[2 * i + 1] / s; }
        for (let i = 0; i + 1 < L.e.length; i += 2) { nb[L.e[i]].push(L.e[i + 1]); nb[L.e[i + 1]].push(L.e[i]); }
        out[id] = { x, y, nb, r: L.r || {} };
      }
      return out;
    }).catch(() => null).then(data => { ROUTES = data; return data; });
  }
  return routesPromise;
}
/** Shortest walkway between two rooms of one floor (Dijkstra): {pts: [[x, y], ...] in plan units, len} or null. */
function findRoute(G, a, b) {
  if (!G) return null;
  const s = G.r[a.id], t = G.r[b.id];
  if (s == null || t == null) return null;
  const n = G.x.length, dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n);
  dist[s] = 0;
  for (;;) {
    let v = -1, best = Infinity;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < best) { best = dist[i]; v = i; }
    if (v < 0 || v === t) break;
    done[v] = 1;
    for (const w of G.nb[v]) {
      const d = best + Math.hypot(G.x[v] - G.x[w], G.y[v] - G.y[w]);
      if (d < dist[w]) { dist[w] = d; prev[w] = v; }
    }
  }
  if (!Number.isFinite(dist[t])) return null;
  const pts = [];
  for (let v = t; v >= 0; v = prev[v]) pts.push([G.x[v], G.y[v]]);
  return { pts: pts.reverse(), len: dist[t] };
}

// ---------------------------------------------------------------- map view
const TOP_INSET = 60;       // floor chips
const FOCUS_K = 4.5;        // zoom used when a room is opened by link or from the finder
const TAP_K = 3;            // minimum zoom after tapping a pin

registerView('map', {
  title: 'Venue map', tab: 'home', full: true,
  render(el, ctx) {
    const floors = floorOrder();
    const argRoom = validRoom(ctx.args[0]);
    let sel = ctx.query.sel != null ? validRoom(ctx.query.sel) : argRoom;
    let from = sel != null ? validRoom(ctx.query.from) : null;
    if (from === sel) from = null;
    let layer = layerById(ctx.query.layer) || (sel != null ? layerById(DB.rooms[sel].l) : null) || floors[0].L;
    if (from == null && sel != null && DB.rooms[sel].l !== layer.id) sel = null;      // an explicit floor wins over a room that is elsewhere

    el.innerHTML =
      '<div class="mp-root">' +
      '<div class="mp-surface"><div class="mp-world"><div class="mp-sheet"></div></div>' +
      '<div class="mp-over"><svg class="mp-route" aria-hidden="true"><g><path class="mp-rbg"/><path class="mp-rfg"/></g></svg><div class="mp-pins"></div></div></div>' +
      '<div class="floatbar mp-bar"><div class="hscroll">' +
      chip('Find a room', { act: 'mp-find', icon: 'search', cls: 'mp-findbtn' }) +
      floors.map(f => chip(shortFloor(f.L), { act: 'mp-floor', id: f.L.id, count: isCampus(f.L) ? null : f.n })).join('') +
      '</div></div>' +
      '<div class="mp-bottom"><div class="mp-tools">' +
      '<div class="mp-legend" aria-label="Pin colors"><span><i style="--c:#34D399"></i>Session now</span><span><i style="--c:#22D3EE"></i>Later today</span>' +
      '<span><i style="--c:#8E98B8"></i>Nothing more today</span><span class="mp-note" hidden></span></div>' +
      '<button class="mp-fab" data-act="mp-reset" aria-label="Show the whole floor">' + icon('target') + '</button></div>' +
      '<div class="overlay-card mp-card" hidden></div></div>' +
      '</div>';
    const root = el.firstChild;
    const surface = root.querySelector('.mp-surface'), world = root.querySelector('.mp-world'), sheet = root.querySelector('.mp-sheet');
    const routeSvg = root.querySelector('.mp-route'), routeG = routeSvg.firstChild, routeBg = routeG.children[0], routeFg = routeG.children[1];
    const pinsEl = root.querySelector('.mp-pins'), bar = root.querySelector('.mp-bar .hscroll');
    const bottom = root.querySelector('.mp-bottom'), card = root.querySelector('.mp-card'), note = root.querySelector('.mp-note');
    bar.querySelectorAll('[data-act="mp-floor"]').forEach(b => b.setAttribute('title', layerById(b.dataset.id).n));

    let W = 0, H = 0, pw = 0, ph = 0, x0 = 0, y0 = 0;     // surface size, plan size and position at zoom 1
    let T = d3.zoomIdentity, pins = [], lblK = 0, crispTimer = 0, status = new Map(), lastMin = nowMin();
    let routesAsked = false, routeBox = null;             // walkway network requested by this view; box of the drawn line
    const pinOf = idx => pins.find(p => p.r.i === idx) || null;
    const statusOf = r => { let s = status.get(r.i); if (!s) { s = roomStatus(r, lastMin); status.set(r.i, s); } return s; };

    // ---- zoom
    const zoom = d3.zoom().scaleExtent([1, 8]).clickDistance(6).tapDistance(12)
      .on('start', () => { clearTimeout(crispTimer); world.style.willChange = 'transform'; })
      .on('zoom', ev => { T = ev.transform; paint(); })
      .on('end', () => {
        // drop the compositing hint so the plan is drawn again, sharp, at the new scale
        clearTimeout(crispTimer); crispTimer = setTimeout(() => { world.style.willChange = ''; }, 160);
        root.dataset.k = T.k.toFixed(3);
        layoutLabels();
      });
    const zsel = d3.select(surface).call(zoom);

    function paint() {
      const k = T.k;
      world.style.transform = 'translate(' + T.x.toFixed(2) + 'px,' + T.y.toFixed(2) + 'px) scale(' + k.toFixed(4) + ')';
      routeG.setAttribute('transform', 'translate(' + T.x.toFixed(2) + ',' + T.y.toFixed(2) + ') scale(' + k.toFixed(4) + ')');
      for (const p of pins) {
        p.sx = T.x + p.wx * k; p.sy = T.y + p.wy * k;
        p.el.style.transform = 'translate(' + p.sx.toFixed(1) + 'px,' + p.sy.toFixed(1) + 'px)';
      }
      if (Math.abs(k / (lblK || 1e-9) - 1) > 0.04) layoutLabels();
    }
    const homeT = () => d3.zoomIdentity.translate(x0, y0);
    function applyT(t, animate) {
      zsel.interrupt();
      if (animate && !reducedMotion()) zsel.transition().duration(animate === true ? 650 : animate).call(zoom.transform, t);
      else zsel.call(zoom.transform, t);
    }
    /** Size the plan so the whole floor fits between the chips and the bottom tools. */
    function layout() {
      W = surface.clientWidth || 360; H = surface.clientHeight || 640;
      const availH = Math.max(160, H - TOP_INSET - 66);
      const s0 = Math.min((W - 16) / layer.w, availH / layer.h);
      pw = layer.w * s0; ph = layer.h * s0;
      x0 = (W - pw) / 2; y0 = TOP_INSET + (availH - ph) * 0.3;
      world.style.width = pw.toFixed(2) + 'px'; world.style.height = ph.toFixed(2) + 'px';
      zoom.extent([[0, 0], [W, H]]).translateExtent([[-x0 - W * 0.45, -y0 - H * 0.45], [W - x0 + W * 0.45, H - y0 + H * 0.45]]);
      // the name of a selected pin in the middle of the screen must end before the screen does
      root.style.setProperty('--mp-lblmax', Math.max(110, Math.floor(W / 2 - 30)) + 'px');
      for (const p of pins) { p.wx = (p.r.x + p.dx / layer.w) * pw; p.wy = (p.r.y + p.dy / layer.h) * ph; p.lw = p.lbl.offsetWidth; }
      lblK = 0;
      drawRoute();
    }
    /** Middle of the part of the map that the chips and the bottom card leave free. */
    const freeCenter = () => { const b = bottom.offsetHeight; return [W / 2, TOP_INSET + Math.max(80, H - TOP_INSET - b) / 2]; };
    function focusRoom(idx, animate, k) {
      const p = pinOf(idx); if (!p) return;
      const [cx, cy] = freeCenter();
      applyT(d3.zoomIdentity.translate(cx - p.wx * k, cy - p.wy * k).scale(k), animate);
    }
    /** Fit both pins of a walking hint, and the walkway between them, into the free part of the map. */
    function fitPair(a, b, animate) {
      const pa = pinOf(a), pb = pinOf(b); if (!pa || !pb) return;
      const box = routeBox || [Math.min(pa.wx, pb.wx), Math.min(pa.wy, pb.wy), Math.max(pa.wx, pb.wx), Math.max(pa.wy, pb.wy)];
      const [cx, cy] = freeCenter(); const fh = Math.max(80, H - TOP_INSET - bottom.offsetHeight);
      const k = clamp(Math.min((W - 150) / Math.max(1, box[2] - box[0]), (fh - 110) / Math.max(1, box[3] - box[1])), 1, 5);
      applyT(d3.zoomIdentity.translate(cx - (box[0] + box[2]) / 2 * k, cy - (box[1] + box[3]) / 2 * k).scale(k), animate);
    }
    /** Bring the current selection into view on the floor that is showing. */
    function frame(animate, k) {
      const selHere = sel != null && DB.rooms[sel].l === layer.id, fromHere = from != null && DB.rooms[from].l === layer.id;
      if (selHere && fromHere) fitPair(from, sel, animate);
      else if (selHere) focusRoom(sel, animate, k || FOCUS_K);
      else if (fromHere) focusRoom(from, animate, k || FOCUS_K);
      else applyT(homeT(), animate);
    }

    // ---- pins
    function buildPins() {
      const rooms = DB.rooms.filter(r => r.l === layer.id);
      const nudge = pinNudges(rooms, layer);
      pins = rooms.map(r => ({ r, dx: (nudge.get(r.i) || [0, 0])[0], dy: (nudge.get(r.i) || [0, 0])[1], wx: 0, wy: 0, sx: 0, sy: 0, lw: 0, el: null, lbl: null }));
      pinsEl.innerHTML = pins.map(p => '<button class="mp-pin" data-act="mp-pin" data-id="' + p.r.i + '"><span class="mp-dot"></span><span class="mp-lbl"></span></button>').join('');
      pins.forEach((p, i) => { p.el = pinsEl.children[i]; p.lbl = p.el.lastChild; });
      markPins();
      note.hidden = pins.length > 0;
      note.textContent = pins.length ? '' : isCampus(layer) ? 'Campus overview. Pick a floor above to see its rooms.' : 'No program rooms on this level.';
    }
    /** Apply clock state and selection to the pins of this floor. */
    function markPins() {
      for (const p of pins) {
        const st = statusOf(p.r), isSel = p.r.i === sel, isFrom = p.r.i === from;
        p.state = st.state; p.n = st.n; p.forced = isSel || isFrom;
        p.el.className = 'mp-pin st-' + st.state + (isSel ? ' is-sel' : '') + (isFrom ? ' is-from' : '');
        const text = (isFrom ? 'Start: ' : '') + p.r.n;
        if (p.lbl.textContent !== text) p.lbl.textContent = text;
        p.el.setAttribute('aria-label', p.r.n + ', ' + STATE_TEXT[st.state].toLowerCase() + (isSel ? ', selected' : ''));
        p.lw = p.lbl.offsetWidth;
      }
      lblK = 0;
      if (pw) layoutLabels();
    }
    /** Show a name next to a pin when it fits without covering another pin or another name. */
    function layoutLabels() {
      lblK = T.k;
      const rank = p => (p.forced ? 0 : p.state === 'now' ? 1 : p.state === 'later' ? 2 : 3);
      const order = pins.slice().sort((a, b) => rank(a) - rank(b) || b.n - a.n || a.r.i - b.r.i);
      const placed = [];
      const free = (x1, y1, x2, y2, self) => {
        for (const q of pins) if (q !== self && q.sx + 8 > x1 && q.sx - 8 < x2 && q.sy + 8 > y1 && q.sy - 8 < y2) return false;
        for (const b of placed) if (b[2] > x1 && b[0] < x2 && b[3] > y1 && b[1] < y2) return false;
        return true;
      };
      // a pin whose dot touches another dot gets no name until the user zooms in
      const crowded = p => pins.some(q => q !== p && Math.abs(q.sx - p.sx) < 12 && Math.abs(q.sy - p.sy) < 12);
      for (const p of order) {
        const gap = p.forced ? 15 : 10, h = p.forced ? 12 : 10, w = p.lw + 3;
        const fitsR = p.sx + gap + w <= W - 4, fitsL = p.sx - gap - w >= 4;
        const okR = () => free(p.sx + gap, p.sy - h, p.sx + gap + w, p.sy + h, p), okL = () => free(p.sx - gap - w, p.sy - h, p.sx - gap, p.sy + h, p);
        const onScreen = p.sx > 0 && p.sx < W;      // names of pins on screen must not run off its edge
        let side = '';
        if (p.forced) side = fitsR && okR() ? 'r' : fitsL && okL() ? 'l' : fitsR || !fitsL ? 'r' : 'l';
        else if (!crowded(p)) side = (fitsR || !onScreen) && okR() ? 'r' : (fitsL || !onScreen) && okL() ? 'l' : '';
        p.el.classList.toggle('has-lbl', !!side);
        p.el.classList.toggle('lbl-left', side === 'l');
        if (side === 'r') placed.push([p.sx + gap, p.sy - h, p.sx + gap + w, p.sy + h]);
        else if (side === 'l') placed.push([p.sx - gap - w, p.sy - h, p.sx - gap, p.sy + h]);
      }
    }

    // ---- walking line between two rooms on the same floor: the walkway when the route
    //      network has one ("path"), otherwise a straight dashed line ("line")
    function drawRoute() {
      const pa = from != null ? pinOf(from) : null, pb = sel != null ? pinOf(sel) : null;
      let d = '', kind = 'none';
      routeBox = null;
      if (pa && pb) {
        const found = ROUTES ? findRoute(ROUTES[layer.id], pa.r, pb.r) : null;
        const pts = [[pa.wx, pa.wy]];
        if (found) for (const [x, y] of found.pts) pts.push([x / layer.w * pw, y / layer.h * ph]);
        pts.push([pb.wx, pb.wy]);
        kind = found ? 'path' : 'line';
        d = 'M' + pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('L');
        routeBox = [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))];
        if (ROUTES === undefined && !routesAsked) {
          // first walking hint: fetch the network, then swap the straight line for the walkway
          routesAsked = true;
          loadRoutes().then(data => {
            if (!ctx.alive() || !data) return;
            drawRoute(); renderCard();
            if (root.dataset.route === 'path') frame(true);
          });
        }
      }
      routeBg.setAttribute('d', d); routeFg.setAttribute('d', d);
      routeFg.setAttribute('class', 'mp-rfg' + (kind === 'line' ? ' is-dash' : ''));
      routeSvg.style.display = d ? '' : 'none';
      root.dataset.route = kind;
    }

    // ---- floor
    function showLayer(L) {
      layer = L; root.dataset.layer = L.id;
      bar.querySelectorAll('[data-act="mp-floor"]').forEach(b => {
        const on = b.dataset.id === L.id;
        b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
        if (on) bar.scrollLeft = b.offsetLeft - (bar.clientWidth - b.offsetWidth) / 2;
      });
      sheet.textContent = '';
      const img = new Image();
      img.className = 'mp-plan'; img.alt = 'Floor plan: ' + L.n; img.draggable = false;
      img.onload = () => img.classList.add('is-ok');
      img.onerror = () => { sheet.insertAdjacentHTML('beforeend', '<div class="mp-err">This floor plan could not be loaded.</div>'); };
      img.src = L.file;
      sheet.appendChild(img);
      buildPins();
      layout();
    }
    function markChips() {
      const legs = new Set([sel, from].filter(v => v != null).map(v => DB.rooms[v].l));
      bar.querySelectorAll('[data-act="mp-floor"]').forEach(b => b.classList.toggle('mp-leg', from != null && legs.has(b.dataset.id)));
    }

    // ---- bottom card
    function renderCard() {
      markChips();
      if (sel == null) { card.hidden = true; card.textContent = ''; return; }
      const r = DB.rooms[sel], st = statusOf(r), now = lastMin, a = from != null ? DB.rooms[from] : null;
      const open = st.cur || st.next;
      let h = '<div class="mp-card-x">' +
        (a ? '' : '<button class="iconbtn" data-act="mp-from" aria-label="Walking time from another room">' + icon('walk') + '</button>') +
        '<button class="iconbtn" data-act="mp-close" aria-label="Close">' + icon('x') + '</button></div>' +
        '<div class="mp-card-h"><h3>' + esc(r.n) + '</h3><div class="mp-sub"><span>' + esc(placeOf(r)) + '</span>' +
        '<span class="mp-st st-' + st.state + '">' + STATE_TEXT[st.state] + '</span></div></div>';
      if (a) {
        const dir = walkDirections(a, r) ||
          (ROUTES && root.dataset.route === 'line' ? 'The venue plan shows no walkway between these two rooms on this level. The dashed line only shows the direction.' : '');
        h += '<div class="mp-walk">' + icon('walk') + '<div><b class="mp-walk-t">' + esc(walkText(a, r)) + '</b>' + (dir ? '<p class="mp-walk-d">' + esc(dir) + '</p>' : '') + '</div></div>';
        if (a.l !== r.l) {
          h += '<div class="mp-legs">' + [[a, 'Start'], [r, 'End']].map(([x, w]) =>
            chip(w + ': ' + x.n + ' · ' + shortFloor(layerById(x.l)), { act: 'mp-leg', id: x.i, cls: 'sm', on: x.l === layer.id })).join('') + '</div>';
        }
        if (open) h += statusLines(st, now, 1);
      } else {
        h += statusLines(st, now);
      }
      h += '<div class="btnrow"><button class="btn" data-go="#/room/' + r.i + '">' + icon('calendar') + 'Room schedule</button>' +
        (open ? '<button class="btn primary" data-go="#/item/' + esc(open.id) + '">' + (st.cur ? 'Open session' : 'Open next session') + '</button>' : '') + '</div>';
      card.className = 'overlay-card mp-card' + (a ? ' is-walk' : '');
      card.dataset.room = String(r.i);
      card.innerHTML = h;
      card.hidden = false;
    }

    const syncUrl = () => setQuery({ layer: layer.id, sel: sel === argRoom ? null : (sel == null ? 'x' : sel), from });
    /** Select a room, switch to its floor when needed, and bring it into view. */
    function select(idx, o = {}) {
      sel = idx;
      if (from === sel) from = null;
      const L = layerById(DB.rooms[idx].l);
      const switched = L && L.id !== layer.id;
      if (switched) showLayer(L);
      markPins(); drawRoute(); renderCard();
      if (switched) applyT(homeT(), false);
      frame(o.animate !== false, Math.max(o.k || TAP_K, switched ? 0 : T.k));
      syncUrl();
    }

    ctx.on('mp-pin', (t, ev) => {
      let idx = validRoom(t.dataset.id); if (idx == null) return;
      // where pins crowd together their tap areas overlap: take the pin nearest to the finger
      if (ev && ev.detail > 0 && Number.isFinite(ev.clientX)) {
        const b = surface.getBoundingClientRect(), x = ev.clientX - b.left, y = ev.clientY - b.top;
        let best = 24 * 24;
        for (const p of pins) { const d = (p.sx - x) * (p.sx - x) + (p.sy - y) * (p.sy - y); if (d < best) { best = d; idx = p.r.i; } }
      }
      select(idx, { k: TAP_K });
    });
    ctx.on('mp-close', () => { sel = null; from = null; markPins(); drawRoute(); renderCard(); syncUrl(); });
    ctx.on('mp-reset', () => applyT(homeT(), true));
    ctx.on('mp-floor', t => {
      const L = layerById(t.dataset.id); if (!L) return;
      if (L.id === layer.id) { applyT(homeT(), true); syncUrl(); return; }
      if (from == null && sel != null && DB.rooms[sel].l !== L.id) sel = null;     // a single selection does not follow you to another floor
      showLayer(L); renderCard();
      frame(false);
      syncUrl();
    });
    ctx.on('mp-leg', t => {
      const idx = validRoom(t.dataset.id); if (idx == null) return;
      const L = layerById(DB.rooms[idx].l);
      if (L.id !== layer.id) { showLayer(L); renderCard(); applyT(homeT(), false); syncUrl(); }
      focusRoom(idx, true, FOCUS_K);
    });

    // ---- room finder (also used to pick the start of a walk)
    let finderMode = 'go';
    function openFinder(mode) {
      finderMode = mode;
      const now = nowMin();
      const groups = floors.filter(f => f.n > 0).map(f => ({ L: f.L, rooms: DB.rooms.filter(r => r.l === f.L.id).sort(natural) }));
      const body = openSheet(
        '<div class="field mp-q">' + icon('search') + '<input type="search" placeholder="Room name or number, for example W183" aria-label="Room name or number" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search"></div>' +
        '<div class="mp-find-list"></div>', { title: mode === 'from' ? 'Walk to ' + DB.rooms[sel].n + ' from…' : 'Find a room', tall: true });
      const input = body.querySelector('input'), list = body.querySelector('.mp-find-list');
      const squash = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
      const draw = () => {
        const toks = input.value.toLowerCase().split(/\s+/).map(squash).filter(Boolean);
        let h = '', total = 0;
        for (const g of groups) {
          const rs = g.rooms.filter(r => { const n = squash(r.n); return toks.every(t => n.includes(t)) && !(mode === 'from' && r.i === sel); });
          if (!rs.length) continue;
          total += rs.length;
          h += '<div class="mp-grp">' + esc(g.L.n) + '<span>' + plural(rs.length, 'room') + '</span></div><div class="mp-grp-rows">' + rs.map(r => {
            const st = roomStatus(r, now);
            const sub = st.cur ? 'Now: ' + st.cur.t : st.next ? 'Next ' + atText(st.next, now) + ': ' + st.next.t : st.n ? 'No more sessions' : 'No sessions to show';
            return '<div class="row mp-rrow" data-act="mp-pick" data-id="' + r.i + '"><span class="mp-sd st-' + st.state + '"></span>' +
              '<div class="row-main"><div class="row-title">' + esc(r.n) + '</div><div class="row-sub">' + esc(sub) + '</div></div>' +
              '<div class="row-right"><b>' + st.n + '</b>' + (st.n === 1 ? 'session' : 'sessions') + '</div></div>';
          }).join('') + '</div>';
        }
        list.innerHTML = h || '<div class="mp-find-empty">No room matches “' + esc(input.value.trim()) + '”.</div>';
        list.dataset.count = String(total);
      };
      input.addEventListener('input', draw);
      draw();
    }
    ctx.on('mp-find', () => openFinder('go'));
    ctx.on('mp-from', () => { if (sel != null) openFinder('from'); });
    ctx.on('mp-pick', t => {
      const idx = validRoom(t.dataset.id); if (idx == null) return;
      closeSheet();
      if (finderMode === 'from' && sel != null) {
        from = idx === sel ? null : idx;
        markPins(); drawRoute(); renderCard(); frame(true); syncUrl();
      } else {
        select(idx, { k: FOCUS_K });
      }
    });

    // ---- first paint
    showLayer(layer);
    renderCard();
    applyT(homeT(), false);
    if (sel != null || from != null) {
      if (ctx.isBack) frame(false);
      else requestAnimationFrame(() => { if (ctx.alive()) frame(900); });
    }

    // ---- keep pin colors and the card honest as the clock moves; refit when the screen changes
    const timer = setInterval(() => {
      const n = nowMin(); if (n === lastMin) return;
      lastMin = n; status = new Map();
      markPins(); renderCard();
    }, 20000);
    let ro = null;
    if (window.ResizeObserver) {
      ro = new ResizeObserver(() => {
        if (surface.clientWidth === W && surface.clientHeight === H) return;
        if (!surface.clientWidth || !surface.clientHeight) return;
        layout(); frame(false);
      });
      ro.observe(surface);
    }
    return () => {
      clearInterval(timer); clearTimeout(crispTimer);
      if (ro) ro.disconnect();
      zsel.interrupt(); zsel.on('.zoom', null);
    };
  },
});

// --------------------------------------------------------------- room view
/** Sessions and stray talks (talks whose session is in another room) listed on the room page. */
function roomEntries(r) {
  return r.items.map(i => DB.items[i]).filter(it => visible(it) &&
    (it.k === 'S' || (it.k === 'P' && it.par != null && DB.items[it.par].r !== r.i)))
    .sort((a, b) => a.s - b.s || a.e - b.e || a.i - b.i);
}

registerView('room', {
  title: args => { const i = validRoom(args[0]); return i != null ? DB.rooms[i].n : 'Room'; },
  tab: 'schedule',
  render(el, ctx) {
    const idx = validRoom(ctx.args[0]);
    if (idx == null) {
      el.innerHTML = emptyState('pin', 'Room not found', 'This room is not in the SC26 program.', '<button class="btn" data-go="#/map">Open the venue map</button>');
      return undefined;
    }
    const r = DB.rooms[idx], L = layerById(r.l);
    const entries = roomEntries(r);
    const days = Array.from(new Set(entries.map(it => it.day))).sort((a, b) => a - b);
    const perDay = d => entries.filter(it => it.day === d);
    const today = dayOf(nowMin());
    let day = days.includes(+ctx.query.d) && ctx.query.d !== '' ? +ctx.query.d
      : days.includes(today) ? today : days.find(d => d > today) != null ? days.find(d => d > today) : days[0];

    ctx.setActions('<button class="iconbtn" data-go="#/map/' + r.i + '" aria-label="Show on map">' + icon('pin') + '</button>');
    const hidden = r.items.reduce((n, i) => n + (DB.items[i].k === 'S' && !visible(DB.items[i]) ? 1 : 0), 0);

    el.innerHTML =
      '<div class="card mp-rhead">' +
      (L ? '<div class="mp-mini" data-go="#/map/' + r.i + '" role="link" aria-label="Show ' + esc(r.n) + ' on the map">' +
        '<div class="mp-mini-plan"><img alt="" draggable="false" src="' + esc(L.file) + '"></div>' +
        '<span class="mp-pin is-sel"><span class="mp-dot"></span></span>' +
        '<span class="mp-mini-cap">' + icon('layers') + esc(shortFloor(L)) + '</span></div>' : '') +
      '<div class="mp-rinfo"><div class="mp-rtop"><div><h2>' + esc(r.n) + '</h2><div class="mp-sub"></div></div>' +
      (L ? '<button class="btn primary sm" data-go="#/map/' + r.i + '">' + icon('pin') + '<span>Show on map</span></button>' : '') + '</div>' +
      '<div class="mp-rstatus"></div></div></div>' +
      (days.length
        ? '<div class="daytabs mp-days" role="tablist">' + days.map(d => {
          const di = dayInfo(d), n = perDay(d).length;
          return '<button class="daytab' + (d === today ? ' today' : '') + '" role="tab" data-act="mp-day" data-id="' + d + '" aria-label="' + di.long + ', ' + plural(n, 'session') + '">' +
            '<small>' + di.dow + '</small><b>' + di.date + '</b><em>' + plural(n, 'session') + '</em></button>';
        }).join('') + '</div><div class="mp-rlist"></div>'
        : emptyState('calendar', 'No sessions to show',
          hidden ? 'This room only hosts community or exhibitor events. They are hidden by the “Technical program only” setting.' : 'Nothing in the program is listed for this room.',
          hidden ? '<button class="btn" data-go="#/settings">Open settings</button>' : ''));

    const sub = el.querySelector('.mp-sub'), statusEl = el.querySelector('.mp-rstatus'), list = el.querySelector('.mp-rlist');
    const mini = el.querySelector('.mp-mini');

    function drawHead() {
      const now = nowMin(), st = roomStatus(r, now);
      sub.innerHTML = '<span>' + esc(placeOf(r)) + '</span><span class="mp-st st-' + st.state + '">' + STATE_TEXT[st.state] + '</span>';
      statusEl.innerHTML = days.length ? statusLines(st, now) : '';
      if (mini) mini.querySelector('.mp-pin').className = 'mp-pin is-sel st-' + st.state;
    }
    function drawList() {
      if (!list) return;
      const now = nowMin(), items = perDay(day);
      el.querySelectorAll('.mp-days .daytab').forEach(b => {
        const on = +b.dataset.id === day;
        b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on));
      });
      let h = '';
      if (day === today) {
        // today: what is over, then the "now" marker, then what is running or still to come
        const past = items.filter(it => it.e <= now), rest = items.filter(it => it.e > now);
        h = past.map(it => itemCard(it, { parent: true })).join('') +
          '<div class="mp-nowline"><i></i>Now · ' + fmtTime(now) + (rest.length ? '' : ' · nothing more here today') + '</div>' +
          rest.map(it => itemCard(it, { parent: true })).join('');
      } else {
        h = items.map(it => itemCard(it, { parent: true })).join('');
      }
      list.dataset.day = String(day); list.dataset.count = String(items.length);
      list.innerHTML = h;
    }
    /** Crop the floor plan around the room; the pin stays in the middle of the preview. */
    function drawMini() {
      if (!mini || !L) return;
      const bw = mini.clientWidth, bh = mini.clientHeight; if (!bw) return;
      const w = bw * 2.7, h = w * L.h / L.w, plan = mini.firstChild;
      plan.style.width = w.toFixed(1) + 'px'; plan.style.height = h.toFixed(1) + 'px';
      plan.style.transform = 'translate(' + (bw / 2 - r.x * w).toFixed(1) + 'px,' + (bh / 2 - r.y * h).toFixed(1) + 'px)';
    }

    ctx.on('mp-day', t => {
      const d = +t.dataset.id; if (!days.includes(d) || d === day) return;
      day = d; setQuery({ d: day }); drawList();
    });

    drawHead(); drawList(); drawMini();
    const onTab = el.querySelector('.mp-days .daytab.on');
    if (onTab) onTab.parentNode.scrollLeft = onTab.offsetLeft - (onTab.parentNode.clientWidth - onTab.offsetWidth) / 2;

    let last = nowMin();
    const timer = setInterval(() => { const n = nowMin(); if (n !== last) { last = n; drawHead(); if (day === today) drawList(); } }, 20000);
    let ro = null;
    if (mini && window.ResizeObserver) { ro = new ResizeObserver(drawMini); ro.observe(mini); }
    return () => { clearInterval(timer); if (ro) ro.disconnect(); };
  },
});
