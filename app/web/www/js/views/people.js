// People: who is active, who has a long SC record, and who matches your interests.
import {
  DB, Follows, nowMin, dayInfo, fmtTime, roomOf, searchPeople, interestProfile, relevance, flagOf, norm, tokens,
} from '../core.js';
import { registerView, setQuery } from '../router.js';
import { esc, icon, personRow, chip, emptyState, openSheet, closeSheet, lazyList, section, avatar } from '../ui.js';

const TABS = [['active', 'Most active'], ['veterans', 'SC veterans'], ['foryou', 'For you'], ['all', 'A to Z']];
const memo = { tab: 'active', c: -1, q: '' };

/** Next (or, failing that, most recent) appearance of a person as short text. */
export function nextAppearance(p, now = nowMin()) {
  const its = p.items.map(([i]) => DB.items[i]).filter(it => !it.brk);
  if (!its.length) return null;
  const up = its.filter(it => it.e > now).sort((a, b) => a.s - b.s)[0];
  const it = up || its[its.length - 1];
  const r = roomOf(it);
  return { it, upcoming: !!up, text: (up ? (it.s <= now ? 'Now' : dayInfo(it.day).dow + ' ' + fmtTime(it.s)) : 'Was ' + dayInfo(it.day).dow + ' ' + fmtTime(it.s)) + (r ? ' · ' + r.n : '') };
}

function forYou() {
  const prof = interestProfile();
  if (prof.empty) return null;
  const sc = new Map();
  const cache = new Map();
  for (const p of DB.people) {
    let s = 0, n = 0;
    for (const [i, role, pres] of p.items) {
      const it = DB.items[i]; if (it.brk) continue;
      let r = cache.get(i); if (r == null) { r = relevance(it, prof).score; cache.set(i, r); }
      if (r < 0.45) continue;
      s += r * (pres ? 1.5 : 1) * (DB.roles[role] === 'chair' ? 0.5 : 1); n++;
    }
    if (n) sc.set(p.i, [s, n]);
  }
  return Array.from(sc.entries()).sort((a, b) => b[1][0] - a[1][0]).slice(0, 80).map(([i, [s, n]]) => ({ p: DB.people[i], s, n }));
}

registerView('people', {
  title: 'People', tab: 'people', root: true,
  render(el, ctx) {
    if (ctx.query.tab && TABS.some(t => t[0] === ctx.query.tab)) memo.tab = ctx.query.tab;
    if (ctx.query.q != null) memo.q = ctx.query.q;
    if (ctx.query.c != null && ctx.query.c !== '') memo.c = +ctx.query.c;
    const withPhoto = DB.people.filter(p => p.ph).length;
    el.innerHTML = '<div class="field">' + icon('search') + '<input id="pq" type="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Find one of ' + DB.people.length.toLocaleString('en-US') + ' contributors" value="' + esc(memo.q) + '"></div>' +
      '<div class="hscroll" style="margin-top:10px" id="ptabs"></div><div id="pbody" style="margin-top:6px"></div>';
    const input = el.querySelector('#pq'), body = el.querySelector('#pbody'), tabs = el.querySelector('#ptabs');
    let stop = null, timer = null;

    const draw = () => {
      if (stop) { stop(); stop = null; }
      setQuery({ tab: memo.tab, q: memo.q, c: memo.c >= 0 ? memo.c : '' });
      const country = memo.c >= 0 ? DB.countries[memo.c] : null;
      tabs.innerHTML = TABS.map(([id, n]) => chip(n, { act: 'p-tab', id, on: memo.tab === id && !memo.q })).join('') +
        '<span class="vsep"></span>' + chip(country ? flagOf(country) + ' ' + country.name : 'Any country', { act: 'p-country', icon: country ? null : 'globe', on: !!country });
      const inCountry = p => !country || p.c === country.i;
      let h = '';
      if (memo.q.trim()) {
        const res = searchPeople(memo.q, 200).filter(inCountry);
        // also match by organization name
        const toks = tokens(memo.q);
        const byOrg = toks.length ? DB.people.filter(p => inCountry(p) && !res.includes(p) && p.o.some(o => { const n = norm(DB.orgs[o].n); return toks.every(t => n.includes(t)); })).sort((a, b) => b.w - a.w).slice(0, 150) : [];
        const all = res.concat(byOrg);
        if (!all.length) { body.innerHTML = emptyState('users', 'No one found', 'No contributor or organization matches “' + esc(memo.q) + '”.'); return; }
        body.innerHTML = '<div class="card list" id="plist"></div>';
        stop = lazyList(body.querySelector('#plist'), all.length, (a, b) => all.slice(a, b).map(p => personRow(p, { right: p.ni + (p.ni === 1 ? ' item' : ' items') })).join(''), 40);
        return;
      }
      const follows = DB.people.filter(p => Follows.hasPerson(p.id));
      if (follows.length && memo.tab !== 'all') {
        h += section('Following', '<div class="hscroll">' + follows.map(p => '<div class="pchip" data-go="#/person/' + esc(p.id) + '">' + avatar(p, 54) + '<span>' + esc(p.n.split(' ')[0]) + '</span></div>').join('') + '</div>');
      }
      if (memo.tab === 'active') {
        const list = DB.people.filter(p => inCountry(p) && p.ni > 0).sort((a, b) => b.w - a.w).slice(0, 300);
        h += '<p class="lead">Ranked by how much each person does at SC26. Keynotes, papers and talks count more than posters or chairing.</p><div class="card list" id="plist"></div>';
        body.innerHTML = h;
        stop = lazyList(body.querySelector('#plist'), list.length, (a, b) => list.slice(a, b).map((p, k) => {
          const nx = nextAppearance(p);
          return personRow(p, { sub: esc(p.o.length ? DB.orgs[p.o[0]].n : ''), right: '<b>' + p.ni + '</b>' + (p.ni === 1 ? 'item' : 'items'), rank: a + k + 1 }) +
            (nx && nx.upcoming ? '<div class="row-next" data-go="#/item/' + esc(nx.it.id) + '">' + icon('pin') + '<span>' + esc(nx.text) + ' · ' + esc(nx.it.t) + '</span></div>' : '');
        }).join(''), 30);
      } else if (memo.tab === 'veterans') {
        const list = DB.people.filter(p => inCountry(p) && p.sc).sort((a, b) => b.sc[0] - a.sc[0] || b.sc[3] - a.sc[3]).slice(0, 300);
        h += '<p class="lead">SC26 contributors with the most papers in earlier SC proceedings (2010 to 2025). Good people to ask about how the field got here.</p><div class="card list" id="plist"></div>' +
          '<p class="note" style="margin-top:10px">Counts come from OpenAlex and are matched by name, so they are estimates. Recent years include workshop papers. Namesakes can inflate a count.</p>';
        body.innerHTML = h;
        stop = lazyList(body.querySelector('#plist'), list.length, (a, b) => list.slice(a, b).map(p =>
          personRow(p, { sub: esc(p.sc[1] + '–' + p.sc[2]) + ' · ' + p.sc[3].toLocaleString('en-US') + ' citations · ' + esc(p.o.length ? DB.orgs[p.o[0]].n : ''), right: '<b>' + p.sc[0] + '</b>SC papers' })).join(''), 30);
      } else if (memo.tab === 'foryou') {
        const res = forYou();
        if (!res) {
          body.innerHTML = h + emptyState('target', 'Tell the app what you like', 'Pick a few themes and this list fills with the people presenting on them, with the room and time of their next session.',
            '<button class="btn primary" data-go="#/builder">Pick my interests</button>');
          return;
        }
        const list = res.filter(x => inCountry(x.p));
        if (!list.length) { body.innerHTML = h + emptyState('users', 'No match here', 'No one from this country presents on your interests. Clear the country filter to see everyone.'); return; }
        h += '<p class="lead">People presenting on your interests, strongest match first. The line under each name says where to catch them next.</p><div class="card list" id="plist"></div>';
        body.innerHTML = h;
        stop = lazyList(body.querySelector('#plist'), list.length, (a, b) => list.slice(a, b).map(({ p, n }) => {
          const nx = nextAppearance(p);
          return personRow(p, { sub: esc(p.o.length ? DB.orgs[p.o[0]].n : ''), right: '<b>' + n + '</b>' + (n === 1 ? 'match' : 'matches') }) +
            (nx ? '<div class="row-next' + (nx.upcoming ? '' : ' past') + '" data-go="#/item/' + esc(nx.it.id) + '">' + icon('pin') + '<span>' + esc(nx.text) + ' · ' + esc(nx.it.t) + '</span></div>' : '');
        }).join(''), 30);
      } else {
        const list = DB.people.filter(inCountry);
        h += '<p class="lead">' + list.length.toLocaleString('en-US') + ' contributors' + (country ? ' from ' + esc(country.name) : '') + ', by family name. ' + (withPhoto ? withPhoto + ' have a photo.' : '') + '</p><div class="card list" id="plist"></div>';
        body.innerHTML = h;
        stop = lazyList(body.querySelector('#plist'), list.length, (a, b) => list.slice(a, b).map(p => personRow(p, { size: 38 })).join(''), 60);
      }
    };

    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { memo.q = input.value; draw(); }, 140); });
    ctx.on('p-tab', t => { memo.tab = t.dataset.id; memo.q = ''; input.value = ''; draw(); document.getElementById('view').scrollTop = 0; });
    ctx.on('p-country', () => {
      const list = DB.countries.slice().sort((a, b) => b.np - a.np);
      openSheet('<div class="card list">' + '<div class="row" data-act="p-setc" data-id="-1"><span class="av sq" style="--s:38px;--h:210">' + icon('globe') + '</span><div class="row-main"><div class="row-title">Any country</div></div></div>' +
        list.map(c => '<div class="row" data-act="p-setc" data-id="' + c.i + '"><span class="flagbig">' + flagOf(c) + '</span><div class="row-main"><div class="row-title">' + esc(c.name) + '</div></div><div class="row-right">' + c.np + '</div></div>').join('') + '</div>',
      { title: 'Filter by country', tall: true });
    });
    ctx.on('p-setc', t => { memo.c = +t.dataset.id; closeSheet(); draw(); });
    draw();
    return () => { clearTimeout(timer); if (stop) stop(); };
  },
});
