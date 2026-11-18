// SC26 Atlas: organizations.
//   #/orgs                         sector split, top 15 chart and the full leaderboard
//   #/orgs?k=<edu|lab|com|oth>&s=<np|ni>&q=<text>   leaderboard filter, sort and name search (kept in the URL)
// Rows link to #/org/<orgIdx>, which another module renders.
import { DB, norm } from '../core.js';
import { registerView, setQuery } from '../router.js';
import { esc, icon, section, orgRow, lazyList, emptyState } from '../ui.js';

const NUM = n => Number(n).toLocaleString('en-US');
// Fixed order and colors per sector. "lt" marks fills that need white text inside.
const SECTORS = [
  { k: 'edu', one: 'University', many: 'Universities', c: 'var(--geo-edu)' },
  { k: 'lab', one: 'Lab / research center', many: 'Labs', c: 'var(--geo-lab)', lt: true },
  { k: 'com', one: 'Industry', many: 'Industry', c: 'var(--geo-com)' },
  { k: 'oth', one: 'Other', many: 'Other', c: 'var(--geo-oth)' },
];
const SEC = Object.fromEntries(SECTORS.map(s => [s.k, s]));
const SHORT = { edu: 'University', lab: 'Lab', com: 'Industry', oth: 'Other' };
const pct = v => (v >= 0.1 ? Math.round(v * 100) + '%' : (v * 100).toFixed(1) + '%');

registerView('orgs', {
  title: 'Organizations', tab: 'explore',
  render(el, ctx) {
    const orgs = DB.orgs;
    const active = orgs.filter(o => o.np > 0);
    const idle = orgs.length - active.length;                       // listed without contributors, mostly exhibitors
    const idleEx = orgs.filter(o => !o.np && (o.ex || o.booth)).length;
    const names = new Map(orgs.map(o => [o.i, norm(o.n)]));
    const state = {
      q: ctx.query.q || '',
      k: SEC[ctx.query.k] ? ctx.query.k : 'all',
      s: ctx.query.s === 'ni' ? 'ni' : 'np',
    };

    // each contributor counted once, under the first organization they list
    const bySector = { edu: 0, lab: 0, com: 0, oth: 0 };
    let noOrg = 0;
    for (const p of DB.people) {
      if (!p.o.length) { noOrg++; continue; }
      const k = DB.orgs[p.o[0]].k;
      bySector[SEC[k] ? k : 'oth']++;
    }
    const placed = DB.people.length - noOrg;
    const orgCount = { edu: 0, lab: 0, com: 0, oth: 0 };
    for (const o of active) orgCount[SEC[o.k] ? o.k : 'oth']++;

    const top = orgs.slice().sort((a, b) => b.np - a.np || b.ni - a.ni || a.i - b.i).slice(0, 15);
    const lead = top[0];

    const stack = '<div class="geo-stack" role="img" aria-label="' +
      esc(SECTORS.map(s => s.one + ' ' + pct(bySector[s.k] / placed)).join(', ')) + '">' +
      SECTORS.map(s => {
        const sh = bySector[s.k] / placed;
        if (!bySector[s.k]) return '';
        const lab = sh >= 0.12;
        return '<i class="' + (s.lt ? 'lt' : '') + (lab ? '' : ' nolab') + '" style="flex:' + bySector[s.k] + ' 0 0;--c:' + s.c + '">' + (lab ? pct(sh) : '') + '</i>';
      }).join('') + '</div>' +
      '<div class="geo-slegend">' + SECTORS.map(s =>
        '<span data-sector="' + s.k + '" data-n="' + bySector[s.k] + '"><i style="--c:' + s.c + '"></i><u>' + esc(s.one) + '</u><b>' + NUM(bySector[s.k]) + '</b><em>' + pct(bySector[s.k] / placed) + '</em></span>').join('') + '</div>' +
      '<p class="note geo-note">Each contributor is counted once, under the first organization they list' +
      (noOrg ? '. ' + NUM(noOrg) + ' list none and are left out' : '') + '. Sector is an estimate.</p>';

    const tmax = top.length ? top[0].np : 1;
    const chart = '<div class="card geo-list geo-top">' + top.map((o, i) =>
      '<div class="geo-row" data-go="#/org/' + o.i + '"><div class="geo-row-top"><span class="geo-rk">' + (i + 1) + '</span>' +
      '<span class="geo-nm">' + esc(o.n) + '</span><b>' + NUM(o.np) + '</b></div>' +
      '<div class="geo-track"><i style="--i:' + i + ';width:' + (o.np / tmax * 100).toFixed(2) + '%;background:' + (SEC[o.k] || SEC.oth).c + '"></i></div></div>').join('') + '</div>' +
      '<div class="legend geo-note">' + SECTORS.map(s => '<span><i style="--c:' + s.c + '"></i>' + esc(s.one) + '</span>').join('') + '</div>';

    const segBtn = (k, label) => '<button data-act="org-sector" data-k="' + k + '"' + (state.k === k ? ' class="on"' : '') + '>' + esc(label) + '</button>';
    const sortBtn = (s, label) => '<button data-act="org-sort" data-s="' + s + '"' + (state.s === s ? ' class="on"' : '') + '>' + esc(label) + '</button>';
    const board = '<div class="geo-otools">' +
      '<label class="field">' + icon('search') + '<input id="geo-oq" type="search" inputmode="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Filter by name" aria-label="Filter organizations by name" value="' + esc(state.q) + '">' +
      '<button class="iconbtn" data-act="org-clearq" aria-label="Clear the name filter"' + (state.q ? '' : ' hidden') + '>' + icon('x') + '</button></label>' +
      '<div class="seg geo-oseg" role="group" aria-label="Sector">' + segBtn('all', 'All') + SECTORS.map(s => segBtn(s.k, s.many)).join('') + '</div>' +
      '<div class="geo-osort"><span>Sort by</span><div class="seg" role="group" aria-label="Sort by">' + sortBtn('np', 'Contributors') + sortBtn('ni', 'Program items') + '</div></div>' +
      '</div><div class="geo-ocount" id="geo-ocount"></div><div id="geo-olist"></div>';

    el.innerHTML =
      '<p class="lead geo-lede"><b>' + NUM(active.length) + '</b> organizations stand behind the ' + NUM(DB.people.length) + ' people in the SC26 program: ' +
      NUM(orgCount.edu) + ' universities, ' + NUM(orgCount.lab) + ' labs and research centers, ' + NUM(orgCount.com) + ' companies and ' + NUM(orgCount.oth) + ' others.' +
      (lead ? ' The largest group comes from <b>' + esc(lead.n) + '</b>, with ' + NUM(lead.np) + ' contributors.' : '') +
      (idle ? ' Another ' + NUM(idle) + ' are listed without contributors' + (idleEx ? ', ' + (idleEx === idle ? 'all' : NUM(idleEx)) + ' of them exhibitors' : '') + '.' : '') + '</p>' +
      section('Contributors by sector', '<div class="card pad">' + stack + '</div>') +
      section('Top 15 organizations', chart, { sub: 'by contributors' }) +
      section('All organizations', board) +
      '<p class="note geo-note" id="geo-onote">The sector (university, lab, industry, other) is estimated from the organization name, so some organizations may be filed under the wrong one.</p>';

    const listEl = el.querySelector('#geo-olist'), countEl = el.querySelector('#geo-ocount');
    let dispose = null;
    function renderList() {
      if (dispose) { dispose(); dispose = null; }
      const q = norm(state.q).trim().split(/\s+/).filter(Boolean);
      const other = state.s === 'np' ? 'ni' : 'np';
      const list = orgs.filter(o => (state.k === 'all' || (SEC[o.k] ? o.k : 'oth') === state.k) && q.every(t => names.get(o.i).includes(t)))
        .sort((a, b) => b[state.s] - a[state.s] || b[other] - a[other] || a.n.localeCompare(b.n));
      const what = state.k === 'all' ? 'organization' + (list.length === 1 ? '' : 's')
        : { edu: list.length === 1 ? 'university' : 'universities', lab: list.length === 1 ? 'lab or research center' : 'labs and research centers', com: list.length === 1 ? 'company' : 'companies', oth: list.length === 1 ? 'other organization' : 'other organizations' }[state.k];
      countEl.dataset.total = String(list.length);
      countEl.innerHTML = '<b>' + NUM(list.length) + '</b> ' + what + (state.q.trim() ? ' matching “' + esc(state.q.trim()) + '”' : '') +
        ', most ' + (state.s === 'np' ? 'contributors' : 'program items') + ' first';
      if (!list.length) {
        listEl.innerHTML = emptyState('search', 'No organizations match', 'Try a shorter name or another sector.',
          '<button class="btn sm" data-act="org-reset">Clear filters</button>');
        return;
      }
      listEl.innerHTML = '<div class="card list"></div>';
      dispose = lazyList(listEl.firstChild, list.length, (a, b) => list.slice(a, b).map((o, j) => {
        const rank = a + j + 1, sector = SHORT[SEC[o.k] ? o.k : 'oth'];
        const sub = o.np ? '#' + rank + ' · ' + sector + ' · ' +
          (state.s === 'np' ? NUM(o.ni) + ' item' + (o.ni === 1 ? '' : 's') : NUM(o.np) + ' contributor' + (o.np === 1 ? '' : 's'))
          : sector + ' · ' + (o.booth ? 'exhibitor, booth ' + esc(o.booth) : o.ex ? 'exhibitor' : 'no contributors listed');
        const right = state.s === 'np' ? '<b>' + NUM(o.np) + '</b>' + (o.np === 1 ? 'person' : 'people') : '<b>' + NUM(o.ni) + '</b>' + (o.ni === 1 ? 'item' : 'items');
        return orgRow(o, { sub, right });
      }).join(''), 30);
    }
    const sync = () => setQuery({ k: state.k === 'all' ? null : state.k, s: state.s === 'ni' ? 'ni' : null, q: state.q.trim() || null });
    const marks = () => {
      el.querySelectorAll('[data-act="org-sector"]').forEach(b => b.classList.toggle('on', b.dataset.k === state.k));
      el.querySelectorAll('[data-act="org-sort"]').forEach(b => b.classList.toggle('on', b.dataset.s === state.s));
    };

    ctx.on('org-sector', t => { state.k = t.dataset.k; marks(); sync(); renderList(); });
    ctx.on('org-sort', t => { state.s = t.dataset.s; marks(); sync(); renderList(); });
    ctx.on('org-reset', () => { state.q = ''; state.k = 'all'; input.value = ''; clearBtn.hidden = true; marks(); sync(); renderList(); });
    ctx.on('org-clearq', () => { state.q = ''; input.value = ''; clearBtn.hidden = true; sync(); renderList(); input.focus(); });

    const input = el.querySelector('#geo-oq'), clearBtn = el.querySelector('[data-act="org-clearq"]');
    let timer = 0;
    const onInput = () => {
      state.q = input.value;
      clearBtn.hidden = !input.value;
      clearTimeout(timer);
      timer = setTimeout(() => { sync(); renderList(); }, 90);
    };
    const onKey = e => { if (e.key === 'Enter') input.blur(); };
    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onKey);
    renderList();

    return () => {
      clearTimeout(timer);
      if (dispose) dispose();
      input.removeEventListener('input', onInput);
      input.removeEventListener('keydown', onKey);
    };
  },
});
