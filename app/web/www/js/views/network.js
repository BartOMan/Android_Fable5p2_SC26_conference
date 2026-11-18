// SC26 Atlas: collaboration network (who shares program items with whom).
//   #/network                 the ~200 most connected contributors and the links among them
//   #/network?p=<personId>    one person, their 60 strongest collaborators and the links among those
//   &color=country            color circles by country instead of sector
// Links come from DB.items: every non-break item with 2 to 40 people adds 1 to each pair on it.
import { DB, SECTOR, flagOf, searchPeople, warmSearch } from '../core.js';
import { registerView, go, setQuery } from '../router.js';
import { esc, icon, avatar, chip } from '../ui.js';

const DPR_CAP = 2.5;
const TOP_N = 200, EGO_N = 60, MAX_PEOPLE = 40;
const NUM = n => Number(n).toLocaleString('en-US');
const BG = '#0B1020';
// Same hex values as --geo-edu / --geo-lab / --geo-com / --geo-oth in geo.css.
const SECTOR_COLOR = { edu: '#0EA5C4', lab: '#9B6BF0', com: '#DB6E28', oth: '#7C87A8' };
const SECTOR_KEYS = ['edu', 'lab', 'com', 'oth'];
const COUNTRY_COLORS = ['#3987E5', '#D95926', '#199E70', '#C98500', '#D55181', '#008300', '#9085E9', '#E66767'];
const GRAY = '#6B7594';
const FONT = '600 11.5px system-ui, -apple-system, Roboto, "Segoe UI", sans-serif';
const FONT_B = '700 12.5px system-ui, -apple-system, Roboto, "Segoe UI", sans-serif';

// ------------------------------------------------------------------ graph
let GRAPH = null;
/** Whole co-authorship graph: adjacency with weights, weighted degree, people ranked by it. */
function graph() {
  if (GRAPH) return GRAPH;
  const adj = new Map();
  const add = (a, b) => { let m = adj.get(a); if (!m) { m = new Map(); adj.set(a, m); } m.set(b, (m.get(b) || 0) + 1); };
  for (const it of DB.items) {
    if (it.brk) continue;
    const ps = Array.from(new Set(it.p.map(x => x[0])));     // a person can hold two roles on one item
    if (ps.length < 2 || ps.length > MAX_PEOPLE) continue;
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) { add(ps[i], ps[j]); add(ps[j], ps[i]); }
  }
  const deg = new Map();
  for (const [i, m] of adj) { let s = 0; for (const w of m.values()) s += w; deg.set(i, s); }
  const rank = Array.from(deg.keys()).sort((a, b) => deg.get(b) - deg.get(a) || DB.people[b].w - DB.people[a].w || a - b);
  const topCountries = DB.countries.slice().sort((a, b) => b.people.length - a.people.length || a.i - b.i).slice(0, COUNTRY_COLORS.length).map(c => c.i);
  GRAPH = { adj, deg, rank, topCountries };
  return GRAPH;
}
const collaborators = (G, p) => { const m = G.adj.get(p.i); return m ? m.size : 0; };

/** Nodes and links for a set of people. Overview graphs drop people left without any link. */
function subgraph(G, ids, keep) {
  const set = new Set(ids);
  const links = [];
  const linked = new Set();
  for (const a of ids) {
    const m = G.adj.get(a); if (!m) continue;
    for (const [b, w] of m) if (a < b && set.has(b)) { links.push({ source: a, target: b, w }); linked.add(a); linked.add(b); }
  }
  const nodes = ids.filter(i => linked.has(i) || i === keep).map(i => {
    const p = DB.people[i];
    const name = p.n.length > 24 ? p.n.slice(0, 23).trimEnd() + '…' : p.n;
    return { i, p, r: 3.5 + 1.8 * Math.sqrt(Math.max(0, p.w || 0)), label: name, tw: 0, ph: 0, color: GRAY };
  });
  return { nodes, links };
}

const sectorOf = p => { const k = p.o.length ? DB.orgs[p.o[0]].k : 'oth'; return SECTOR_COLOR[k] ? k : 'oth'; };

registerView('network', {
  title: (args, query) => {
    const p = query && query.p && DB.personById ? DB.personById.get(query.p) : null;
    return p ? p.n + ': network' : 'Collaboration network';
  },
  tab: 'explore', full: true,
  render(el, ctx) {
    const G = graph();
    const focus = ctx.query.p ? DB.personById.get(ctx.query.p) || null : null;
    const missing = !!ctx.query.p && !focus;
    let colorMode = ctx.query.color === 'country' ? 'country' : 'sector';
    const reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const colorQS = () => (colorMode === 'country' ? '&color=country' : '');

    let ids;
    if (focus) {
      const m = G.adj.get(focus.i) || new Map();
      ids = [focus.i].concat(Array.from(m).sort((a, b) => b[1] - a[1] || DB.people[b[0]].w - DB.people[a[0]].w || a[0] - b[0]).slice(0, EGO_N).map(x => x[0]));
    } else ids = G.rank.slice(0, TOP_N);
    const { nodes, links } = subgraph(G, ids, focus ? focus.i : -1);
    const focusNode = focus ? nodes.find(n => n.i === focus.i) : null;
    if (focusNode) { focusNode.r *= 1.25; focusNode.fx = 0; focusNode.fy = 0; }

    el.innerHTML =
      '<canvas class="geo-net-canvas" aria-label="Collaboration network"></canvas>' +
      '<div class="floatbar geo-nbar">' +
      '<label class="field geo-nfield">' + icon('search') + '<input id="geo-nq" type="search" inputmode="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Find a contributor" aria-label="Find a contributor by name">' +
      '<button class="iconbtn" data-act="net-clearq" aria-label="Clear search" hidden>' + icon('x') + '</button></label>' +
      '<div class="geo-nchips">' +
      (focus || missing ? chip('Top ' + TOP_N, { act: 'net-top' }) : '') +
      '<span class="geo-nlab">Color</span>' +
      chip('Sector', { act: 'net-color', id: 'sector', on: colorMode === 'sector' }) +
      chip('Country', { act: 'net-color', id: 'country', on: colorMode === 'country' }) +
      '<button class="chip geo-nfit" data-act="net-fit" aria-label="Recenter the graph">' + icon('target') + '</button>' +
      '</div><div class="geo-nresults" hidden></div></div>' +
      '<div class="geo-nlegend"></div><div id="geo-ncard"></div>';

    const canvas = el.querySelector('canvas'), c = canvas.getContext('2d');
    const bar = el.querySelector('.geo-nbar'), legendEl = el.querySelector('.geo-nlegend'), cardSlot = el.querySelector('#geo-ncard');
    const input = el.querySelector('#geo-nq'), results = el.querySelector('.geo-nresults'), clearBtn = el.querySelector('[data-act="net-clearq"]');

    // ------------------------------------------------------------ colors
    let colorGroups = [];
    function applyColors() {
      const groups = new Map();
      for (const n of nodes) {
        if (colorMode === 'country') { const k = G.topCountries.indexOf(n.p.c); n.key = k >= 0 ? k : -1; n.color = k >= 0 ? COUNTRY_COLORS[k] : GRAY; }
        else { n.key = sectorOf(n.p); n.color = SECTOR_COLOR[n.key]; }
        if (!groups.has(n.color)) groups.set(n.color, []);
        groups.get(n.color).push(n);
      }
      colorGroups = Array.from(groups);
      const present = new Set(nodes.map(n => n.key));
      let items;
      if (colorMode === 'country') {
        items = G.topCountries.map((ci, k) => (present.has(k) ? '<span><i style="--c:' + COUNTRY_COLORS[k] + '"></i>' + esc(DB.countries[ci].name) + '</span>' : '')).join('') +
          (present.has(-1) ? '<span><i style="--c:' + GRAY + '"></i>Other or unknown</span>' : '');
      } else {
        items = SECTOR_KEYS.map(k => (present.has(k) ? '<span><i style="--c:' + SECTOR_COLOR[k] + '"></i>' + esc(SECTOR[k]) + '</span>' : '')).join('');
      }
      const others = nodes.length - (focusNode ? 1 : 0);
      const cap = missing ? 'That person is not in the program. Showing the ' + nodes.length + ' most connected contributors.'
        : focus ? (others ? esc(focus.n) + ' and ' + (others === 1 ? 'one collaborator' : 'the ' + others + ' closest collaborators') + '. Tap a circle.'
          : esc(focus.n) + ' shares no program item of 2 to ' + MAX_PEOPLE + ' people with anyone.')
          : 'The ' + nodes.length + ' most connected contributors. Bigger circle, more active.';
      legendEl.innerHTML = '<p>' + cap + '</p><div class="legend">' + items + (colorMode === 'sector' ? '<span>(sector is an estimate)</span>' : '') + '</div>';
    }

    // ----------------------------------------------------------- layout
    const nbrs = new Map(nodes.map(n => [n, new Set()]));
    const sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links).id(d => d.i).distance(l => (focusNode && (l.source === focusNode || l.target === focusNode) ? 56 + 70 / l.w : 34 + 14 / l.w)))
      .force('charge', d3.forceManyBody().strength(d => -(focusNode ? 150 : 70) - d.r * 9).distanceMax(460))
      .force('x', d3.forceX(0).strength(focusNode ? 0.06 : 0.12))
      .force('y', d3.forceY(0).strength(focusNode ? 0.035 : 0.04))
      .force('collide', d3.forceCollide(d => d.r + 2.5))
      .stop();
    for (const l of links) { nbrs.get(l.source).add(l.target); nbrs.get(l.target).add(l.source); }
    // settle before the first paint so the graph never explodes on screen
    const PRE = nodes.length > 120 ? 170 : 220;
    sim.alphaDecay(1 - Math.pow(0.001, 1 / PRE)).tick(PRE);
    const edgeBuckets = [
      { links: links.filter(l => l.w === 1), width: 0.6, alpha: 0.15 },
      { links: links.filter(l => l.w === 2 || l.w === 3), width: 1.1, alpha: 0.26 },
      { links: links.filter(l => l.w >= 4), width: 1.9, alpha: 0.4 },
    ].filter(b => b.links.length);
    const order = nodes.slice().sort((a, b) => (b === focusNode) - (a === focusNode) || b.r - a.r || a.i - b.i);

    // ------------------------------------------------------------- state
    let W = 0, H = 0, dpr = 1, raf = 0, dead = false;
    let tf = d3.zoomIdentity, k0 = 1;
    let sel = null, hot = null, selLinks = [];
    let labels = [], labelsDirty = true;

    const rs = n => Math.max(2.2, Math.min(30, n.r * tf.k));
    const requestDraw = () => { if (!raf && !dead) raf = requestAnimationFrame(draw); };

    function size() {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return false;
      W = w; H = h; dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      labelsDirty = true; requestDraw();
      return true;
    }
    function fitTransform() {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const n of nodes) { x0 = Math.min(x0, n.x - n.r); x1 = Math.max(x1, n.x + n.r); y0 = Math.min(y0, n.y - n.r); y1 = Math.max(y1, n.y + n.r); }
      if (!nodes.length) { x0 = y0 = -1; x1 = y1 = 1; }
      const top = (bar.offsetHeight || 104) - 6, bottom = Math.max(64, (legendEl.offsetHeight || 60) + 22), side = 22;
      const aw = Math.max(80, W - 2 * side), ah = Math.max(80, H - top - bottom);
      const k = Math.max(0.3, Math.min(1.7, aw / Math.max(1, x1 - x0), ah / Math.max(1, y1 - y0)));
      return d3.zoomIdentity.translate(W / 2 - k * (x0 + x1) / 2, top + ah / 2 - k * (y0 + y1) / 2).scale(k);
    }

    function layoutLabels() {
      labelsDirty = false;
      const k = tf.k, out = [], boxes = [];
      const top = (bar.offsetHeight || 104) - 22;
      const max = Math.round(Math.max(8, Math.min(400, 14 * Math.pow(k / k0, 2))));
      const pool = hot ? order.filter(n => hot.has(n)).sort((a, b) => (b === sel) - (a === sel)) : order;
      const shown = [];
      for (const n of nodes) {
        const sx = n.x * k + tf.x, sy = n.y * k + tf.y;
        if (sx > -30 && sx < W + 30 && sy > -30 && sy < H + 30) shown.push([sx, sy, rs(n), n]);
      }
      c.font = FONT;
      for (const n of pool) {
        if (out.length >= max) break;
        const sx = n.x * k + tf.x, sy = n.y * k + tf.y, r = rs(n) + (n === focusNode ? 6 : n === sel ? 3 : 0);
        if (sx < -10 || sx > W + 10 || sy < top || sy > H - 6) continue;
        const big = n === focusNode || n === sel;
        if (!n.tw) n.tw = c.measureText(n.label).width;
        const w = n.tw * (big ? 1.12 : 1) + 2, h = 15;
        for (const side of [1, -1, 0, 2]) {            // right, left, below, above
          const bx = side === 1 ? sx + r + 4 : side === -1 ? sx - r - 4 - w : sx - w / 2;
          const by = side === 0 ? sy + r + 3 : side === 2 ? sy - r - 3 - h : sy - h / 2;
          if (bx < 3 || bx + w > W - 3 || by < top) continue;
          let ok = true;
          for (const b of boxes) { if (bx < b[0] + b[2] + 4 && bx + w + 4 > b[0] && by < b[1] + b[3] + 2 && by + h + 2 > b[1]) { ok = false; break; } }
          if (ok) {
            for (const s of shown) {
              if (s[3] === n || s[2] < r * 0.8) continue;   // a name may cover clearly smaller circles, never bigger ones
              const qx = Math.max(bx, Math.min(s[0], bx + w)), qy = Math.max(by, Math.min(s[1], by + h));
              if ((qx - s[0]) * (qx - s[0]) + (qy - s[1]) * (qy - s[1]) < (s[2] + 1) * (s[2] + 1)) { ok = false; break; }
            }
          }
          if (!ok && !(big && side === 0)) continue;       // the focus and the selection always get a name
          boxes.push([bx, by, w, h]); out.push({ n, side, w, big, pad: r - rs(n) });
          break;
        }
      }
      labels = out;
    }

    function draw() {
      raf = 0;
      if (dead || !W) return;
      if (labelsDirty) layoutLabels();
      const k = tf.k, ox = tf.x, oy = tf.y;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, W, H);
      c.lineCap = 'round';
      // links, batched by weight
      for (const b of edgeBuckets) {
        c.beginPath();
        for (const l of b.links) {
          const x1 = l.source.x * k + ox, y1 = l.source.y * k + oy, x2 = l.target.x * k + ox, y2 = l.target.y * k + oy;
          if ((x1 < 0 && x2 < 0) || (x1 > W && x2 > W) || (y1 < 0 && y2 < 0) || (y1 > H && y2 > H)) continue;
          c.moveTo(x1, y1); c.lineTo(x2, y2);
        }
        c.strokeStyle = 'rgba(148, 163, 255, ' + (hot ? b.alpha * 0.22 : b.alpha).toFixed(3) + ')';
        c.lineWidth = b.width; c.stroke();
      }
      if (hot && selLinks.length) {
        c.beginPath();
        for (const l of selLinks) { c.moveTo(l.source.x * k + ox, l.source.y * k + oy); c.lineTo(l.target.x * k + ox, l.target.y * k + oy); }
        c.strokeStyle = 'rgba(165, 243, 252, .8)'; c.lineWidth = 1.5; c.stroke();
      }
      // circles, batched by color; dimmed ones first
      const circle = n => { const x = n.x * k + ox, y = n.y * k + oy, r = rs(n); if (x < -r || x > W + r || y < -r || y > H + r) return; c.moveTo(x + r, y); c.arc(x, y, r, 0, 2 * Math.PI); };
      if (hot) {
        c.globalAlpha = 0.2;
        for (const [color, list] of colorGroups) { c.beginPath(); for (const n of list) if (!hot.has(n)) circle(n); c.fillStyle = color; c.fill(); }
        c.globalAlpha = 1;
      }
      c.lineWidth = 1.1; c.strokeStyle = BG;
      for (const [color, list] of colorGroups) {
        c.beginPath();
        for (const n of list) if (!hot || hot.has(n)) circle(n);
        c.fillStyle = color; c.fill(); c.stroke();
      }
      // rings: the focus person (ego view) and the tapped person
      if (focusNode) {
        const x = focusNode.x * k + ox, y = focusNode.y * k + oy, r = rs(focusNode);
        c.beginPath(); c.arc(x, y, r + 7, 0, 2 * Math.PI); c.fillStyle = 'rgba(34, 211, 238, .16)'; c.fill();
        c.beginPath(); c.arc(x, y, r, 0, 2 * Math.PI); c.fillStyle = focusNode.color; c.fill();
        c.beginPath(); c.arc(x, y, r + 2.5, 0, 2 * Math.PI); c.strokeStyle = '#FFFFFF'; c.lineWidth = 2.2; c.stroke();
      }
      if (sel && sel !== focusNode) {
        const x = sel.x * k + ox, y = sel.y * k + oy, r = rs(sel);
        c.beginPath(); c.arc(x, y, r + 3, 0, 2 * Math.PI); c.strokeStyle = '#FFFFFF'; c.lineWidth = 2; c.stroke();
      }
      // names: dark halo first, then the text
      c.textBaseline = 'middle'; c.lineJoin = 'round'; c.lineWidth = 3; c.strokeStyle = 'rgba(11, 16, 32, .88)';
      for (let pass = 0; pass < 2; pass++) {
        for (const L of labels) {
          const n = L.n, x = n.x * k + ox, y = n.y * k + oy, r = rs(n) + L.pad;
          const tx = L.side === 1 ? x + r + 4 : L.side === -1 ? x - r - 4 - L.w : x - L.w / 2 + 1;
          const ty = L.side === 0 ? y + r + 3 + 7 : L.side === 2 ? y - r - 3 - 8 : y;
          c.font = L.big ? FONT_B : FONT;
          if (pass === 0) c.strokeText(n.label, tx, ty);
          else { c.fillStyle = L.big ? '#FFFFFF' : hot && !hot.has(n) ? 'rgba(213, 219, 242, .4)' : '#D5DBF2'; c.fillText(n.label, tx, ty); }
        }
      }
    }

    // -------------------------------------------------------- selection
    function select(n) {
      sel = n;
      hot = new Set([n]); nbrs.get(n).forEach(m => hot.add(m));
      selLinks = links.filter(l => l.source === n || l.target === n);
      const p = n.p, org = p.o.length ? DB.orgs[p.o[0]].n : '', country = p.c >= 0 ? DB.countries[p.c] : null;
      const k = collaborators(G, p);
      const isFocus = n === focusNode;
      cardSlot.innerHTML = '<div class="overlay-card geo-ncard" data-person="' + esc(p.id) + '"><div class="geo-ncard-top">' + avatar(p, 48) +
        '<div class="geo-ncard-main"><b class="geo-ncard-name">' + esc(p.n) + '</b>' +
        '<span>' + (country ? flagOf(country) + ' ' : '') + esc(org || 'No organization listed') + '</span>' +
        '<em>' + NUM(k) + ' collaborator' + (k === 1 ? '' : 's') + ' in the program</em></div>' +
        '<button class="iconbtn" data-act="net-close" aria-label="Close">' + icon('x') + '</button></div>' +
        '<div class="btnrow"><button class="btn sm" data-go="#/person/' + esc(p.id) + '">' + icon('user') + 'Profile</button>' +
        (isFocus ? '<button class="btn sm" data-act="net-top">' + icon('network') + 'Top ' + TOP_N + '</button>'
          : '<button class="btn sm primary" data-go="#/network?p=' + esc(p.id) + colorQS() + '">' + icon('network') + 'Their network</button>') +
        '</div></div>';
      legendEl.classList.add('off');
      labelsDirty = true; requestDraw();
    }
    function deselect() {
      if (!sel) return;
      sel = null; hot = null; selLinks = [];
      cardSlot.innerHTML = '';
      legendEl.classList.remove('off');
      labelsDirty = true; requestDraw();
    }
    function onClick(e) {
      hideResults();
      if (document.activeElement === input) input.blur();
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      let best = null, bd = Infinity;
      for (const n of nodes) {
        const d = Math.hypot(n.x * tf.k + tf.x - x, n.y * tf.k + tf.y - y) - rs(n);
        if (d < bd) { bd = d; best = n; }
      }
      if (best && bd <= 14) select(best); else deselect();
    }

    // ------------------------------------------------------ zoom and pan
    const zoom = d3.zoom().on('zoom', ev => { tf = ev.transform; labelsDirty = true; requestDraw(); });
    const zsel = d3.select(canvas);
    zsel.call(zoom).on('dblclick.zoom', null);
    canvas.addEventListener('click', onClick);
    function fit(animate) {
      const t = fitTransform();
      k0 = t.k;
      zoom.scaleExtent([k0 * 0.5, Math.max(6, k0 * 12)]);
      if (animate && !reduced) zsel.transition().duration(450).call(zoom.transform, t); else zsel.call(zoom.transform, t);
    }

    // ----------------------------------------------------------- search
    function hideResults() { results.hidden = true; results.innerHTML = ''; }
    function onInput() {
      const q = input.value.trim();
      clearBtn.hidden = !input.value;
      if (q.length < 2) { hideResults(); return; }
      const list = searchPeople(q, 8);
      results.innerHTML = list.length ? list.map(p => {
        const k = collaborators(G, p);
        return '<div class="row" data-act="net-pick" data-id="' + esc(p.id) + '">' + avatar(p, 36) + '<div class="row-main"><div class="row-title">' + esc(p.n) + '</div>' +
          '<div class="row-sub">' + esc(p.o.length ? DB.orgs[p.o[0]].n : 'No organization listed') + '</div></div>' +
          '<div class="row-right"><b>' + NUM(k) + '</b>collaborator' + (k === 1 ? '' : 's') + '</div></div>';
      }).join('') : '<div class="geo-nnone">No contributor matches “' + esc(q) + '”.</div>';
      results.hidden = false;
    }
    function openPerson(id) {
      hideResults(); input.blur();
      if (focus && focus.id === id) { input.value = ''; clearBtn.hidden = true; if (focusNode) select(focusNode); return; }
      go('#/network?p=' + encodeURIComponent(id) + colorQS());
    }
    const onKey = e => {
      if (e.key === 'Enter') { const first = results.querySelector('[data-id]'); if (first) openPerson(first.dataset.id); else input.blur(); }
      else if (e.key === 'Escape') { hideResults(); input.blur(); }
    };
    const onFocus = () => { setTimeout(() => { if (!dead) warmSearch(); }, 60); };
    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onKey);
    input.addEventListener('focus', onFocus);

    ctx.on('net-pick', t => openPerson(t.dataset.id));
    ctx.on('net-clearq', () => { input.value = ''; clearBtn.hidden = true; hideResults(); input.focus(); });
    ctx.on('net-close', () => deselect());
    ctx.on('net-top', () => go('#/network' + (colorMode === 'country' ? '?color=country' : '')));
    ctx.on('net-fit', () => fit(true));
    ctx.on('net-color', t => {
      colorMode = t.dataset.id === 'country' ? 'country' : 'sector';
      el.querySelectorAll('[data-act="net-color"]').forEach(b => b.classList.toggle('on', b.dataset.id === colorMode));
      setQuery({ p: focus ? focus.id : null, color: colorMode === 'country' ? 'country' : null });
      applyColors();
      if (sel) select(sel);          // refresh the card link so it keeps the color choice
      requestDraw();
    });

    // ------------------------------------------------------------- start
    applyColors();
    size();
    fit(false);
    canvas.dataset.nodes = String(nodes.length);
    canvas.dataset.links = String(links.length);
    canvas.dataset.ready = '1';
    // Test and debugging hook: node positions in CSS pixels relative to the canvas.
    canvas.__geoNodes = () => nodes.map(n => ({ id: n.p.id, name: n.p.n, x: n.x * tf.k + tf.x, y: n.y * tf.k + tf.y, r: rs(n), focus: n === focusNode }));

    // Keep the settled layout gently alive. The layout forces are done; from here every circle
    // floats a few pixels around its settled place (a weak spring home plus a slow push), which
    // stays bounded and costs almost nothing per tick. Redraw on every second tick (about 30 a second).
    if (!reduced && nodes.length > 1) {
      // the phase follows the position, so neighbors float together and their names never collide
      for (const n of nodes) { n.hx = n.x; n.hy = n.y; n.ph = n.x * 0.006 + n.y * 0.004; }
      const alive = () => {
        const t = performance.now() / 1000;
        for (const n of nodes) {
          if (n.fx != null) continue;
          n.vx += (n.hx - n.x) * 0.015 + Math.cos(t * 0.55 + n.ph) * 0.06;
          n.vy += (n.hy - n.y) * 0.015 + Math.sin(t * 0.45 + n.ph * 1.7) * 0.06;
        }
      };
      let ticks = 0;
      sim.force('link', null).force('charge', null).force('x', null).force('y', null).force('collide', null)
        .force('alive', alive).alphaDecay(0).alphaTarget(0.05).alpha(0.05).velocityDecay(0.45)
        .on('tick', () => { if ((ticks++ & 1) === 0) requestDraw(); }).restart();
    }
    let first = true;
    const ro = new ResizeObserver(() => { if (first) { first = false; return; } if (size()) requestDraw(); });
    ro.observe(el);

    return () => {
      dead = true;
      sim.on('tick', null); sim.stop();
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      ro.disconnect();
      zsel.interrupt().on('.zoom', null);
      canvas.removeEventListener('click', onClick);
      input.removeEventListener('input', onInput);
      input.removeEventListener('keydown', onKey);
      input.removeEventListener('focus', onFocus);
      canvas.__geoNodes = null;
    };
  },
});
