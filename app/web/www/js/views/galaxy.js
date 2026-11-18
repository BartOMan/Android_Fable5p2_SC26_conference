// SC26 Atlas: topic galaxy. Every talk that has a place in the text-similarity
// layout is drawn as a glowing dot on one canvas. Similar talks sit close
// together, so the map shows the range of topics at a glance. The user can
// pan, pinch, tap a dot to see its neighbors, filter, search and recolor.
//
// Query parameters (all optional, kept in sync with setQuery):
//   theme=<themeId>  highlight one theme and zoom to it
//   it=<itemId>      select one item and zoom to it
//   q=<text>         dim everything except search matches
//   c=theme|format|day|me   color mode (theme is the default)
//   d=<day index>    day filter      f=<formatId>  format filter      plan=1  ring my plan
import {
  DB, Plan, bus, visible, relevance, interestProfile, searchItems, tokens, fmtWhen, roomOf, dayInfo, FLAG,
} from '../core.js';
import { registerView, setQuery } from '../router.js';
import { esc, icon, chip, fmtPill, starBtn, openSheet, closeSheet, toast, emptyState } from '../ui.js';

const DPR_CAP = 2.5;
const K_MIN = 1, K_MAX = 16;
const TAP_PX = 24;                 // a tap selects the nearest dot within this many screen px
const MOVE_PX = 10;                // more movement than this is a pan, not a tap
const TITLE_K = 4.5;               // from this zoom on, dots near the center get title labels
const ENT_TOTAL = 950, ENT_DOT = 700, ENT_STAGGER = 220;   // entrance animation, ms
const NEUTRAL = '#8E99BC';
const DAY_COLORS = ['#94A3B8', '#38BDF8', '#A78BFA', '#F472B6', '#FBBF24', '#34D399', '#FF7A59', '#CBD5E1'];
const MODES = [['theme', 'Theme'], ['format', 'Format'], ['day', 'Day'], ['me', 'For me']];
const HEADLINE = new Set(['keynote', 'plenary', 'invited', 'gb', 'award']);
const FONT = 'system-ui, -apple-system, Roboto, "Segoe UI", sans-serif';
const ME_STEPS = 12;
const ME_STOPS = ['#3B4877', '#3567C9', '#22B8EE', '#7FE9DC', '#FFE27A'];
const ME_IDLE = '#7F8FBF';
// Every dot is drawn from one sprite sheet (a glow and a core per color), so the browser can batch all
// drawImage calls of a frame into a few GPU draws instead of switching texture for every dot.
const GLOW_PX = 80, CORE_PX = 40, CELL_GAP = 2, CORE_SOLID = 0.78;   // sprite sizes; solid part of the core sprite
const ATLAS_W = 1024, GLOW_COLS = Math.floor(ATLAS_W / (GLOW_PX + CELL_GAP)), GLOW_ROWS = 9;
const CORE_COLS = Math.floor(ATLAS_W / (CORE_PX + CELL_GAP)), CORE_ROWS = 5, CORE_Y0 = GLOW_ROWS * (GLOW_PX + CELL_GAP);
const ATLAS_H = CORE_Y0 + CORE_ROWS * (CORE_PX + CELL_GAP);
const MAX_COLORS = Math.min(GLOW_COLS * GLOW_ROWS, CORE_COLS * CORE_ROWS);   // 108 colors; themes + formats + days + ramp need about 80
const LABELS_PER_FRAME = 3;        // new text sprites per frame; more than that waits for the next frame
const THEME_GROW = 1.16;           // theme names grow by this much between the overview and a close zoom
const LABEL_PAD = 5;                // room around label text for its dark halo
const NEB_SCALE = 0.5;             // the nebula layer is rendered at half resolution

const RESET_ICON = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4"/><circle cx="12" cy="12" r="2.2"/></svg>';

const clamp01 = t => (t < 0 ? 0 : t > 1 ? 1 : t);
const ease3 = t => 1 - Math.pow(1 - t, 3);
const smooth = t => { t = clamp01(t); return t * t * (3 - 2 * t); };
const fmtN = n => Number(n).toLocaleString('en-US');
const mod = (a, n) => ((a % n) + n) % n;

function rng(seed) {   // small deterministic generator so the star field and stagger never change
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Break a long theme name into two balanced lines. */
function wrap2(name) {
  if (name.length <= 20) return [name];
  const words = name.split(' ');
  let best = null;
  for (let j = 1; j < words.length; j++) {
    const a = words.slice(0, j).join(' '), b = words.slice(j).join(' ');
    const cost = Math.max(a.length, b.length) + (b[0] === '&' ? 3 : 0);
    if (!best || cost < best.cost) best = { cost, lines: [a, b] };
  }
  return best ? best.lines : [name];
}

function shortTitle(t, max = 30) {
  t = String(t || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  let cut = t.lastIndexOf(' ', max - 1);
  if (cut < max * 0.6) cut = max - 1;
  return t.slice(0, cut).replace(/[\s,:;.\-–—(]+$/, '') + '…';
}

// The last view (zoom and URL) so that Back returns to exactly where the user was.
let memo = null;

function mount(el, ctx) {
  const d3 = window.d3;
  const items = DB.items.filter(it => it.x && visible(it));
  const N = items.length;
  if (!d3 || !N) {
    el.innerHTML = '<div class="gx-none">' + emptyState('sparkles', 'Nothing to map yet',
      'No talks with a map position are available with the current settings.',
      '<button class="btn" data-go="#/settings">Open settings</button>') + '</div>';
    return () => {};
  }
  const reduceMq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const sideMq = window.matchMedia ? window.matchMedia('(max-height: 520px) and (orientation: landscape)') : null;   // same rule as galaxy.css
  let reduce = !!(reduceMq && reduceMq.matches);

  // ------------------------------------------------------------ static data
  const pointOf = new Map(items.map((it, i) => [it.i, i]));       // item index -> point index
  const themeOf = new Int16Array(N);
  const neigh = new Array(N);
  const bsz = new Float32Array(N);        // size by kind: headline sessions are bigger stars
  const prio = new Float32Array(N);       // fixed label priority, so labels do not flicker while panning
  const delay = new Float32Array(N);      // entrance stagger
  const lx = new Float32Array(N), ly = new Float32Array(N);       // layout position 0..1000
  const rand = rng(2026);
  const seen = new Map();
  const dayCount = new Map(), fmtCount = new Map(), themeCount = new Array(DB.themes.length).fill(0);
  const themePts = DB.themes.map(() => []);
  for (let i = 0; i < N; i++) {
    const it = items[i];
    let x = it.x[0], y = it.x[1];
    const key = x + ',' + y; const dup = seen.get(key) || 0; seen.set(key, dup + 1);
    if (dup) { const a = dup * 2.4; x += Math.cos(a) * 3.2; y += Math.sin(a) * 3.2; }   // spread exact duplicates
    lx[i] = x; ly[i] = y;
    themeOf[i] = it.th.length ? it.th[0][0] : -1;
    if (themeOf[i] >= 0) { themeCount[themeOf[i]]++; themePts[themeOf[i]].push(i); }
    neigh[i] = it.sim.map(s => pointOf.get(s)).filter(v => v != null && v !== i);
    const head = HEADLINE.has(DB.formats[it.f].id);
    const award = !!(it.fl & (FLAG.GB | FLAG.BEST_PAPER | FLAG.BEST_STUDENT));
    bsz[i] = head ? 1.55 : award ? 1.4 : it.k === 'S' ? 1.2 : 1;
    prio[i] = (head ? 3 : 0) + (award ? 2 : 0) + (it.k === 'S' ? 0.5 : 0) + rand();
    dayCount.set(it.day, (dayCount.get(it.day) || 0) + 1);
    fmtCount.set(it.f, (fmtCount.get(it.f) || 0) + 1);
  }
  const days = Array.from(dayCount.keys()).sort((a, b) => a - b);
  const fmts = Array.from(fmtCount.keys()).sort((a, b) => fmtCount.get(b) - fmtCount.get(a) || a - b);
  const themeRank = DB.themes.map((t, i) => i).filter(i => themeCount[i] > 0).sort((a, b) => themeCount[b] - themeCount[a] || a - b);
  const rankOf = new Int16Array(DB.themes.length).fill(99);
  themeRank.forEach((t, r) => { rankOf[t] = r; });

  // ------------------------------------------------------------------ state
  const q0 = ctx.query || {};
  const st = {
    mode: MODES.some(m => m[0] === q0.c) ? q0.c : 'theme',
    day: null, fmt: null, plan: q0.plan === '1', q: (q0.q || '').slice(0, 80), theme: null, sel: -1,
  };
  if (q0.d != null && q0.d !== '' && dayCount.has(+q0.d)) st.day = +q0.d;
  if (q0.f && DB.fmtIdx[q0.f] != null && fmtCount.has(DB.fmtIdx[q0.f])) st.fmt = DB.fmtIdx[q0.f];
  if (q0.theme && DB.themeIdx[q0.theme] != null && themeCount[DB.themeIdx[q0.theme]]) st.theme = DB.themeIdx[q0.theme];
  let missing = '';
  if (q0.it) {
    const it = DB.byId.get(q0.it);
    let p = it ? pointOf.get(it.i) : null;
    if (p == null && it) { const c = it.ch.find(ci => pointOf.has(ci)); if (c != null) p = pointOf.get(c); }
    if (p != null) st.sel = p; else missing = it ? 'That item has no place on the map' : 'That item was not found';
  }

  // -------------------------------------------------------------------- DOM
  el.innerHTML =
    '<div class="gx-root" data-mode="' + st.mode + '">' +
    '<canvas class="gx-canvas" role="img" aria-label="Map of ' + N + ' talks arranged by topic. Similar talks sit close together."></canvas>' +
    '<div class="floatbar gx-top">' +
    '<div class="hscroll gx-filters">' +
    '<div class="gx-search">' + icon('search') +
    '<input type="text" inputmode="search" enterkeyhint="search" placeholder="Search" aria-label="Search talks on the map" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="80">' +
    '<button type="button" class="gx-qx" data-act="gx-clear-q" aria-label="Clear search" hidden>' + icon('x') + '</button></div>' +
    '<span class="gx-chips"></span></div>' +
    '<div class="gx-row2"><div class="seg gx-seg" role="group" aria-label="Color the dots by">' +
    MODES.map(([id, label]) => '<button data-act="gx-mode" data-id="' + id + '" aria-pressed="' + (st.mode === id) + '"' + (st.mode === id ? ' class="on"' : '') + '>' + label + '</button>').join('') +
    '</div><span class="gx-count" aria-live="polite"></span></div>' +
    '</div>' +
    '<div class="gx-bottom"><div class="gx-hint" hidden></div><div class="gx-key hscroll" hidden></div>' +
    '<div class="gx-tools"></div><div class="gx-cardslot"></div></div>' +
    '</div>';
  const root = el.querySelector('.gx-root');
  const canvas = root.querySelector('.gx-canvas');
  const topEl = root.querySelector('.gx-top');
  const filtersEl = root.querySelector('.gx-filters');
  const segEl = root.querySelector('.gx-seg');
  const searchEl = root.querySelector('.gx-search');
  const input = searchEl.querySelector('input');
  const clearBtn = searchEl.querySelector('.gx-qx');
  const chipsEl = root.querySelector('.gx-chips');
  const countEl = root.querySelector('.gx-count');
  const bottomEl = root.querySelector('.gx-bottom');
  const hintEl = root.querySelector('.gx-hint');
  const keyEl = root.querySelector('.gx-key');
  const toolsEl = root.querySelector('.gx-tools');
  const cardEl = root.querySelector('.gx-cardslot');
  const c2d = canvas.getContext('2d', { alpha: false });
  input.value = st.q;

  // ------------------------------------------------------------ view state
  let W = 0, H = 0, dpr = 1, cw = 0, ch = 0;
  let dprCap = DPR_CAP, moved = false, prevMoved = false, lastTs = 0, slowN = 0;   // see pace()
  let insetTop = 96, insetBot = 92, insetSide = 0, short = false;
  let obst = [];                                                  // rectangles of the bottom controls, in canvas px
  let free = { x0: 0, y0: 96, x1: 1, y1: 1 };                     // the part of the canvas no control covers
  let T = d3.zoomIdentity;
  let dead = false, raf = 0, searchTimer = 0, resizeRaf = 0;
  let R0 = 2.1, nebR = 48, nebM = 60;
  let ox = 0, oy = 0, sx = 1, sy = 1;                             // layout units -> CSS px at zoom 1
  let layW = 0, layH = 0;                                         // canvas size the dots were placed for
  const bx = new Float32Array(N), by = new Float32Array(N);       // position in CSS px at zoom 1
  const px = new Float32Array(N), py = new Float32Array(N);       // position on screen this frame
  const pe = new Float32Array(N).fill(1);                         // entrance progress per dot
  const lit = new Uint8Array(N).fill(1);                          // passes the filters
  const selFlag = new Uint8Array(N);                              // 2 selected, 1 neighbor
  const inPlan = new Uint8Array(N);
  const msz = new Float32Array(N).fill(1), mal = new Float32Array(N).fill(1);   // size and brightness from the color mode
  const spr = new Uint8Array(N);                                  // cell of the dot's color in the sprite sheet
  const order = new Uint16Array(N); for (let i = 0; i < N; i++) order[i] = i;
  const tcx = new Float32Array(DB.themes.length), tcy = new Float32Array(DB.themes.length);
  let qt = null, qset = null, matchN = N, filtersOn = false, planN = 0;
  let scores = null, profEmpty = true;
  let neb = document.createElement('canvas'), nebDirty = true;
  let bgGrad = null, starPat = null, starTile = 256, starDpr = 0;
  let entering = false, entT0 = null, ecx = 0, ecy = 0, afterEnter = null;
  let pingT0 = -1;
  let myHash = location.hash;
  const stats = { frames: 0, last: 0, sum: 0, max: 0 };

  // ---------------------------------------------------------------- sprites
  const atlas = document.createElement('canvas'); atlas.width = ATLAS_W; atlas.height = ATLAS_H;
  const actx = atlas.getContext('2d');
  const slots = new Map();                                        // color -> cell number in the sprite sheet
  const glowX = new Float32Array(MAX_COLORS), glowY = new Float32Array(MAX_COLORS), coreX = new Float32Array(MAX_COLORS), coreY = new Float32Array(MAX_COLORS);
  function slotOf(color) {
    let n = slots.get(color);
    if (n != null) return n;
    if (slots.size >= MAX_COLORS) return 0;                       // sheet full (cannot happen with the bundled palettes): reuse the first color
    n = slots.size; slots.set(color, n);
    const c = d3.rgb(color);
    const rgba = a => 'rgba(' + Math.round(c.r) + ',' + Math.round(c.g) + ',' + Math.round(c.b) + ',' + a + ')';
    let x = (n % GLOW_COLS) * (GLOW_PX + CELL_GAP), y = Math.floor(n / GLOW_COLS) * (GLOW_PX + CELL_GAP), h = GLOW_PX / 2;
    let gr = actx.createRadialGradient(x + h, y + h, 0, x + h, y + h, h);
    gr.addColorStop(0, rgba(0.5)); gr.addColorStop(0.16, rgba(0.3)); gr.addColorStop(0.42, rgba(0.1)); gr.addColorStop(0.72, rgba(0.025)); gr.addColorStop(1, rgba(0));
    actx.fillStyle = gr; actx.fillRect(x, y, GLOW_PX, GLOW_PX);
    glowX[n] = x; glowY[n] = y;
    x = (n % CORE_COLS) * (CORE_PX + CELL_GAP); y = CORE_Y0 + Math.floor(n / CORE_COLS) * (CORE_PX + CELL_GAP); h = CORE_PX / 2;
    gr = actx.createRadialGradient(x + h, y + h, 0, x + h, y + h, h);
    gr.addColorStop(0, d3.interpolateRgb(color, '#ffffff')(0.72)); gr.addColorStop(0.36, d3.interpolateRgb(color, '#ffffff')(0.2));
    gr.addColorStop(CORE_SOLID - 0.1, rgba(1)); gr.addColorStop(CORE_SOLID + 0.06, rgba(0.6)); gr.addColorStop(1, rgba(0));
    actx.fillStyle = gr; actx.fillRect(x, y, CORE_PX, CORE_PX);
    coreX[n] = x; coreY[n] = y;
    return n;
  }

  // Text is drawn once into a small canvas (with its dark halo) and then blitted every frame.
  // Making one costs far more than drawing it, so only a few are made per frame (the rest follow on the next frames).
  const labels = new Map();
  const mctx = document.createElement('canvas').getContext('2d');
  let labelBudget = LABELS_PER_FRAME, labelsPending = false;
  function label(key, lines, size, weight, color, align) {
    let s = labels.get(key);
    if (s) return s;
    if (labelBudget <= 0) { labelsPending = true; return null; }
    labelBudget--;
    if (labels.size > 700) { labels.forEach(v => { v.c.width = v.c.height = 0; }); labels.clear(); }
    const font = weight + ' ' + size + 'px ' + FONT;
    mctx.font = font;
    const halo = LABEL_PAD, lh = Math.round(size * 1.22);
    let tw = 0; for (const l of lines) tw = Math.max(tw, mctx.measureText(l).width);
    const w = Math.ceil(tw) + halo * 2 + 2, h = lh * lines.length + halo * 2;
    const c = document.createElement('canvas'); c.width = Math.ceil(w * dpr); c.height = Math.ceil(h * dpr);
    const g = c.getContext('2d');
    g.scale(dpr, dpr); g.font = font; g.textBaseline = 'middle'; g.lineJoin = 'round';
    g.textAlign = align === 'center' ? 'center' : 'left';
    const x = align === 'center' ? w / 2 : halo + 1;
    // dark halo: a soft shadow plus a thin outline keeps the text readable over bright dots
    g.shadowColor = 'rgba(3, 5, 14, 0.95)'; g.shadowBlur = 4 * dpr;
    g.strokeStyle = 'rgba(4, 7, 18, 0.9)'; g.lineWidth = 3.2;
    lines.forEach((l, j) => g.strokeText(l, x, halo + lh * (j + 0.5)));
    g.shadowBlur = 0; g.shadowColor = 'transparent';
    g.fillStyle = color;
    lines.forEach((l, j) => g.fillText(l, x, halo + lh * (j + 0.5)));
    s = { c, w, h };
    labels.set(key, s);
    return s;
  }
  const themeLines = DB.themes.map(t => wrap2(t.n));
  const themeInk = DB.themes.map(t => d3.interpolateRgb(t.c, '#ffffff')(0.42));
  // Theme names are rendered once at their largest size and drawn a little smaller when zoomed out.
  const themeLabel = (t, themed) => label('t' + t + (themed ? 'c' : 'n'), themeLines[t], (rankOf[t] < 10 ? 12.5 : 11.5) * THEME_GROW, 650, themed ? themeInk[t] : '#C6CFEA', 'center');

  // ------------------------------------------------------------ color modes
  function ensureScores() {
    const prof = interestProfile();
    profEmpty = prof.empty;
    scores = new Float32Array(N);
    if (!profEmpty) for (let i = 0; i < N; i++) scores[i] = relevance(items[i], prof).score;
  }
  const meRamp = d3.interpolateRgbBasis(ME_STOPS);
  function applyMode() {
    const m = st.mode;
    if (m === 'me') ensureScores();
    for (let i = 0; i < N; i++) {
      const it = items[i];
      let c = NEUTRAL, s = 1, a = 1;
      if (m === 'theme') { if (themeOf[i] >= 0) c = DB.themes[themeOf[i]].c; else a = 0.75; }
      else if (m === 'format') c = DB.formats[it.f].c;
      else if (m === 'day') c = DAY_COLORS[it.day % DAY_COLORS.length];
      else if (profEmpty) { c = ME_IDLE; a = 0.8; }
      else {
        const v = scores[i];
        c = d3.rgb(meRamp(Math.round(v * (ME_STEPS - 1)) / (ME_STEPS - 1))).formatHex();
        s = 0.66 + 1.15 * v; a = 0.2 + 0.8 * Math.pow(v, 0.8);
      }
      spr[i] = slotOf(c); msz[i] = s; mal[i] = a;
    }
    // the best matches are drawn last so they sit on top
    const idx = Array.from({ length: N }, (_, i) => i);
    if (m === 'me' && !profEmpty) idx.sort((a, b) => scores[a] - scores[b] || a - b);
    else idx.sort((a, b) => bsz[a] - bsz[b] || a - b);
    order.set(idx);
    nebDirty = true;
    root.dataset.mode = m;
    renderKey();
  }

  function applyFilters() {
    const toks = tokens(st.q);
    qset = toks.length ? new Set(searchItems(st.q, { limit: 5000 }).map(r => r.it.i)) : null;
    let n = 0;
    for (let i = 0; i < N; i++) {
      const it = items[i];
      const ok = (st.day == null || it.day === st.day) && (st.fmt == null || it.f === st.fmt) &&
        (!qset || qset.has(it.i)) && (st.theme == null || themeOf[i] === st.theme);
      lit[i] = ok ? 1 : 0; n += ok ? 1 : 0;
    }
    matchN = n;
    filtersOn = st.day != null || st.fmt != null || !!qset || st.theme != null;
    nebDirty = true;
    countEl.innerHTML = filtersOn ? '<b>' + fmtN(n) + '</b> of ' + fmtN(N) : '<b>' + fmtN(N) + '</b> talks';
    countEl.setAttribute('aria-label', filtersOn ? n + ' of ' + N + ' talks match' : N + ' talks');
    root.dataset.count = String(n);
  }

  function readPlan() {
    planN = 0;
    for (let i = 0; i < N; i++) {
      const it = items[i];
      const on = Plan.has(it.id) || (it.par != null && DB.items[it.par] && Plan.has(DB.items[it.par].id));
      inPlan[i] = on ? 1 : 0; planN += on ? 1 : 0;
    }
  }

  // ----------------------------------------------------------------- layout
  /** Match the canvas to its box and to the screen's pixel density. */
  function sizeCanvas() {
    W = Math.max(1, root.clientWidth); H = Math.max(1, root.clientHeight);
    const newDpr = Math.min(window.devicePixelRatio || 1, dprCap);
    if (newDpr !== dpr) { dpr = newDpr; labels.forEach(v => { v.c.width = v.c.height = 0; }); labels.clear(); }
    cw = Math.round(W * dpr); ch = Math.round(H * dpr);
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
    zoom.extent([[0, 0], [W, H]]);
    // background: deep space with a faint lift in the middle
    bgGrad = c2d.createRadialGradient(cw * 0.5, ch * 0.44, 0, cw * 0.5, ch * 0.44, Math.max(cw, ch) * 0.72);
    bgGrad.addColorStop(0, '#10183A'); bgGrad.addColorStop(0.5, '#0A0F24'); bgGrad.addColorStop(1, '#060813');
    if (starDpr !== dpr) buildStars();
  }
  function measureInsets() {
    // On a short (landscape) screen the map uses the full height next to the mode control instead of the strip below it.
    short = H < 420;
    if (short) {
      const rc = root.getBoundingClientRect();
      insetTop = filtersEl.getBoundingClientRect().bottom - rc.top + 6;
      insetBot = 12;
      insetSide = segEl.getBoundingClientRect().right - rc.left + 12;
    } else {
      insetTop = topEl.offsetHeight - 8; insetBot = 92; insetSide = 0;
    }
  }
  /** Where the bottom controls are, so labels avoid them and "fit" and "reveal" aim at the free part of the canvas. */
  function measureBottom() {
    if (!W) return;
    const rc = root.getBoundingClientRect();
    const box = (e) => { const r = e.getBoundingClientRect(); return r.width && r.height ? [r.left - rc.left, r.top - rc.top, r.right - rc.left, r.bottom - rc.top] : null; };
    obst = [];
    const add = (e) => { const b = e && box(e); if (b) obst.push(b[0], b[1], b[2], b[3]); return b; };
    if (short) { add(segEl); add(countEl); }
    const nTop = obst.length;
    toolsEl.querySelectorAll('.gx-pill').forEach(add);
    const key = keyEl.hidden ? null : add(keyEl);
    const panel = add(cardEl.firstElementChild) || (hintEl.hidden ? null : add(hintEl));
    const tools = box(toolsEl);
    let x1 = W, y1 = H - 12;
    if (sideMq && sideMq.matches) {       // short landscape screen: the card sits at the right, the buttons at the left
      if (panel) x1 = panel[0] - 8;
      if (!short) y1 = key ? key[1] : tools ? tools[1] : y1;
    } else {
      for (let j = nTop + 1; j < obst.length; j += 4) y1 = Math.min(y1, obst[j]);
    }
    const x0 = Math.min(insetSide, W * 0.4);
    free = { x0, y0: insetTop, x1: Math.max(x0 + 100, x1), y1: Math.max(insetTop + 60, y1) };
  }
  /** Place every dot for the current canvas size (zoom 1 shows the whole map between the controls). */
  function layout() {
    sizeCanvas();
    measureInsets();
    layW = W; layH = H;
    const padX = Math.max(16, Math.min(W * 0.05, 40), Math.min(insetSide, W * 0.3)), padY = short ? 6 : 10;
    const availW = Math.max(60, W - padX * 2), availH = Math.max(60, H - insetTop - insetBot - padY * 2);
    // The layout has no meaningful axes, so it may stretch a little to fill a tall phone screen.
    sx = availW / 1000; sy = availH / 1000;
    const MAX_STRETCH = 1.45;
    if (sy > sx * MAX_STRETCH) sy = sx * MAX_STRETCH;
    if (sx > sy * MAX_STRETCH) sx = sy * MAX_STRETCH;
    ox = padX + (availW - 1000 * sx) / 2; oy = insetTop + padY + (availH - 1000 * sy) / 2;
    for (let i = 0; i < N; i++) { bx[i] = ox + lx[i] * sx; by[i] = oy + ly[i] * sy; }
    for (const t of themeRank) {
      tcx[t] = d3.median(themePts[t], i => bx[i]);
      tcy[t] = d3.median(themePts[t], i => by[i]);
    }
    const span = Math.min(1000 * sx, 1000 * sy);
    R0 = Math.max(1.7, Math.min(2.8, span / 180));
    nebR = Math.max(30, span * 0.13); nebM = Math.ceil(nebR + 8);
    qt = d3.quadtree().x(i => bx[i]).y(i => by[i]).addAll(d3.range(N));
    ecx = W / 2; ecy = insetTop + (H - insetTop - insetBot) / 2;
    zoom.translateExtent([[-W * 0.35, -H * 0.3], [W * 1.35, H * 1.3]]);
    nebDirty = true;
    measureBottom();
  }
  function buildStars() {
    starDpr = dpr;
    const S = 256, c = document.createElement('canvas');
    starTile = Math.round(S * dpr); c.width = c.height = starTile;
    const g = c.getContext('2d'); const r = rng(26);
    g.scale(starTile / S, starTile / S);
    for (let i = 0; i < 54; i++) {
      const x = 2 + r() * (S - 4), y = 2 + r() * (S - 4), rad = 0.35 + r() * r() * 0.95, a = 0.1 + r() * 0.42;
      g.fillStyle = 'rgba(' + Math.round(190 + r() * 65) + ',' + Math.round(205 + r() * 50) + ',255,' + a.toFixed(3) + ')';
      g.beginPath(); g.arc(x, y, rad, 0, 6.2832); g.fill();
    }
    starPat = c2d.createPattern(c, 'repeat');
  }
  // Soft color clouds: one big faint blob per lit dot, rendered once and then scaled with the zoom.
  function buildNebula() {
    nebDirty = false;
    const w = Math.ceil((layW + nebM * 2) * NEB_SCALE), h = Math.ceil((layH + nebM * 2) * NEB_SCALE);
    if (neb.width !== w || neb.height !== h) { neb.width = w; neb.height = h; }
    const g = neb.getContext('2d');
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    g.clearRect(0, 0, w, h);
    g.globalCompositeOperation = 'lighter';
    const R = nebR * NEB_SCALE, base = filtersOn ? 0.085 : 0.06;
    let last = -1;
    for (let i = 0; i < N; i++) {
      if (!lit[i]) continue;
      const a = base * mal[i];
      if (a !== last) g.globalAlpha = last = a;
      g.drawImage(atlas, glowX[spr[i]], glowY[spr[i]], GLOW_PX, GLOW_PX, (bx[i] + nebM) * NEB_SCALE - R, (by[i] + nebM) * NEB_SCALE - R, R * 2, R * 2);
    }
  }

  // ------------------------------------------------------------------- draw
  const rects = [];
  function isFree(x0, y0, x1, y1) {
    for (let j = 0; j < rects.length; j += 4) if (x0 < rects[j + 2] && x1 > rects[j] && y0 < rects[j + 3] && y1 > rects[j + 1]) return false;
    return true;
  }
  const dotR = (i, k) => R0 * Math.pow(k, 0.42) * bsz[i] * msz[i];

  function draw(ts) {
    const t0 = performance.now();
    const g = c2d, k = T.k, tx = T.x, ty = T.y;
    let entMs = -1;
    if (entering) {
      if (entT0 == null) entT0 = ts;
      entMs = ts - entT0;
      if (entMs >= ENT_TOTAL) { entering = false; entMs = -1; pe.fill(1); }
    }
    const fadeIn = entMs < 0 ? 1 : smooth((entMs - 220) / 520);      // clouds and labels arrive after the dots

    // background and star field (device pixels; the stars drift a little slower than the dots)
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    g.fillStyle = bgGrad; g.fillRect(0, 0, cw, ch);
    if (starPat) {
      const ox = Math.round(mod(tx * 0.14 * dpr, starTile)), oy = Math.round(mod(ty * 0.14 * dpr, starTile));
      g.translate(ox, oy); g.fillStyle = starPat; g.fillRect(-ox, -oy, cw, ch);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    // nebula
    if (nebDirty) buildNebula();
    const nebA = Math.pow(k, -0.5) * fadeIn;
    if (nebA > 0.02) {
      g.globalCompositeOperation = 'lighter'; g.globalAlpha = nebA;
      g.drawImage(neb, tx - nebM * k, ty - nebM * k, (layW + nebM * 2) * k, (layH + nebM * 2) * k);
    }

    // where every dot is on screen
    if (entMs < 0) {
      for (let i = 0; i < N; i++) { px[i] = bx[i] * k + tx; py[i] = by[i] * k + ty; }
    } else {
      for (let i = 0; i < N; i++) {
        const e = ease3(clamp01((entMs - delay[i]) / ENT_DOT));
        px[i] = ecx + (bx[i] * k + tx - ecx) * e; py[i] = ecy + (by[i] * k + ty - ecy) * e; pe[i] = e;
      }
    }
    const rk = R0 * Math.pow(k, 0.42);
    const selOn = st.sel >= 0;
    const coreK = 1 / CORE_SOLID;
    let last = -1, a = 0;

    // 1. filtered-out dots: small and faint, no glow
    if (filtersOn) {
      g.globalCompositeOperation = 'source-over';
      for (let j = 0; j < N; j++) {
        const i = order[j];
        if (lit[i] || selFlag[i]) continue;
        const x = px[i], y = py[i], h = rk * bsz[i] * 0.8 * coreK;
        if (x < -h || x > W + h || y < -h || y > H + h) continue;
        a = 0.17 * pe[i];
        if (a !== last) g.globalAlpha = last = a;
        g.drawImage(atlas, coreX[spr[i]], coreY[spr[i]], CORE_PX, CORE_PX, x - h, y - h, h * 2, h * 2);
      }
    }
    // 2. glows, added together
    g.globalCompositeOperation = 'lighter';
    for (let j = 0; j < N; j++) {
      const i = order[j];
      if (!lit[i] && !selFlag[i]) continue;
      const x = px[i], y = py[i], h = rk * bsz[i] * msz[i] * 4.3;
      if (x < -h || x > W + h || y < -h || y > H + h) continue;
      a = mal[i] * pe[i] * (selOn && !selFlag[i] ? 0.34 : 0.78);
      if (a !== last) g.globalAlpha = last = a;
      g.drawImage(atlas, glowX[spr[i]], glowY[spr[i]], GLOW_PX, GLOW_PX, x - h, y - h, h * 2, h * 2);
    }
    // 3. constellation lines from the selected dot to its most similar talks
    g.globalCompositeOperation = 'source-over';
    if (selOn) {
      const s = st.sel, nb = neigh[s];
      g.globalAlpha = 0.6 * pe[s]; g.lineWidth = 1; g.strokeStyle = '#C9D6FF';
      g.beginPath();
      for (const n of nb) { g.moveTo(px[s], py[s]); g.lineTo(px[n], py[n]); }
      g.stroke();
      last = -1;
    }
    // 4. cores
    for (let j = 0; j < N; j++) {
      const i = order[j];
      if (!lit[i] && !selFlag[i]) continue;
      const x = px[i], y = py[i], h = rk * bsz[i] * msz[i] * coreK;
      if (x < -h || x > W + h || y < -h || y > H + h) continue;
      a = Math.min(1, 0.3 + 0.7 * mal[i]) * pe[i] * (selOn && !selFlag[i] ? 0.6 : 1);
      if (a !== last) g.globalAlpha = last = a;
      g.drawImage(atlas, coreX[spr[i]], coreY[spr[i]], CORE_PX, CORE_PX, x - h, y - h, h * 2, h * 2);
    }
    // 5. rings: my plan, neighbors, selection
    if (st.plan && planN) {
      g.lineWidth = 1.5; g.strokeStyle = '#FACC15';
      for (let pass = 0; pass < 2; pass++) {
        g.globalAlpha = (pass ? 0.95 : 0.45) * fadeIn;
        g.beginPath();
        for (let i = 0; i < N; i++) {
          if (!inPlan[i] || (lit[i] ? 1 : 0) !== pass) continue;
          const x = px[i], y = py[i], r = rk * bsz[i] * msz[i] + 3.5;
          if (x < -r || x > W + r || y < -r || y > H + r) continue;
          g.moveTo(x + r, y); g.arc(x, y, r, 0, 6.2832);
        }
        g.stroke();
      }
    }
    if (selOn) {
      const s = st.sel;
      g.globalAlpha = 0.85; g.lineWidth = 1.2; g.strokeStyle = '#DCE6FF';
      g.beginPath();
      for (const n of neigh[s]) { const r = dotR(n, k) + 3.5; g.moveTo(px[n] + r, py[n]); g.arc(px[n], py[n], r, 0, 6.2832); }
      g.stroke();
      const r = Math.max(dotR(s, k) + 5.5, 9);
      g.globalAlpha = 0.55; g.lineWidth = 4.5; g.strokeStyle = '#050814';       // dark rim so the ring reads on bright clusters
      g.beginPath(); g.arc(px[s], py[s], r, 0, 6.2832); g.stroke();
      g.globalAlpha = 1; g.lineWidth = 2; g.strokeStyle = '#FFFFFF';
      g.beginPath(); g.arc(px[s], py[s], r, 0, 6.2832); g.stroke();
      if (pingT0 >= 0) {
        const p = Math.max(0, (ts - pingT0) / 520);
        if (p >= 1) pingT0 = -1;
        else { g.globalAlpha = (1 - p) * 0.7; g.lineWidth = 1.5; g.beginPath(); g.arc(px[s], py[s], r + ease3(p) * 24, 0, 6.2832); g.stroke(); }
      }
    }

    // 6. labels
    labelBudget = LABELS_PER_FRAME; labelsPending = false;
    if (fadeIn > 0.02) drawLabels(g, k, fadeIn);
    // spare budget prepares theme names that are not on screen yet, so zooming in never waits for them
    for (let r = 0; r < themeRank.length && labelBudget > 0; r++) themeLabel(themeRank[r], st.mode === 'theme');

    g.globalAlpha = 1;
    const ms = performance.now() - t0;
    stats.frames++; stats.last = ms; stats.sum += ms; if (ms > stats.max) stats.max = ms;
  }

  function drawLabels(g, k, fade) {
    rects.length = 0;
    for (let j = 0; j < obst.length; j += 4) rects.push(obst[j] - 5, obst[j + 1] - 5, obst[j + 2] + 5, obst[j + 3] + 5);
    const top = short ? insetTop + 12 : insetTop - 4, bot = H - 2;
    const themed = st.mode === 'theme';
    const selOn = st.sel >= 0;
    g.globalCompositeOperation = 'source-over';

    // theme names at the median of their dots: the biggest themes first, more as the user zooms in
    const maxThemes = k < 1.35 ? 12 : k < 2 ? 18 : k < 3 ? 26 : 99;
    const tf = (1 + (THEME_GROW - 1) * smooth((k - 1.6) / 4.4)) / THEME_GROW;      // drawn size of a theme sprite
    let waiting = false;                     // a sprite is not made yet: stop there so labels arrive in order, without flicker
    // keep the selected dot and its linked neighbors clear of text
    if (selOn) {
      const s = st.sel, r = Math.max(dotR(s, k) + 5.5, 9) + 2;
      rects.push(px[s] - r, py[s] - r, px[s] + r, py[s] + r);
      for (const n of neigh[s]) { const q = dotR(n, k) + 4; rects.push(px[n] - q, py[n] - q, px[n] + q, py[n] + q); }
    }
    const P = LABEL_PAD - 2;                 // labels may touch halos, never text
    const drawTheme = (t) => {
      const cx = tcx[t] * k + T.x, cy = tcy[t] * k + T.y;
      if (cx < -20 || cx > W + 20 || cy < top || cy > bot) return;
      const s = themeLabel(t, themed);
      if (!s) { waiting = true; return; }
      const w = s.w * tf, h = s.h * tf;
      let x0 = cx - w / 2;
      if (x0 < 2) x0 = 2; else if (x0 + w > W - 2) x0 = W - 2 - w;
      // at the median if that spot is free, otherwise just above or below it
      for (let v = 0; v < 3; v++) {
        const y0 = cy - h / 2 + (v === 1 ? -0.8 : v === 2 ? 0.8 : 0) * (h - LABEL_PAD);
        if (y0 < top || y0 + h > bot) continue;
        if (!isFree(x0 + P, y0 + P, x0 + w - P, y0 + h - P)) continue;
        rects.push(x0 + P, y0 + P, x0 + w - P, y0 + h - P);
        const quiet = st.theme != null && st.theme !== t;
        g.globalAlpha = fade * (quiet ? 0.3 : themed ? 0.96 : 0.62);
        g.drawImage(s.c, x0, y0, w, h);
        return;
      }
    };
    if (st.theme != null) drawTheme(st.theme);
    for (let r = 0; r < themeRank.length && r < maxThemes && !waiting; r++) {
      if (themeRank[r] !== st.theme) drawTheme(themeRank[r]);
    }
    if (waiting) return;

    // titles: neighbors of the selection first, then dots near the middle of the view
    const cands = [];
    if (selOn && k >= 2.2) for (const n of neigh[st.sel]) cands.push(n);
    const nFirst = cands.length;
    if (k >= TITLE_K) {
      const cxv = (free.x0 + free.x1) / 2, cyv = (free.y0 + free.y1) / 2, rx = (free.x1 - free.x0) * 0.47, ry = Math.max(60, (free.y1 - free.y0) * 0.48);
      const near = [];
      for (let i = 0; i < N; i++) {
        if ((!lit[i] && !selFlag[i]) || selFlag[i]) continue;
        const dx = (px[i] - cxv) / rx, dy = (py[i] - cyv) / ry;
        if (dx * dx + dy * dy < 1) near.push(i);
      }
      near.sort((p, q) => prio[q] - prio[p]);
      for (const i of near) cands.push(i);
    }
    if (!cands.length) return;
    const maxTitles = nFirst + (k >= 9 ? 18 : 13);
    let placed = 0;
    for (let j = 0; j < cands.length && placed < maxTitles; j++) {
      const i = cands[j], x = px[i], y = py[i];
      if (x < 0 || x > W || y < top + 8 || y > bot - 8) continue;
      const first = j < nFirst;
      const s = label('d' + i + (first ? 'w' : ''), [shortTitle(items[i].t, 32)], 11.5, first ? 620 : 540, first ? '#FFFFFF' : '#D3DBF3', 'left');
      if (!s) break;
      const r = dotR(i, k) + 1;                      // the sprite already has LABEL_PAD of air around the text
      const y0 = y - s.h / 2;
      let x0 = x + r;
      if (x0 + s.w > W - 2 || !isFree(x0 + P, y0 + P, x0 + s.w - P, y0 + s.h - P)) {
        x0 = x - r - s.w;
        if (x0 < 2 || !isFree(x0 + P, y0 + P, x0 + s.w - P, y0 + s.h - P)) continue;
      }
      rects.push(x0 + P, y0 + P, x0 + s.w - P, y0 + s.h - P);
      if (!selFlag[i]) { const q = dotR(i, k) + 1; rects.push(x - q, y - q, x + q, y + q); }   // do not write over a labeled dot
      g.globalAlpha = fade * (first ? 1 : 0.92);
      g.drawImage(s.c, x0, y0, s.w, s.h);
      placed++;
    }
  }

  /**
   * Safety net for slow phones: when panning or zooming stays under about 40 frames a second for a
   * while, the canvas drops to a lower pixel density (2.5 -> 1.75), and to 1.25 if it then still
   * stays under about 24. Fewer pixels to fill is the cheapest way to get the frame rate back.
   * It only ever steps down, and starts again from the full density the next time the screen opens.
   */
  function pace(dt, steady) {
    if (!steady || !(dt > 0 && dt < 250)) return;
    slowN = dt > (dprCap > 2 ? 25 : 42) ? slowN + 1 : Math.max(0, slowN - 2);
    if (slowN < 24 || dprCap < 1.3) return;
    slowN = 0;
    dprCap = dprCap > 2 ? 1.75 : 1.25;
    if (Math.min(window.devicePixelRatio || 1, dprCap) < dpr) { sizeCanvas(); requestDraw(); }
  }
  function frame(ts) {
    raf = 0;
    if (dead) return;
    const wasMoved = moved; moved = false;
    pace(ts - lastTs, wasMoved && prevMoved && !entering);
    prevMoved = wasMoved; lastTs = ts;
    draw(ts);
    if (entering || pingT0 >= 0 || labelsPending) requestDraw();
    if (!entering && afterEnter) { const fn = afterEnter; afterEnter = null; fn(); }
  }
  function requestDraw() { if (!raf && !dead) raf = requestAnimationFrame(frame); }

  // ------------------------------------------------------------------- zoom
  const zoom = d3.zoom().scaleExtent([K_MIN, K_MAX]).clickDistance(MOVE_PX).tapDistance(14).duration(reduce ? 0 : 250)
    .on('zoom', (ev) => { T = ev.transform; moved = true; requestDraw(); syncReset(); });
  const zsel = d3.select(canvas);
  const constrain = t => zoom.constrain()(t, [[0, 0], [W, H]], zoom.translateExtent());
  function flyTo(t, ms = 750) {
    t = constrain(t);
    zsel.interrupt();
    if (reduce || ms <= 0) zsel.call(zoom.transform, t);
    else zsel.transition().duration(ms).call(zoom.transform, t);
  }
  /** The transform that fits a set of dots between the controls. */
  function fitOf(ids, pad = 44) {
    let xs = ids.map(i => bx[i]).sort((a, b) => a - b), ys = ids.map(i => by[i]).sort((a, b) => a - b);
    const lo = ids.length >= 12 ? 0.06 : 0, hi = 1 - lo;     // ignore a few stragglers far from the cluster
    const x0 = d3.quantileSorted(xs, lo), x1 = d3.quantileSorted(xs, hi), y0 = d3.quantileSorted(ys, lo), y1 = d3.quantileSorted(ys, hi);
    const fw = Math.max(40, free.x1 - free.x0 - pad * 2), fh = Math.max(40, free.y1 - free.y0 - pad * 2);
    const k = Math.max(K_MIN, Math.min(K_MAX * 0.75, fw / Math.max(1, x1 - x0), fh / Math.max(1, y1 - y0)));
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    return d3.zoomIdentity.translate((free.x0 + free.x1) / 2 - cx * k, (free.y0 + free.y1) / 2 - cy * k).scale(k);
  }
  function centerOn(i, k) {
    return d3.zoomIdentity.translate((free.x0 + free.x1) / 2 - bx[i] * k, (free.y0 + free.y1) / 2 - by[i] * k).scale(k);
  }
  /** Nudge the view so the selected dot is not hidden behind the card or the controls. */
  function reveal(i) {
    measureBottom();
    const x = bx[i] * T.k + T.x, y = by[i] * T.k + T.y;
    const x0 = free.x0 + 28, x1 = Math.max(x0 + 10, free.x1 - 28), y0 = free.y0 + 22, y1 = Math.max(y0 + 10, free.y1 - 26);
    const dx = x < x0 ? x0 - x : x > x1 ? x1 - x : 0, dy = y < y0 ? y0 - y : y > y1 ? y1 - y : 0;
    if (dx || dy) flyTo(d3.zoomIdentity.translate(T.x + dx, T.y + dy).scale(T.k), 320);
  }
  const atHome = () => Math.abs(T.k - 1) < 0.01 && Math.abs(T.x) < 2 && Math.abs(T.y) < 2;
  let resetShown = null;
  function syncReset() {
    const show = !atHome() || st.theme != null;
    if (show === resetShown) return;
    resetShown = show;
    const b = toolsEl.querySelector('.gx-reset');
    if (b) { b.hidden = !show; measureBottom(); }
  }

  // ---------------------------------------------------------------- UI bits
  function renderChips() {
    const dayMode = st.mode === 'day';
    const f = st.fmt != null ? DB.formats[st.fmt] : null;
    let h = chip(f ? f.n : 'Format', { act: 'gx-format', icon: 'filter', on: !!f, color: f ? f.c : null }) +
      chip('My plan', { act: 'gx-plan', icon: 'star', on: st.plan, cls: 'gx-planchip' }) +
      '<span class="gx-sep"></span>' +
      chip('All days', { act: 'gx-day', id: '', on: st.day == null });
    for (const d of days) {
      const di = dayInfo(d);
      h += chip(di.dow + ' ' + di.date, { act: 'gx-day', id: d, on: st.day === d, color: dayMode ? DAY_COLORS[d % DAY_COLORS.length] : null });
    }
    chipsEl.innerHTML = h;
  }
  function renderKey() {
    const m = st.mode;
    let h = '';
    if (m === 'format') h = fmts.map(f => '<span><i style="--c:' + DB.formats[f].c + '"></i>' + esc(DB.formats[f].n) + '</span>').join('');
    else if (m === 'day') h = days.map(d => '<span><i style="--c:' + DAY_COLORS[d % DAY_COLORS.length] + '"></i>' + esc(dayInfo(d).label) + '</span>').join('');
    else if (m === 'me' && !profEmpty) h = '<span>Weaker match</span><span class="gx-ramp" style="background:linear-gradient(90deg,' + ME_STOPS.join(',') + ')"></span><span>Stronger match</span>';
    keyEl.innerHTML = h; keyEl.hidden = !h; keyEl.scrollLeft = 0;
    const needHint = m === 'me' && profEmpty;
    hintEl.innerHTML = needHint ? '<div><b>No interests saved yet</b><span>Pick your topics and matching talks light up.</span></div>' +
      '<button class="btn primary gx-hintbtn" data-go="#/builder">' + icon('wand') + 'Pick interests</button>' : '';
    syncHint();
  }
  function syncHint() {      // the hint steps aside while a talk card is open
    hintEl.hidden = !(st.mode === 'me' && profEmpty && st.sel < 0);
    measureBottom();
  }
  function renderTools() {
    const t = st.theme != null ? DB.themes[st.theme] : null;
    const dots = '<span class="gx-dots">' + themeRank.slice(0, 3).map(i => '<i style="background:' + DB.themes[i].c + '"></i>').join('') + '</span>';
    toolsEl.innerHTML =
      '<div class="gx-pill' + (t ? ' on' : '') + '"' + (t ? ' style="--c:' + t.c + '"' : '') + '>' +
      '<button class="gx-pill-main" data-act="gx-legend" aria-haspopup="dialog" aria-label="' + (t ? 'Theme: ' + esc(t.n) + '. Choose another theme' : 'Themes legend') + '">' +
      (t ? '<i class="gx-dot"></i><span>' + esc(t.n) + '</span>' : dots + '<span>Themes</span>') + '</button>' +
      (t ? '<button class="gx-pill-x" data-act="gx-theme-clear" aria-label="Show all themes">' + icon('x') + '</button>' : '') + '</div>' +
      '<button class="gx-pill gx-reset" data-act="gx-reset" aria-label="Reset the view" hidden>' + RESET_ICON + '<span>Reset</span></button>';
    resetShown = null; syncReset();
    measureBottom();
  }
  function renderCard() {
    if (st.sel < 0) { cardEl.innerHTML = ''; syncHint(); return; }
    const it = items[st.sel]; const r = roomOf(it); const nn = neigh[st.sel].length;
    const fresh = !cardEl.firstElementChild;       // slide in only when the card appears, not when hopping between talks
    cardEl.innerHTML =
      '<div class="overlay-card gx-card' + (fresh ? ' gx-new' : '') + '" style="--c:' + DB.formats[it.f].c + '">' +
      '<div class="gx-card-head"><div class="it-meta">' + fmtPill(it) + '<span class="time">' + esc(fmtWhen(it)) + '</span></div>' +
      '<button class="iconbtn gx-card-x" data-act="gx-deselect" aria-label="Close">' + icon('x') + '</button></div>' +
      '<div class="gx-card-title">' + esc(it.t) + '</div>' +
      (nn ? '<div class="gx-card-sim">Linked to ' + nn + ' similar ' + (nn === 1 ? 'talk' : 'talks') + '. Tap one to hop over.</div>' : '') +
      '<div class="gx-card-foot"><span class="gx-card-loc">' + (r ? icon('pin') + '<span>' + esc(r.n) + '</span>' : '') + '</span>' +
      starBtn(it) + '<button class="btn primary gx-open" data-go="#/item/' + esc(it.id) + '">Open' + icon('chevR') + '</button></div></div>';
    syncHint();
  }
  function sync() {
    setQuery({
      c: st.mode !== 'theme' ? st.mode : null,
      d: st.day, f: st.fmt != null ? DB.formats[st.fmt].id : null, plan: st.plan ? 1 : null,
      q: st.q.trim() || null,
      theme: st.theme != null ? DB.themes[st.theme].id : null,
      it: st.sel >= 0 ? items[st.sel].id : null,
    });
    myHash = location.hash;
  }

  // ---------------------------------------------------------------- actions
  function select(i, o = {}) {
    if (i === st.sel) { if (i >= 0 && !reduce) { pingT0 = performance.now(); requestDraw(); } return; }
    st.sel = i;
    selFlag.fill(0);
    if (i >= 0) {
      selFlag[i] = 2;
      for (const n of neigh[i]) selFlag[n] = 1;
      pingT0 = reduce ? -1 : performance.now();
    } else pingT0 = -1;
    renderCard();
    if (!o.silent) sync();
    requestDraw();
    if (i >= 0 && !o.stay) reveal(i);
  }
  function setTheme(t, fly) {
    st.theme = t;
    applyFilters(); renderTools(); sync(); requestDraw();
    if (t != null && fly) flyTo(fitOf(themePts[t]), 800);
  }
  function setMode(m) {
    if (m === st.mode || !MODES.some(x => x[0] === m)) return;
    st.mode = m;
    root.querySelectorAll('.gx-seg button').forEach(b => { const on = b.dataset.id === m; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
    applyMode(); renderChips(); sync(); requestDraw();
  }
  function setSearch(q) {
    st.q = q;
    searchEl.classList.toggle('has', !!q);
    clearBtn.hidden = !q;
    applyFilters(); sync(); requestDraw();
  }

  ctx.on('gx-mode', b => setMode(b.dataset.id));
  ctx.on('gx-day', (b) => {
    st.day = b.dataset.id === '' ? null : +b.dataset.id;
    applyFilters(); renderChips(); sync(); requestDraw();
  });
  ctx.on('gx-plan', () => {
    st.plan = !st.plan;
    readPlan(); renderChips(); sync(); requestDraw();
    if (st.plan) toast(planN ? planN + (planN === 1 ? ' talk' : ' talks') + ' from your plan ringed in gold' : 'Nothing from your plan is on the map yet. Star a talk to ring it.', 2600);
  });
  ctx.on('gx-format', () => {
    const row = (id, name, color, n, on) => '<button class="gx-opt' + (on ? ' on' : '') + '" data-act="gx-pick-format" data-id="' + esc(id) + '">' +
      '<i style="--c:' + color + '"></i><span>' + esc(name) + '</span><b>' + fmtN(n) + '</b></button>';
    openSheet('<div class="gx-list">' + row('', 'All formats', 'var(--tx3)', N, st.fmt == null) +
      fmts.map(f => row(DB.formats[f].id, DB.formats[f].n, DB.formats[f].c, fmtCount.get(f), st.fmt === f)).join('') + '</div>', { title: 'Format' });
  });
  ctx.on('gx-pick-format', (b) => {
    st.fmt = b.dataset.id === '' ? null : DB.fmtIdx[b.dataset.id];
    closeSheet();
    applyFilters(); renderChips(); sync(); requestDraw();
  });
  ctx.on('gx-legend', () => {
    const row = (id, name, color, n, on) => '<button class="gx-opt' + (on ? ' on' : '') + '" data-act="gx-pick-theme" data-id="' + esc(id) + '">' +
      '<i style="--c:' + color + '"></i><span>' + esc(name) + '</span><b>' + fmtN(n) + '</b></button>';
    openSheet('<p class="note gx-sheetnote">Each dot takes the color of its main theme. Pick a theme to light it up and fly to it.</p>' +
      '<div class="gx-list">' + row('', 'All themes', 'var(--tx3)', N, st.theme == null) +
      themeRank.map(t => row(DB.themes[t].id, DB.themes[t].n, DB.themes[t].c, themeCount[t], st.theme === t)).join('') + '</div>', { title: 'Themes', tall: true });
  });
  ctx.on('gx-pick-theme', (b) => {
    closeSheet();
    setTheme(b.dataset.id === '' ? null : DB.themeIdx[b.dataset.id], true);
  });
  ctx.on('gx-theme-clear', () => setTheme(null, false));
  ctx.on('gx-reset', () => {
    st.theme = null;
    select(-1, { silent: true });
    applyFilters(); renderTools(); sync(); requestDraw();
    flyTo(d3.zoomIdentity, 650);
  });
  ctx.on('gx-clear-q', () => { input.value = ''; clearTimeout(searchTimer); setSearch(''); });
  ctx.on('gx-deselect', () => select(-1));

  const onInput = () => {
    clearTimeout(searchTimer);
    const v = input.value;
    searchEl.classList.toggle('has', !!v); clearBtn.hidden = !v;
    searchTimer = setTimeout(() => { if (!dead) setSearch(v); }, 160);
  };
  const onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } };
  const onSearchClick = (e) => { if (e.target !== input && !e.target.closest('.gx-qx')) input.focus(); };
  input.addEventListener('input', onInput);
  input.addEventListener('keydown', onKey);
  searchEl.addEventListener('click', onSearchClick);

  // ------------------------------------------------- tap versus pan on canvas
  let down = null, touches = 0;
  function onTap(clientX, clientY) {
    const rc = canvas.getBoundingClientRect();
    const wx = (clientX - rc.left - T.x) / T.k, wy = (clientY - rc.top - T.y) / T.k, rad = TAP_PX / T.k;
    let hit = qt.find(wx, wy, rad);
    if (hit != null && filtersOn && !lit[hit] && !selFlag[hit]) {
      // a lit dot or a linked neighbor within reach wins over a dimmed one
      let best = -1, bd = rad * rad;
      for (let i = 0; i < N; i++) {
        if (!lit[i] && !selFlag[i]) continue;
        const dx = bx[i] - wx, dy = by[i] - wy, d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = i; }
      }
      if (best >= 0) hit = best;
    }
    select(hit == null ? -1 : hit);
  }
  const onDown = (e) => {
    if (document.activeElement === input) input.blur();      // touching the map puts the keyboard away
    if (e.isPrimary) touches = 0;
    touches++;
    down = touches === 1 && (e.pointerType !== 'mouse' || e.button === 0) ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp } : null;
  };
  const onMove = (e) => {
    if (down && e.pointerId === down.id && Math.hypot(e.clientX - down.x, e.clientY - down.y) > MOVE_PX) down = null;
  };
  const onUp = (e) => {
    touches = Math.max(0, touches - 1);
    if (!down || e.pointerId !== down.id) return;
    const ok = e.type === 'pointerup' && Math.hypot(e.clientX - down.x, e.clientY - down.y) <= MOVE_PX && e.timeStamp - down.t < 700;
    down = null;
    if (ok) onTap(e.clientX, e.clientY);
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  // ---------------------------------------------------------- resize, events
  function relayout() {
    if (dead) return;
    const w = Math.max(1, root.clientWidth), h = Math.max(1, root.clientHeight);
    // The on-screen keyboard only makes the view shorter for a moment. Keep the map where it is
    // instead of squeezing it: resize the canvas and leave the dots alone.
    if (w === layW && (h === layH || (h < layH && document.activeElement === input))) {
      sizeCanvas(); measureBottom(); requestDraw();
      return;
    }
    const oW = W, oH = H, k = T.k;
    // remember which spot of the map is in the middle of the screen, in layout units
    const mx = ((oW / 2 - T.x) / k - ox) / sx, my = ((oH / 2 - T.y) / k - oy) / sy;
    layout();
    const t = k > 1.01 ? d3.zoomIdentity.translate(W / 2 - (ox + mx * sx) * k, H / 2 - (oy + my * sy) * k).scale(k) : d3.zoomIdentity;
    zsel.interrupt().call(zoom.transform, constrain(t));
    requestDraw();
  }
  const onResize = () => {
    if (resizeRaf || dead) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      if (dead) return;
      const w = Math.max(1, root.clientWidth), h = Math.max(1, root.clientHeight), d = Math.min(window.devicePixelRatio || 1, dprCap);
      if (w !== W || h !== H || d !== dpr) relayout();
      else { measureBottom(); requestDraw(); }
    });
  };
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
  if (ro) { ro.observe(root); ro.observe(bottomEl); }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  const onMotion = () => { reduce = !!reduceMq.matches; zoom.duration(reduce ? 0 : 250); };
  if (reduceMq && reduceMq.addEventListener) reduceMq.addEventListener('change', onMotion);
  const offPlan = bus.on('plan', () => { readPlan(); requestDraw(); });
  const offInterests = bus.on('interests', () => { if (st.mode === 'me') { applyMode(); requestDraw(); } });

  // ------------------------------------------------------------------ start
  readPlan();
  renderChips(); renderTools(); renderCard();
  searchEl.classList.toggle('has', !!st.q); clearBtn.hidden = !st.q;
  if (st.sel >= 0) { selFlag[st.sel] = 2; for (const n of neigh[st.sel]) selFlag[n] = 1; }
  applyMode();
  applyFilters();
  layout();
  zsel.call(zoom);
  if (st.day != null) {
    const on = chipsEl.querySelector('.chip.on[data-act="gx-day"]');
    if (on) filtersEl.scrollLeft = Math.max(0, on.offsetLeft - (filtersEl.clientWidth - on.offsetWidth) / 2);
  }
  if (missing) toast(missing);

  // entrance stagger: dots near the middle leave first
  {
    let far = 1;
    for (let i = 0; i < N; i++) far = Math.max(far, Math.hypot(bx[i] - ecx, by[i] - ecy));
    for (let i = 0; i < N; i++) delay[i] = (Math.hypot(bx[i] - ecx, by[i] - ecy) / far) * ENT_STAGGER * (0.75 + 0.25 * rand());
  }
  const target = () => (st.theme != null ? fitOf(themePts[st.theme]) : st.sel >= 0 ? centerOn(st.sel, Math.min(K_MAX, 5.5)) : null);
  const back = ctx.isBack && memo && memo.hash === location.hash && memo.W === W && memo.H === H;
  if (back) {
    zsel.call(zoom.transform, constrain(d3.zoomIdentity.translate(memo.x, memo.y).scale(memo.k)));
  } else if (reduce || ctx.isBack) {
    const t = target();
    if (t) zsel.call(zoom.transform, constrain(t));
  } else {
    entering = true; entT0 = null;
    afterEnter = () => { const t = target(); if (t && !dead) flyTo(t, 850); };
  }
  memo = null;
  root.dataset.ready = '1';
  document.body.classList.add('gx-on');      // galaxy.css moves the shared toast up so it never covers the talk card
  requestDraw();

  // A small handle for automated tests and debugging.
  root.__gx = {
    zoom, canvas, count: N,
    transform: () => ({ k: T.k, x: T.x, y: T.y }),
    state: () => ({
      mode: st.mode, day: st.day, fmt: st.fmt != null ? DB.formats[st.fmt].id : null, plan: st.plan, q: st.q,
      theme: st.theme != null ? DB.themes[st.theme].id : null, sel: st.sel >= 0 ? items[st.sel].id : null,
      match: matchN, total: N, entering, busy: entering || !!afterEnter, planRings: planN, width: W, height: H, dpr,
    }),
    /** Viewport coordinates of an item's dot, or null. */
    screenOf: (id) => {
      const it = DB.byId.get(id); const p = it ? pointOf.get(it.i) : null;
      if (p == null) return null;
      const rc = canvas.getBoundingClientRect();
      return [rc.left + bx[p] * T.k + T.x, rc.top + by[p] * T.k + T.y];
    },
    ids: () => items.map(it => it.id),
    litIds: () => items.filter((it, i) => lit[i]).map(it => it.id),
    neighborsOf: (id) => { const it = DB.byId.get(id); const p = it ? pointOf.get(it.i) : null; return p == null ? [] : neigh[p].map(n => items[n].id); },
    setTransform: (k, x, y) => zsel.interrupt().call(zoom.transform, d3.zoomIdentity.translate(x, y).scale(k)),
    drawNow: () => { draw(performance.now()); return stats.last; },
    stats: () => ({ frames: stats.frames, last: stats.last, avg: stats.frames ? stats.sum / stats.frames : 0, max: stats.max }),
    resetStats: () => { stats.frames = 0; stats.sum = 0; stats.max = 0; },
    /** Pretend n frames of steady panning took dt ms each (to test the slow-phone safety net). */
    feedFrames: (dt, n) => { for (let i = 0; i < n; i++) pace(dt, true); return dpr; },
  };

  return () => {
    dead = true;
    memo = { hash: myHash, k: T.k, x: T.x, y: T.y, W, H };
    if (raf) cancelAnimationFrame(raf);
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    raf = 0; resizeRaf = 0; afterEnter = null;
    clearTimeout(searchTimer);
    zsel.interrupt().on('.zoom', null);
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
    input.removeEventListener('input', onInput);
    input.removeEventListener('keydown', onKey);
    searchEl.removeEventListener('click', onSearchClick);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('orientationchange', onResize);
    if (reduceMq && reduceMq.removeEventListener) reduceMq.removeEventListener('change', onMotion);
    if (ro) ro.disconnect();
    offPlan(); offInterests();
    document.body.classList.remove('gx-on');
    root.__gx = null;
    // release the off-screen canvases right away
    labels.forEach(s => { s.c.width = s.c.height = 0; });
    labels.clear(); slots.clear();
    atlas.width = atlas.height = 0; neb.width = neb.height = 0;
  };
}

registerView('galaxy', { title: 'Topic galaxy', tab: 'explore', full: true, render: mount });
