// SC26 Atlas: where contributors come from.
//   #/globe                 canvas globe (countries shaded by contributors, arcs to Chicago) + ranked country list
//   #/globe?c=<countryIdx>  same, with one country selected; &scale=log switches the list bars to a log scale
//   #/country/<countryIdx>  one country: totals, themes, organizations, people, program items
import { DB, flagOf, visible } from '../core.js';
import { registerView, setQuery } from '../router.js';
import { esc, icon, section, statTile, orgRow, personRow, itemCard, lazyList, emptyState } from '../ui.js';

const CHICAGO = [-87.65, 41.85];
const RAD = Math.PI / 180;
const DPR_CAP = 2.5;
const ZOOM_MIN = 1, ZOOM_MAX = 2.2;
const SPIN = 5;                 // auto-rotation, degrees per second
const TILT = -24;               // resting tilt of the auto-rotating globe
const NUM = n => Number(n).toLocaleString('en-US');

// Dim cyan for one contributor, bright violet for the largest country (log scale).
const RAMP = ['#14586B', '#0E86A6', '#1C9CCB', '#6A94F4', '#A584FA', '#D9B0FF'];
const ramp = d3.scaleLinear().domain(RAMP.map((_, i) => i / (RAMP.length - 1))).range(RAMP).interpolate(d3.interpolateRgb).clamp(true);
const STEPS = 11;               // the ramp is quantized so countries can be drawn in a few batches

const npOf = c => c.people.length;
const hasPos = c => c.lat != null && c.lon != null;

let STATS = null;
function geoStats() {
  if (STATS) return STATS;
  const list = DB.countries.filter(c => npOf(c) > 0).sort((a, b) => npOf(b) - npOf(a) || a.name.localeCompare(b.name));
  const known = d3.sum(list, npOf);
  const max = list.length ? npOf(list[0]) : 1;
  const stepOf = c => (max > 1 ? Math.round(Math.log(npOf(c)) / Math.log(max) * STEPS) : STEPS);
  STATS = {
    list, known, max, unknown: DB.people.length - known,
    rank: new Map(list.map((c, i) => [c.i, i + 1])),
    stepOf, colorOf: c => ramp(stepOf(c) / STEPS),
  };
  return STATS;
}
function share(n, total) {
  if (!total) return '';
  const v = n / total * 100;
  return v >= 10 ? Math.round(v) + '%' : v >= 0.1 ? v.toFixed(1) + '%' : '<0.1%';
}

let worldP = null;
function loadWorld() {
  if (!worldP) {
    worldP = fetch('data/world-110m.json')
      .then(r => { if (!r.ok) throw new Error('world map: HTTP ' + r.status); return r.json(); })
      .then(topo => topojson.feature(topo, topo.objects.countries).features)
      .catch(e => { worldP = null; throw e; });
  }
  return worldP;
}

// ------------------------------------------------------------------ globe
// Two stacked canvases: the base (sphere, countries) is redrawn only when the
// rotation, zoom or size changes; the overlay (arcs, moving lights, selection)
// is cheap and animates every frame while the globe is on screen.
function createGlobe(stage, feats, G, cb) {
  const base = stage.querySelector('.geo-globe'), fx = stage.querySelector('.geo-fx');
  const bctx = base.getContext('2d'), fctx = fx.getContext('2d');
  const proj = d3.geoOrthographic().clipAngle(90).precision(0.7);
  const bpath = d3.geoPath(proj, bctx), fpath = d3.geoPath(proj, fctx);
  const graticule = d3.geoGraticule().step([20, 20]).precision(4)();
  const reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // --- static geometry, grouped by fill color
  const byNum = new Map(G.list.filter(c => c.num != null).map(c => [String(c.num), c]));
  const featOf = new Map();
  const rest = { type: 'GeometryCollection', geometries: [] };
  const groupMap = new Map();
  for (const f of feats) {
    const c = f.id != null ? byNum.get(String(f.id)) : null;
    if (!c || !f.geometry) { if (f.geometry) rest.geometries.push(f.geometry); continue; }
    if (!featOf.has(c.i)) featOf.set(c.i, f);
    const s = G.stepOf(c);
    if (!groupMap.has(s)) groupMap.set(s, { color: ramp(s / STEPS), geo: { type: 'GeometryCollection', geometries: [] } });
    groupMap.get(s).geo.geometries.push(f.geometry);
  }
  const groups = Array.from(groupMap.values());
  const placed = G.list.filter(hasPos);
  const dots = placed.filter(c => !featOf.has(c.i));      // places the 110m map has no shape for

  // --- arcs to Chicago, sampled once as 3-D points lifted off the surface
  const arcs = placed.map((c, k) => {
    const from = [c.lon, c.lat], dist = d3.geoDistance(from, CHICAGO);
    const ip = d3.geoInterpolate(from, CHICAGO);
    const n = Math.max(6, Math.ceil(dist / (4 * RAD)));
    const p = new Float32Array((n + 1) * 3);
    const lift = Math.min(0.13, dist * 0.085);
    for (let i = 0; i <= n; i++) {
      const t = i / n, ll = ip(t), h = 1 + lift * Math.sin(Math.PI * t);
      const la = ll[1] * RAD, lo = ll[0] * RAD;
      p[i * 3] = Math.cos(la) * Math.cos(lo) * h; p[i * 3 + 1] = Math.cos(la) * Math.sin(lo) * h; p[i * 3 + 2] = Math.sin(la) * h;
    }
    return { c, n, p, s: new Float32Array((n + 1) * 2), v: new Uint8Array(n + 1), dur: 1500 + 2600 * dist / Math.PI, off: (k * 617) % 4100 };
  });

  // --- state
  let W = 0, H = 0, dpr = 1, cx = 0, cy = 0, R0 = 100;
  let zoom = 1;
  const rot = [62, TILT, 0];
  let baseDirty = true, raf = 0, dead = false, onscreen = true;
  let anim = null, vel = null, idleUntil = 0, lastSpin = 0, lastT = 0;
  let sel = null, selFeat = null;
  const ptrs = new Map();
  let gesture = null;            // { moved, pinch, d0, z0, t0 }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const wrap = d => ((d + 180) % 360 + 360) % 360 - 180;

  function size() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    W = w; H = h; dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    for (const c of [base, fx]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    cx = W / 2; cy = H / 2;
    R0 = Math.max(60, Math.min(W / 2 - 16, H / 2 - 20));
    proj.translate([cx, cy]);
    baseDirty = true; kick();
  }

  function drawBase() {
    const c = bctx, R = R0 * zoom;
    proj.scale(R).rotate(rot);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    // atmosphere
    let g = c.createRadialGradient(cx, cy, R * 0.96, cx, cy, R * 1.2);
    g.addColorStop(0, 'rgba(56, 189, 248, .42)'); g.addColorStop(0.3, 'rgba(129, 140, 248, .2)'); g.addColorStop(1, 'rgba(129, 140, 248, 0)');
    c.fillStyle = g; c.beginPath(); c.arc(cx, cy, R * 1.2, 0, 2 * Math.PI); c.fill();
    // ocean
    g = c.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.05, cx, cy, R);
    g.addColorStop(0, '#18265A'); g.addColorStop(0.55, '#0D1638'); g.addColorStop(1, '#070B20');
    c.fillStyle = g; c.beginPath(); c.arc(cx, cy, R, 0, 2 * Math.PI); c.fill();
    // graticule
    c.beginPath(); bpath(graticule); c.strokeStyle = 'rgba(148, 163, 255, .11)'; c.lineWidth = 0.6; c.stroke();
    // land without contributors, then one batch per shade
    c.lineJoin = 'round'; c.lineWidth = 0.6; c.strokeStyle = 'rgba(7, 11, 32, .85)';
    c.beginPath(); bpath(rest); c.fillStyle = '#1D2854'; c.fill(); c.stroke();
    for (const grp of groups) { c.beginPath(); bpath(grp.geo); c.fillStyle = grp.color; c.fill(); c.stroke(); }
    // small places as dots
    const center = [-rot[0], -rot[1]];
    for (const d of dots) {
      if (d3.geoDistance([d.lon, d.lat], center) > Math.PI / 2 - 0.03) continue;
      const p = proj([d.lon, d.lat]);
      c.beginPath(); c.arc(p[0], p[1], 3.2, 0, 2 * Math.PI);
      c.fillStyle = G.colorOf(d); c.fill(); c.lineWidth = 1.2; c.strokeStyle = '#070B20'; c.stroke();
    }
    // shade toward the limb, then a thin rim
    g = c.createRadialGradient(cx, cy, R * 0.7, cx, cy, R);
    g.addColorStop(0, 'rgba(4, 7, 20, 0)'); g.addColorStop(1, 'rgba(4, 7, 20, .5)');
    c.beginPath(); c.arc(cx, cy, R, 0, 2 * Math.PI); c.fillStyle = g; c.fill();
    c.lineWidth = 1; c.strokeStyle = 'rgba(125, 211, 252, .4)'; c.stroke();
  }

  function drawFx(now) {
    const c = fctx, R = R0 * zoom;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    // same rotation as d3.geoOrthographic().rotate([lambda, phi]): screen x = y', screen y = -z', depth = x'
    const dl = rot[0] * RAD, dp = rot[1] * RAD;
    const cl = Math.cos(dl), sl = Math.sin(dl), cp = Math.cos(dp), sp = Math.sin(dp);
    let selArc = null;
    c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath();
    for (const a of arcs) {
      let pen = false;
      if (sel && a.c === sel) selArc = a;
      for (let i = 0; i <= a.n; i++) {
        const gx = a.p[i * 3], gy = a.p[i * 3 + 1], gz = a.p[i * 3 + 2];
        const x = gx * cl - gy * sl, y = gx * sl + gy * cl;
        const X = x * cp - gz * sp, Z = gz * cp + x * sp;
        const vis = X >= 0 || y * y + Z * Z > 1;
        const sx = cx + R * y, sy = cy - R * Z;
        a.s[i * 2] = sx; a.s[i * 2 + 1] = sy; a.v[i] = vis ? 1 : 0;
        if (vis) { if (pen) c.lineTo(sx, sy); else c.moveTo(sx, sy); pen = true; } else pen = false;
      }
    }
    c.strokeStyle = sel ? 'rgba(125, 211, 252, .16)' : 'rgba(125, 211, 252, .3)'; c.lineWidth = 1; c.stroke();
    if (selArc) {
      c.beginPath(); let pen = false;
      for (let i = 0; i <= selArc.n; i++) {
        if (selArc.v[i]) { if (pen) c.lineTo(selArc.s[i * 2], selArc.s[i * 2 + 1]); else c.moveTo(selArc.s[i * 2], selArc.s[i * 2 + 1]); pen = true; } else pen = false;
      }
      c.strokeStyle = 'rgba(240, 249, 255, .95)'; c.lineWidth = 1.8; c.stroke();
    }
    // moving lights: a short bright tail and a head per arc
    const heads = [];
    c.beginPath();
    for (const a of arcs) {
      const t = reduced ? 0.5 : ((now + a.off) % (a.dur + 900)) / a.dur;
      if (t > 1) continue;
      const f = t * a.n, i1 = Math.min(a.n - 1, Math.floor(f)), u = f - i1;
      if (!a.v[i1] || !a.v[i1 + 1]) continue;
      const hx = a.s[i1 * 2] + (a.s[i1 * 2 + 2] - a.s[i1 * 2]) * u, hy = a.s[i1 * 2 + 1] + (a.s[i1 * 2 + 3] - a.s[i1 * 2 + 1]) * u;
      const f0 = Math.max(0, t - 0.09) * a.n, i0 = Math.floor(f0), u0 = f0 - i0;
      if (a.v[i0] && a.v[Math.min(a.n, i0 + 1)]) {
        const j = Math.min(a.n, i0 + 1);
        c.moveTo(a.s[i0 * 2] + (a.s[j * 2] - a.s[i0 * 2]) * u0, a.s[i0 * 2 + 1] + (a.s[j * 2 + 1] - a.s[i0 * 2 + 1]) * u0);
        for (let i = i0 + 1; i <= i1; i++) if (a.v[i]) c.lineTo(a.s[i * 2], a.s[i * 2 + 1]);
        c.lineTo(hx, hy);
      }
      heads.push(hx, hy);
    }
    c.strokeStyle = 'rgba(165, 243, 252, .85)'; c.lineWidth = 1.5; c.stroke();
    c.beginPath();
    for (let i = 0; i < heads.length; i += 2) { c.moveTo(heads[i] + 4.5, heads[i + 1]); c.arc(heads[i], heads[i + 1], 4.5, 0, 2 * Math.PI); }
    c.fillStyle = 'rgba(165, 243, 252, .22)'; c.fill();
    c.beginPath();
    for (let i = 0; i < heads.length; i += 2) { c.moveTo(heads[i] + 1.7, heads[i + 1]); c.arc(heads[i], heads[i + 1], 1.7, 0, 2 * Math.PI); }
    c.fillStyle = '#F0FDFF'; c.fill();

    // selected country: outline (or ring for dot places) and a soft pulse at its center
    const pulse = reduced ? 0.4 : (now % 1800) / 1800;
    if (sel) {
      if (selFeat) {
        proj.scale(R).rotate(rot);
        c.beginPath(); fpath(selFeat); c.strokeStyle = '#FFFFFF'; c.lineWidth = 1.7; c.stroke();
      }
      const q = hasPos(sel) ? spot(sel.lon, sel.lat, cl, sl, cp, sp, R) : null;
      if (q) {
        if (!selFeat) { c.beginPath(); c.arc(q[0], q[1], 6.5, 0, 2 * Math.PI); c.strokeStyle = '#FFFFFF'; c.lineWidth = 1.7; c.stroke(); }
        c.beginPath(); c.arc(q[0], q[1], 8 + 16 * pulse, 0, 2 * Math.PI);
        c.strokeStyle = 'rgba(255, 255, 255, ' + (0.55 * (1 - pulse)).toFixed(3) + ')'; c.lineWidth = 1.4; c.stroke();
      }
    }
    // Chicago
    const ch = spot(CHICAGO[0], CHICAGO[1], cl, sl, cp, sp, R);
    if (ch) {
      const k = (pulse + 0.5) % 1;
      c.beginPath(); c.arc(ch[0], ch[1], 4 + 9 * k, 0, 2 * Math.PI);
      c.strokeStyle = 'rgba(250, 204, 21, ' + (0.7 * (1 - k)).toFixed(3) + ')'; c.lineWidth = 1.3; c.stroke();
      c.beginPath(); c.arc(ch[0], ch[1], 3.4, 0, 2 * Math.PI); c.fillStyle = '#FACC15'; c.fill();
      c.lineWidth = 1.2; c.strokeStyle = '#070B20'; c.stroke();
      c.font = '600 11px system-ui, -apple-system, Roboto, sans-serif'; c.textBaseline = 'middle';
      c.lineWidth = 3; c.strokeStyle = 'rgba(7, 11, 32, .8)'; c.strokeText('Chicago', ch[0] + 8, ch[1] - 9);
      c.fillStyle = '#FDE68A'; c.fillText('Chicago', ch[0] + 8, ch[1] - 9);
    }
  }
  /** Screen position of a surface point, or null when it is on the far side. */
  function spot(lon, lat, cl, sl, cp, sp, R) {
    const la = lat * RAD, lo = lon * RAD;
    const gx = Math.cos(la) * Math.cos(lo), gy = Math.cos(la) * Math.sin(lo), gz = Math.sin(la);
    const x = gx * cl - gy * sl, y = gx * sl + gy * cl;
    const X = x * cp - gz * sp, Z = gz * cp + x * sp;
    return X > 0.02 ? [cx + R * y, cy - R * Z] : null;
  }

  function frame(now) {
    raf = 0;
    if (dead) return;
    const dt = Math.min(80, now - (lastT || now)); lastT = now;
    if (anim) {
      const k = Math.min(1, (now - anim.t0) / anim.ms), e = d3.easeCubicInOut(k);
      rot[0] = anim.from[0] + anim.d[0] * e; rot[1] = anim.from[1] + anim.d[1] * e;
      baseDirty = true;
      if (k >= 1) { anim = null; rot[0] = wrap(rot[0]); }
    } else if (vel) {
      rot[0] += vel[0] * dt; rot[1] = clamp(rot[1] + vel[1] * dt, -80, 80);
      const f = Math.pow(0.93, dt / 16); vel[0] *= f; vel[1] *= f;
      baseDirty = true;
      if (Math.abs(vel[0]) + Math.abs(vel[1]) < 0.004) vel = null;
    } else if (!reduced && !sel && !ptrs.size && now >= idleUntil) {
      // idle spin: the base only needs about 30 redraws a second
      if (!lastSpin || now - lastSpin > 250) lastSpin = now - 32;
      if (now - lastSpin >= 30) {
        const d = (now - lastSpin) / 1000; lastSpin = now;
        rot[0] = wrap(rot[0] + SPIN * d);
        rot[1] += (TILT - rot[1]) * Math.min(1, d * 0.9);
        baseDirty = true;
      }
    }
    if (baseDirty) { baseDirty = false; drawBase(); }
    drawFx(now);
    kick();
  }
  function kick() {
    if (!raf && !dead && onscreen && !document.hidden && W) raf = requestAnimationFrame(frame);
  }

  // --- picking
  function pick(x, y) {
    const R = R0 * zoom;
    if (Math.hypot(x - cx, y - cy) > R) return;
    proj.scale(R).rotate(rot);
    const ll = proj.invert([x, y]);
    if (!ll || !isFinite(ll[0]) || !isFinite(ll[1])) return;
    const center = [-rot[0], -rot[1]];
    // 1. dot places are tiny, so a tap close to one wins
    let best = null, bd = 16;
    for (const d of dots) {
      if (d3.geoDistance([d.lon, d.lat], center) > Math.PI / 2 - 0.03) continue;
      const p = proj([d.lon, d.lat]), dist = Math.hypot(p[0] - x, p[1] - y);
      if (dist < bd) { bd = dist; best = d; }
    }
    if (best) { cb.select(best); return; }
    // 2. the country under the finger
    let hit = null;
    for (const f of feats) { if (f.geometry && d3.geoContains(f, ll)) { hit = f; break; } }
    const c = hit && hit.id != null ? byNum.get(String(hit.id)) : null;
    if (c) { cb.select(c); return; }
    // 3. otherwise the nearest known country center, if it is close
    let near = null, nd = Infinity;
    for (const p of placed) { const d = d3.geoDistance(ll, [p.lon, p.lat]); if (d < nd) { nd = d; near = p; } }
    if (near && nd <= Math.max(3.5 * RAD, 20 / R)) { cb.select(near); return; }
    cb.miss(hit ? hit.properties && hit.properties.name : null);
  }

  // --- pointer input: drag to rotate, pinch or wheel to zoom, tap to pick
  const posOf = e => { const r = fx.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  function down(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    try { fx.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    const [x, y] = posOf(e);
    ptrs.set(e.pointerId, { x, y, x0: x, y0: y });
    anim = null; vel = null;
    if (ptrs.size === 1) gesture = { moved: false, pinch: false, t0: performance.now(), vx: 0, vy: 0, tv: performance.now() };
    else if (ptrs.size === 2 && gesture) {
      const [a, b] = Array.from(ptrs.values());
      gesture.pinch = true; gesture.d0 = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)); gesture.z0 = zoom;
    }
    kick();
  }
  function move(e) {
    const p = ptrs.get(e.pointerId);
    if (!p || !gesture) return;
    const [x, y] = posOf(e);
    const dx = x - p.x, dy = y - p.y;
    p.x = x; p.y = y;
    if (ptrs.size >= 2) {
      const [a, b] = Array.from(ptrs.values());
      const z = clamp(gesture.z0 * Math.hypot(a.x - b.x, a.y - b.y) / gesture.d0, ZOOM_MIN, ZOOM_MAX);
      if (z !== zoom) { zoom = z; baseDirty = true; }
      return;
    }
    if (!gesture.moved && Math.hypot(x - p.x0, y - p.y0) < 8) return;
    gesture.moved = true;
    const k = 1 / (R0 * zoom * RAD);          // degrees per pixel, so the surface follows the finger
    rot[0] += dx * k; rot[1] = clamp(rot[1] - dy * k, -80, 80);
    const now = performance.now(), dtv = Math.max(1, now - gesture.tv);
    gesture.vx = 0.6 * gesture.vx + 0.4 * (dx * k / dtv); gesture.vy = 0.6 * gesture.vy + 0.4 * (-dy * k / dtv); gesture.tv = now;
    baseDirty = true;
  }
  function up(e) {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    ptrs.delete(e.pointerId);
    const now = performance.now();
    idleUntil = now + 3000; lastSpin = 0;
    if (ptrs.size) {                           // one finger left after a pinch: keep dragging from here
      for (const q of ptrs.values()) { q.x0 = q.x; q.y0 = q.y; }
      return;
    }
    const g = gesture; gesture = null;
    if (!g) return;
    if (e.type === 'pointerup' && !g.moved && !g.pinch && now - g.t0 < 600) { pick(p.x, p.y); return; }
    if (g.moved && !g.pinch && now - g.tv < 60 && !reduced) {
      const sp2 = Math.abs(g.vx) + Math.abs(g.vy);
      if (sp2 > 0.02) { const lim = Math.min(1, 0.6 / sp2); vel = [g.vx * lim, g.vy * lim]; }
    }
    kick();
  }
  function wheel(e) {
    const z = clamp(zoom * Math.exp(-e.deltaY * 0.0015), ZOOM_MIN, ZOOM_MAX);
    if (z === zoom) return;                    // at the limit: let the page scroll
    e.preventDefault();
    zoom = z; baseDirty = true; idleUntil = performance.now() + 3000; lastSpin = 0;
    kick();
  }
  fx.addEventListener('pointerdown', down);
  fx.addEventListener('pointermove', move);
  fx.addEventListener('pointerup', up);
  fx.addEventListener('pointercancel', up);
  fx.addEventListener('wheel', wheel, { passive: false });

  const ro = new ResizeObserver(size); ro.observe(stage);
  const io = new IntersectionObserver(es => { onscreen = es[es.length - 1].isIntersecting; lastSpin = 0; kick(); });
  io.observe(stage);
  const onVis = () => { lastSpin = 0; lastT = 0; kick(); };
  document.addEventListener('visibilitychange', onVis);
  size();

  // Test and debugging hook: current orientation and zoom.
  stage.__geo = () => ({ rot: [rot[0], rot[1]], zoom, spinning: !sel && !ptrs.size && !anim });
  return {
    select(c, instant) {
      sel = c; selFeat = featOf.get(c.i) || null; vel = null;
      if (hasPos(c)) {
        const to = [-c.lon, clamp(-c.lat, -80, 80)];
        if (instant || reduced) { rot[0] = to[0]; rot[1] = to[1]; anim = null; baseDirty = true; }
        else {
          const d = [wrap(to[0] - rot[0]), to[1] - rot[1]];
          anim = { from: [rot[0], rot[1]], d, t0: performance.now(), ms: 450 + Math.min(650, 5 * Math.hypot(d[0], d[1])) };
        }
      }
      kick();
    },
    clear() { sel = null; selFeat = null; idleUntil = performance.now() + 2500; lastSpin = 0; kick(); },
    destroy() {
      dead = true;
      stage.__geo = null;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      ro.disconnect(); io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      fx.removeEventListener('pointerdown', down); fx.removeEventListener('pointermove', move);
      fx.removeEventListener('pointerup', up); fx.removeEventListener('pointercancel', up);
      fx.removeEventListener('wheel', wheel);
    },
  };
}

// -------------------------------------------------------------- globe view
function barPct(n, max, mode) {
  if (!max) return 0;
  return mode === 'log' ? Math.log(n + 1) / Math.log(max + 1) * 100 : n / max * 100;
}

registerView('globe', {
  title: 'World of SC26', tab: 'explore',
  render(el, ctx) {
    const G = geoStats();
    let dead = false, globe = null, sel = null;
    let mode = ctx.query.scale === 'log' ? 'log' : 'linear';
    const stageH = Math.max(270, Math.min(540, Math.round((el.clientHeight || 760) * 0.55)));

    const rows = G.list.map((c, i) => {
      const n = npOf(c);
      return '<div class="geo-row" data-act="geo-pick" data-c="' + c.i + '" data-np="' + n + '" role="button" aria-label="Show ' + esc(c.name) + ' on the globe">' +
        '<div class="geo-row-top"><span class="geo-rk">' + (i + 1) + '</span><span class="geo-fl">' + flagOf(c) + '</span>' +
        '<span class="geo-nm">' + esc(c.name) + '</span><b>' + NUM(n) + '</b><em>' + share(n, G.known) + '</em></div>' +
        '<div class="geo-track"><i style="width:' + barPct(n, G.max, mode).toFixed(2) + '%"></i></div></div>';
    }).join('');

    el.innerHTML =
      '<div class="geo-stage" style="height:' + stageH + 'px">' +
      '<canvas class="geo-globe" aria-label="Globe with countries shaded by number of SC26 contributors"></canvas><canvas class="geo-fx"></canvas>' +
      '<div class="geo-load"><div class="spinner"></div></div>' +
      '<div class="geo-key"><span>1</span><i style="background:linear-gradient(90deg,' + RAMP.join(',') + ')"></i><span>' + NUM(G.max) + '</span><em>contributors, log scale</em></div>' +
      '<div class="geo-tip">Drag to spin · pinch to zoom</div>' +
      '</div>' +
      '<div class="geo-cardslot" id="geo-card"></div>' +
      '<section class="sec"><div class="sec-h"><h2>Countries and regions</h2>' +
      '<div class="seg geo-seg" role="group" aria-label="Bar scale">' +
      '<button data-act="geo-scale" data-v="linear"' + (mode === 'linear' ? ' class="on"' : '') + '>Linear</button>' +
      '<button data-act="geo-scale" data-v="log"' + (mode === 'log' ? ' class="on"' : '') + '>Log</button></div></div>' +
      '<p class="lead" id="geo-total" data-known="' + G.known + '">' + NUM(G.known) + ' contributors from ' + G.list.length +
      ' countries and regions. Tap one to find it on the globe.</p>' +
      '<div class="card geo-list" id="geo-list">' + rows + '</div>' +
      '<p class="note geo-note" id="geo-unknown" data-unknown="' + G.unknown + '">' + NUM(G.unknown) + ' of ' + NUM(DB.people.length) +
      ' contributors have no country on file, so they are not on the globe or in this list. Shares are out of the ' + NUM(G.known) +
      ' with a known country. Lines on the globe run from each country to Chicago.</p>' +
      '</section>';

    const stage = el.querySelector('.geo-stage');
    const slot = el.querySelector('#geo-card');

    function card(miss) {
      if (!sel) {
        slot.innerHTML = '<div class="card geo-card geo-card-empty">' + icon('globe') + '<span>' +
          (miss ? esc(miss) : 'Tap a country on the globe, or pick one from the list below.') + '</span></div>';
        return;
      }
      const c = sel, n = npOf(c);
      slot.innerHTML = '<div class="card glow geo-card" data-c="' + c.i + '">' +
        '<span class="geo-bigflag">' + flagOf(c) + '</span>' +
        '<div class="geo-card-main"><b class="geo-card-name">' + esc(c.name) + '</b>' +
        '<div class="geo-card-stats"><span><b>' + NUM(n) + '</b> contributor' + (n === 1 ? '' : 's') + '</span><span><b>' + NUM(c.orgs.size) + '</b> organization' + (c.orgs.size === 1 ? '' : 's') + '</span></div>' +
        (hasPos(c) ? '' : '<div class="note">No map position on file for this entry.</div>') + '</div>' +
        '<button class="btn sm primary" data-go="#/country/' + c.i + '" aria-label="Open the ' + esc(c.name) + ' page">Open' + icon('chevR') + '</button>' +
        '<button class="iconbtn" data-act="geo-clear" aria-label="Clear selection">' + icon('x') + '</button></div>';
    }
    function syncUrl() { setQuery({ c: sel ? sel.i : null, scale: mode === 'log' ? 'log' : null }); }
    function select(c, o = {}) {
      sel = c;
      stage.dataset.sel = String(c.i);
      el.querySelectorAll('.geo-row.on').forEach(r => r.classList.remove('on'));
      const row = el.querySelector('.geo-row[data-c="' + c.i + '"]');
      if (row) row.classList.add('on');
      card();
      if (!o.quiet) syncUrl();
      if (globe) globe.select(c, !!o.instant);
      if (o.scroll) el.scrollTo({ top: 0, behavior: 'smooth' });
    }
    function clear(miss) {
      sel = null;
      delete stage.dataset.sel;
      el.querySelectorAll('.geo-row.on').forEach(r => r.classList.remove('on'));
      card(miss);
      syncUrl();
      if (globe) globe.clear();
    }

    ctx.on('geo-pick', t => { const c = DB.countries[+t.dataset.c]; if (c) select(c, { scroll: true }); });
    ctx.on('geo-clear', () => clear());
    ctx.on('geo-scale', t => {
      mode = t.dataset.v === 'log' ? 'log' : 'linear';
      el.querySelectorAll('.geo-seg button').forEach(b => b.classList.toggle('on', b.dataset.v === mode));
      el.querySelectorAll('#geo-list .geo-row').forEach(r => { r.querySelector('.geo-track i').style.width = barPct(+r.dataset.np, G.max, mode).toFixed(2) + '%'; });
      el.querySelector('#geo-list').dataset.scale = mode;
      syncUrl();
    });
    el.querySelector('#geo-list').dataset.scale = mode;

    const start = ctx.query.c != null && ctx.query.c !== '' ? DB.countries[+ctx.query.c] : null;
    if (start && npOf(start) > 0) select(start, { quiet: true, instant: true }); else card();

    loadWorld().then(feats => {
      if (dead) return;
      globe = createGlobe(stage, feats, G, {
        select: c => select(c),
        miss: name => clear(name ? 'No SC26 contributors are listed from ' + name + '.' : null),
      });
      if (sel) globe.select(sel, true);
      const ld = stage.querySelector('.geo-load'); if (ld) ld.remove();
      stage.dataset.ready = '1';
    }).catch(e => {
      console.error(e);
      if (dead) return;
      const ld = stage.querySelector('.geo-load');
      if (ld) ld.innerHTML = '<p class="note">The world map could not be loaded. The country list below still works.</p>';
    });

    return () => { dead = true; if (globe) globe.destroy(); };
  },
});

// ------------------------------------------------------------ country page
const theName = n => (/^(United |Netherlands$|Philippines$)/.test(n) ? 'the ' + n : n);
function barRow(label, value, pct, color, go) {
  return '<div class="geo-row"' + (go ? ' data-go="' + esc(go) + '"' : '') + '><div class="geo-row-top"><span class="geo-nm">' + label + '</span><b>' + value + '</b></div>' +
    '<div class="geo-track"><i style="width:' + pct.toFixed(2) + '%;background:' + color + '"></i></div></div>';
}

registerView('country', {
  title: (args) => { const c = DB.countries && DB.countries[+args[0]]; return c ? c.name : 'Country'; },
  tab: 'explore',
  render(el, ctx) {
    const c = /^\d+$/.test(ctx.args[0] || '') ? DB.countries[+ctx.args[0]] : null;
    if (!c) {
      el.innerHTML = emptyState('globe', 'Country not found', 'That country is not in the SC26 program data.', '<button class="btn" data-go="#/globe">Open the globe</button>');
      return undefined;
    }
    const G = geoStats();
    const people = c.people.map(i => DB.people[i]);
    const n = people.length;

    // program items with at least one contributor from here
    const itemSet = new Set();
    for (const p of people) for (const x of p.items) itemSet.add(x[0]);
    const allItems = Array.from(itemSet, i => DB.items[i]);
    const items = allItems.filter(visible).sort((a, b) => a.s - b.s || a.e - b.e || a.i - b.i);
    const hidden = allItems.length - items.length;

    // themes among those items
    const tc = new Map();
    for (const it of items) for (const [t] of it.th) tc.set(t, (tc.get(t) || 0) + 1);
    const themes = Array.from(tc).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 8);

    // organizations, by contributors from this country
    const oc = new Map();
    for (const p of people) for (const o of p.o) oc.set(o, (oc.get(o) || 0) + 1);
    const orgs = Array.from(oc).sort((a, b) => b[1] - a[1] || DB.orgs[b[0]].np - DB.orgs[a[0]].np || a[0] - b[0]);
    const orgHtml = ([oi, k]) => {
      const o = DB.orgs[oi];
      return orgRow(o, { sub: o.ni + ' item' + (o.ni === 1 ? '' : 's') + (o.np > k ? ' · ' + NUM(o.np) + ' people worldwide' : ''), right: '<b>' + NUM(k) + '</b>from here' });
    };

    const active = people.slice().sort((a, b) => b.w - a.w || a.n.localeCompare(b.n)).slice(0, 10);
    const rank = G.rank.get(c.i);

    let html = '<div class="card glow geo-chead"><span class="geo-bigflag">' + flagOf(c) + '</span>' +
      '<div class="geo-chead-main"><h2>' + esc(c.name) + '</h2><p>' +
      (rank ? 'No. ' + rank + ' of ' + G.list.length + ' by contributors · ' + share(n, G.known) + ' of those with a known country' : 'No contributors on file') + '</p></div>' +
      '<button class="iconbtn" data-go="#/globe?c=' + c.i + '" aria-label="Show on the globe">' + icon('globe') + '</button></div>';
    html += '<div class="stats geo-cstats">' + statTile(n, n === 1 ? 'contributor' : 'contributors') + statTile(c.orgs.size, c.orgs.size === 1 ? 'organization' : 'organizations') +
      statTile(items.length, items.length === 1 ? 'program item' : 'program items') + '</div>';

    if (themes.length) {
      const max = themes[0][1];
      html += section('What ' + theName(c.name) + ' presents', '<div class="card geo-list">' + themes.map(([t, k]) => {
        const th = DB.themes[t];
        return barRow(esc(th.n), NUM(k), k / max * 100, th.c, '#/theme/' + th.id);
      }).join('') + '</div>', { sub: 'items per theme' });
    }
    if (orgs.length) {
      html += section('Organizations', '<div class="card list" id="geo-corgs">' + orgs.slice(0, 10).map(orgHtml).join('') + '</div>' +
        (orgs.length > 10 ? '<button class="btn sm block geo-more" data-act="geo-orgs-all">Show all ' + NUM(orgs.length) + ' organizations' + icon('chevD') + '</button>' : ''),
        { sub: orgs.length > 10 ? 'top 10 of ' + NUM(orgs.length) : '' });
    }
    if (active.length) {
      html += section('Most active people', '<div class="card list">' + active.map(p => {
        const k = new Set(p.items.map(x => x[0])).size;
        return personRow(p, { right: '<b>' + k + '</b>item' + (k === 1 ? '' : 's') });
      }).join('') + '</div>', { sub: n > 10 ? 'top 10 of ' + NUM(n) : '' });
    }
    html += section('Program items', items.length ? '<div id="geo-citems"></div>' :
      '<p class="note">No program items to show' + (hidden ? ' with the current "technical program only" setting' : '') + '.</p>',
      { sub: items.length ? 'earliest first' : '' });
    if (hidden && items.length) {
      html += '<p class="note geo-note">' + NUM(hidden) + ' more item' + (hidden === 1 ? ' is' : 's are') + ' outside the technical program and hidden by your settings.</p>';
    }
    el.innerHTML = html;

    const disposers = [];
    const box = el.querySelector('#geo-citems');
    if (box) disposers.push(lazyList(box, items.length, (a, b) => items.slice(a, b).map(it => itemCard(it, { showDay: true, parent: true })).join(''), 24));
    ctx.on('geo-orgs-all', btn => {
      const list = el.querySelector('#geo-corgs');
      if (!list || list.dataset.all) return;
      list.dataset.all = '1';
      btn.remove();
      const more = orgs.slice(10);
      disposers.push(lazyList(list, more.length, (a, b) => more.slice(a, b).map(orgHtml).join(''), 40));
    });
    return () => disposers.forEach(fn => fn());
  },
});
