// Poster gallery: research posters, student competition, doctoral showcase, e-posters and art.
import { DB, FLAG, fmtOf, interestProfile, relevance, searchItems, speakersOf, posterUrl } from '../core.js';
import { registerView, setQuery } from '../router.js';
import { esc, icon, chip, emptyState, lazyList, starBtn, section, itemCard } from '../ui.js';

const memo = { kind: 'all', th: '', q: '', sort: 'match' };

function allPosters() {
  return DB.items.filter(it => it.k === 'P' && !it.brk && ((it.fl & FLAG.POSTER) || fmtOf(it).id === 'poster' || fmtOf(it).id === 'art'));
}
function kindOf(it) { return it.sub || (fmtOf(it).id === 'art' ? 'Art of HPC' : 'Poster'); }

function tile(it, score) {
  const th = it.th.length ? DB.themes[it.th[0][0]] : null;
  const sp = speakersOf(it, 2);
  const url = posterUrl(it);
  // the placeholder sits underneath; an image that fails to load removes itself
  const img = '<div class="ptile-ph" style="--c:' + (th ? th.c : '#818CF8') + '">' + icon('image') + (url ? '<img loading="lazy" alt="" src="' + esc(url) + '" onload="this.classList.add(\'ok\')" onerror="this.remove()">' : '') + '</div>';
  return '<div class="ptile card" data-go="#/item/' + esc(it.id) + '">' + img +
    '<div class="ptile-b"><span class="ptile-k">' + esc(kindOf(it)) + (score != null && score >= 0.45 ? ' · <em>' + Math.round(score * 100) + '% match</em>' : '') + '</span>' +
    '<b>' + esc(it.t) + '</b>' + (sp.length ? '<span class="ptile-w">' + esc(sp.map(p => p.n).join(', ')) + '</span>' : '') +
    (th ? '<span class="ptile-t" style="--c:' + th.c + '">' + esc(th.n) + '</span>' : '') + '</div>' + starBtn(it, 'sm') + '</div>';
}

registerView('posters', {
  title: 'Posters', tab: 'explore',
  render(el, ctx) {
    if (ctx.query.kind != null) memo.kind = ctx.query.kind || 'all';
    if (ctx.query.th != null) memo.th = ctx.query.th;
    if (ctx.query.q != null) memo.q = ctx.query.q;
    const posters = allPosters();
    const kinds = Array.from(new Set(posters.map(kindOf))).sort();
    const prof = interestProfile();
    const score = new Map(prof.empty ? [] : posters.map(it => [it.i, relevance(it, prof).score]));
    const sessions = Array.from(new Set(posters.flatMap(it => [it.par].concat(it.alt || [])))).map(i => DB.items[i]).filter(Boolean).sort((a, b) => a.s - b.s);
    el.innerHTML = '<p class="lead">' + posters.length + ' posters and artworks. They stay on display for several days, so drop by between sessions.</p>' +
      '<div class="field">' + icon('search') + '<input id="po-q" type="search" autocomplete="off" autocapitalize="off" placeholder="Search posters" value="' + esc(memo.q) + '"></div>' +
      '<div class="hscroll" style="margin:10px -14px 4px" id="po-kinds"></div><div class="hscroll" id="po-themes" style="margin-bottom:10px"></div>' +
      '<div id="po-grid" class="pgrid"></div>' +
      section('When and where', sessions.map(s => itemCard(s, { showDay: true, dense: true })).join(''));
    const grid = el.querySelector('#po-grid'), input = el.querySelector('#po-q');
    let stop = null, timer = null;
    const draw = () => {
      if (stop) { stop(); stop = null; }
      setQuery({ kind: memo.kind === 'all' ? '' : memo.kind, th: memo.th, q: memo.q });
      let list = posters;
      if (memo.q.trim()) { const hit = new Set(searchItems(memo.q, { limit: 2000 }).map(r => r.it.i)); list = list.filter(it => hit.has(it.i)); }
      const forThemes = list.filter(it => memo.kind === 'all' || kindOf(it) === memo.kind);
      const tc = new Map();
      for (const it of forThemes) for (const [t] of it.th.slice(0, 2)) tc.set(t, (tc.get(t) || 0) + 1);
      el.querySelector('#po-kinds').innerHTML = chip('All', { act: 'po-kind', id: 'all', on: memo.kind === 'all', count: list.length }) +
        kinds.map(k => chip(k, { act: 'po-kind', id: k, on: memo.kind === k, count: list.filter(it => kindOf(it) === k).length })).join('');
      el.querySelector('#po-themes').innerHTML = Array.from(tc.entries()).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([t, n]) =>
        chip(DB.themes[t].n, { act: 'po-th', id: DB.themes[t].id, color: DB.themes[t].c, on: memo.th === DB.themes[t].id, count: n, cls: 'sm' })).join('');
      list = forThemes;
      if (memo.th && DB.themeIdx[memo.th] != null) { const ti = DB.themeIdx[memo.th]; list = list.filter(it => it.th.some(([t]) => t === ti)); }
      list = list.slice().sort((a, b) => (score.get(b.i) || 0) - (score.get(a.i) || 0) || (b.img ? 1 : 0) - (a.img ? 1 : 0) || a.t.localeCompare(b.t));
      grid.innerHTML = '';
      if (!list.length) { grid.innerHTML = emptyState('image', 'No posters match', 'Try another kind, theme or search term.'); return; }
      stop = lazyList(grid, list.length, (a, b) => list.slice(a, b).map(it => tile(it, score.get(it.i))).join(''), 16);
    };
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { memo.q = input.value; draw(); }, 160); });
    ctx.on('po-kind', t => { memo.kind = t.dataset.id; memo.th = ''; draw(); });
    ctx.on('po-th', t => { memo.th = memo.th === t.dataset.id ? '' : t.dataset.id; draw(); });
    draw();
    return () => { clearTimeout(timer); if (stop) stop(); };
  },
});
