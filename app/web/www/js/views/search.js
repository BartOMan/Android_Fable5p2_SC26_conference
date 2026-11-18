// Search across talks, sessions, people, organizations and themes.
import { DB, Store, searchItems, searchPeople, searchOrgs, searchThemes, visible, warmSearch, fmtOf, dayInfo } from '../core.js';
import { registerView, setQuery } from '../router.js';
import { esc, icon, itemCard, personRow, orgRow, chip, section, emptyState, lazyList } from '../ui.js';

const KINDS = [['all', 'Everything'], ['S', 'Sessions'], ['P', 'Talks'], ['poster', 'Posters']];
let memo = { kind: 'all', day: -1 };

registerView('search', {
  title: 'Search', tab: 'schedule',
  render(el, ctx) {
    let q = ctx.query.q || '';
    el.innerHTML = '<div class="field search-field">' + icon('search') + '<input id="q" type="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Talks, people, organizations, topics" value="' + esc(q) + '">' +
      '<button class="iconbtn" id="q-clear" aria-label="Clear" style="display:none">' + icon('x') + '</button></div><div id="s-body"></div>';
    const input = el.querySelector('#q'), body = el.querySelector('#s-body'), clear = el.querySelector('#q-clear');
    let stop = null, timer = null;

    const idle = () => {
      const recent = Store.state.recent || [];
      body.innerHTML =
        (recent.length ? section('Recent', '<div class="chips">' + recent.map(r => chip(r, { act: 's-fill', id: r, icon: 'clock' })).join('') + '</div>') : '') +
        section('Popular in this year\'s titles', '<div class="chips">' + DB.buzz.slice(0, 24).map(([t]) => chip(t, { act: 's-fill', id: t })).join('') + '</div>') +
        section('Try', '<div class="chips">' + ['Gordon Bell', 'Kokkos', 'checkpointing', 'CXL memory', 'Argonne', 'digital twin', 'W375de', 'Fortran'].map(t => chip(t, { act: 's-fill', id: t })).join('') + '</div>') +
        '<p class="note" style="margin-top:18px">Search reads titles, abstracts, speaker names, organizations, rooms and topics. It works offline.</p>';
    };

    const run = () => {
      if (stop) { stop(); stop = null; }
      q = input.value.trim();
      clear.style.display = q ? '' : 'none';
      setQuery({ q });
      if (!q) { idle(); return; }
      const themes = searchThemes(q);
      const people = searchPeople(q, 40);
      const orgs = searchOrgs(q, 12);
      let res = searchItems(q, { limit: 300, filter: it => visible(it) || !Store.state.settings.techOnly });
      const total = res.length;
      const days = Array.from(new Set(res.map(r => r.it.day))).sort((a, b) => a - b);
      if (memo.kind === 'poster') res = res.filter(r => fmtOf(r.it).id === 'poster' || fmtOf(r.it).id === 'art');
      else if (memo.kind !== 'all') res = res.filter(r => r.it.k === memo.kind);
      if (memo.day >= 0) res = res.filter(r => r.it.day === memo.day);
      let h = '';
      if (themes.length) h += section('Themes', '<div class="chips">' + themes.map(t => chip(t.n, { go: '#/theme/' + t.id, color: t.c, count: t.items.length })).join('') + '</div>');
      if (people.length) {
        h += section('People', '<div class="card list">' + people.slice(0, 4).map(p => personRow(p)).join('') + '</div>' +
          (people.length > 4 ? '<button class="link" data-go="#/people?q=' + encodeURIComponent(q) + '">All matching people' + icon('chevR') + '</button>' : ''), { sub: people.length >= 40 ? '40+' : String(people.length) });
      }
      if (orgs.length) h += section('Organizations', '<div class="card list">' + orgs.slice(0, 3).map(o => orgRow(o)).join('') + '</div>', { sub: String(orgs.length) });
      h += '<section class="sec"><div class="sec-h"><h2>Program</h2><span class="sec-sub">' + res.length + (total >= 300 ? '+' : '') + ' results</span></div>' +
        '<div class="hscroll" style="margin-bottom:10px">' + KINDS.map(([k, n]) => chip(n, { act: 's-kind', id: k, on: memo.kind === k })).join('') +
        (days.length > 1 ? '<span class="vsep"></span>' + chip('Any day', { act: 's-day', id: -1, on: memo.day < 0 }) + days.map(d => chip(dayInfo(d).dow + ' ' + dayInfo(d).date, { act: 's-day', id: d, on: memo.day === d })).join('') : '') +
        '</div><div id="s-items"></div></section>';
      if (!themes.length && !people.length && !orgs.length && !total) {
        body.innerHTML = emptyState('search', 'No matches', 'Nothing in the program matches “' + esc(q) + '”. Try a shorter or more general term.');
        return;
      }
      body.innerHTML = h;
      const host = body.querySelector('#s-items');
      if (!res.length) host.innerHTML = '<p class="muted" style="padding:8px 2px">No program items with these filters.</p>';
      else stop = lazyList(host, res.length, (a, b) => res.slice(a, b).map(r => itemCard(r.it, { showDay: true, parent: true, dense: true })).join(''), 25);
    };

    const remember = () => {
      const v = input.value.trim(); if (v.length < 2) return;
      const r = (Store.state.recent || []).filter(x => x.toLowerCase() !== v.toLowerCase());
      r.unshift(v); Store.state.recent = r.slice(0, 8); Store.save();
    };
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 140); });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { remember(); input.blur(); } });
    clear.addEventListener('click', () => { input.value = ''; run(); input.focus(); });
    ctx.on('s-fill', t => { input.value = t.dataset.id; remember(); run(); });
    ctx.on('s-kind', t => { memo.kind = t.dataset.id; run(); });
    ctx.on('s-day', t => { memo.day = +t.dataset.id; run(); });
    // leaving through a result counts as a completed search
    body.addEventListener('click', e => { if (e.target.closest('[data-go]')) remember(); }, true);

    warmSearch();
    run();
    if (!q && !ctx.isBack) setTimeout(() => { if (ctx.alive()) input.focus(); }, 250);
    return () => { clearTimeout(timer); if (stop) stop(); };
  },
});
