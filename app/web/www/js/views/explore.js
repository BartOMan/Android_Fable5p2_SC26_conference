// Explore: the hub for every cross-section of the program, with a few live facts.
import { DB, visible, dayInfo, dayOf, minOfDay, fmtClock, flagOf } from '../core.js';
import { registerView } from '../router.js';
import { esc, icon, section, avatar } from '../ui.js';

function facts() {
  const leaf = DB.items.filter(it => it.leaf && visible(it));
  const themes = DB.themes.map(t => ({ t, n: t.items.filter(i => DB.items[i].leaf && visible(DB.items[i])).length })).sort((a, b) => b.n - a.n);
  // busiest quarter hour of the week (every visible session counts, as on the pulse screen)
  const bins = new Map();
  for (const it of DB.items) {
    if (it.k !== 'S' || !visible(it)) continue;
    for (let m = Math.floor(it.s / 15) * 15; m < it.e; m += 15) bins.set(m, (bins.get(m) || 0) + 1);
  }
  let peak = [0, 0];
  for (const [m, n] of Array.from(bins.entries()).sort((x, y) => x[0] - y[0])) if (n > peak[1]) peak = [m, n];
  const countries = DB.countries.slice().sort((a, b) => b.np - a.np);
  const orgs = DB.orgs.slice().sort((a, b) => b.np - a.np);
  const multi = leaf.filter(it => new Set(it.p.map(([pi]) => DB.people[pi].c).filter(c => c >= 0)).size >= 3).length;
  return { leaf, themes, peak, countries, orgs, multi };
}

registerView('explore', {
  title: 'Explore', tab: 'explore', root: true,
  render(el) {
    const f = facts();
    const top = f.themes.slice(0, 3);
    const peakDay = dayInfo(dayOf(f.peak[0]));
    const peakClock = fmtClock(minOfDay(f.peak[0]));
    const stars = DB.people.slice().sort((a, b) => b.w - a.w).slice(0, 5);
    let h = '<div class="card ex-hero" data-go="#/galaxy"><div class="ex-hero-stars" id="ex-stars"></div><div class="ex-hero-txt"><span class="pill" style="--c:#22D3EE">Start here</span>' +
      '<h2>The topic galaxy</h2><p>' + f.leaf.filter(it => it.x).length.toLocaleString('en-US') + ' talks and posters placed by what they are about. Zoom, tap, follow the threads.</p>' +
      '<b>Open the map ' + icon('chevR') + '</b></div></div>';

    h += section('Right now at SC26', '<div class="facts">' +
      '<div class="fact" data-go="#/theme/' + top[0].t.id + '" style="--c:' + top[0].t.c + '"><i>Biggest theme</i><b>' + esc(top[0].t.n) + '</b><span>' + top[0].n + ' talks, ahead of ' + esc(top[1].t.n) + ' (' + top[1].n + ')</span></div>' +
      '<div class="fact" data-go="#/pulse" style="--c:#FB923C"><i>Busiest moment</i><b>' + peakDay.dow + ' ' + peakClock + '</b><span>' + f.peak[1] + ' sessions running in parallel</span></div>' +
      '<div class="fact" data-go="#/globe" style="--c:#34D399"><i>Most represented</i><b>' + f.countries.slice(0, 3).map(c => flagOf(c)).join(' ') + '</b><span>' + f.countries.slice(0, 3).map(c => esc(c.name) + ' ' + c.np).join(' · ') + '</span></div>' +
      '<div class="fact" data-go="#/orgs" style="--c:#818CF8"><i>Largest delegation</i><b>' + esc(f.orgs[0].n.replace(/\s*\(.*\)/, '')) + '</b><span>' + f.orgs[0].np + ' contributors, then ' + esc(f.orgs[1].n.replace(/\s*\(.*\)/, '')) + ' (' + f.orgs[1].np + ')</span></div>' +
      '<div class="fact" data-go="#/network" style="--c:#F472B6"><i>Cross-border work</i><b>' + f.multi + ' talks</b><span>have authors from three or more countries</span></div>' +
      '</div>');

    const tiles = (list) => '<div class="grid2">' + list.map(([go, ic, c, t, s]) =>
      '<div class="tile" data-go="' + go + '" style="--c:' + c + '">' + icon(ic) + '<b>' + t + '</b><span>' + s + '</span></div>').join('') + '</div>';
    h += section('Topics', tiles([
      ['#/themes', 'target', '#22D3EE', 'Themes', DB.themes.length + ' research themes and the official tags'],
      ['#/heatmap', 'grid', '#FB923C', 'Topics by day', 'When each theme peaks'],
      ['#/buzz', 'zap', '#FACC15', 'Buzzwords', 'The words in this year\'s titles'],
      ['#/formats', 'chart', '#A78BFA', 'Formats', 'Papers, workshops, BoFs and more'],
      ['#/pulse', 'flame', '#FB7185', 'Conference pulse', 'How busy each hour is'],
      ['#/posters', 'image', '#F472B6', 'Posters', 'Research, student and art posters'],
    ]));
    h += section('People and places', tiles([
      ['#/globe', 'globe', '#34D399', 'World of SC26', DB.countries.length + ' countries on a globe'],
      ['#/orgs', 'building', '#818CF8', 'Organizations', 'Universities, labs and industry'],
      ['#/network', 'network', '#C084FC', 'Collaboration network', 'Who works with whom'],
      ['#/people?tab=veterans', 'award', '#FACC15', 'SC veterans', 'The longest SC paper records'],
      ['#/people?tab=foryou', 'users', '#22D3EE', 'People to meet', 'Matched to your interests'],
      ['#/map', 'pin', '#2DD4BF', 'Venue map', 'Floor plans with every room'],
    ]));
    h += section('Most active this year', '<div class="hscroll">' + stars.map(p =>
      '<div class="pchip big" data-go="#/person/' + esc(p.id) + '">' + avatar(p, 64) + '<span>' + esc(p.n) + '</span><i>' + p.ni + ' items</i></div>').join('') + '</div>',
    { moreGo: '#/people?tab=active', more: 'Ranking' });
    el.innerHTML = h;

    // a sprinkle of real galaxy points behind the hero card
    const host = el.querySelector('#ex-stars');
    const pts = f.leaf.filter(it => it.x);
    let dots = '';
    for (let i = 0; i < pts.length; i += 3) {
      const it = pts[i]; const c = it.th.length ? DB.themes[it.th[0][0]].c : '#8892b8';
      dots += '<i style="left:' + (it.x[0] / 10) + '%;top:' + (it.x[1] / 10) + '%;background:' + c + '"></i>';
    }
    host.innerHTML = dots;
  },
});
