// Today: live clock, what is on now, what is next in your plan, headliners, shortcuts.
import {
  DB, Plan, nowMin, dayOf, dayInfo, fmtTime, fmtRange, fmtClock, minOfDay, visible, roomOf, fmtOf, relevance,
  interestProfile, walkMin, Store,
} from '../core.js';
import { registerView } from '../router.js';
import { esc, icon, itemCard, section, statTile, countUp, fmtPill, relBadge, starBtn } from '../ui.js';
import { showWelcome } from './settings.js';

const HEADLINE = new Set(['keynote', 'plenary', 'invited', 'award', 'gb']);
let counted = false;

function hcard(it, sub) {
  const f = fmtOf(it); const r = roomOf(it);
  return '<div class="card hcard" data-go="#/item/' + esc(it.id) + '" style="--c:' + f.c + '">' +
    '<div class="it-meta">' + fmtPill(it) + relBadge(it) + '</div>' +
    '<div class="it-title">' + esc(it.t) + '</div>' +
    (sub ? '<div class="hcard-now">' + sub + '</div>' : '') +
    '<div class="hcard-foot"><span>' + fmtRange(it.s, it.e) + '</span>' + (r ? '<span class="loc">' + icon('pin') + esc(r.n) + '</span>' : '') + starBtn(it, 'sm') + '</div></div>';
}

function rank(list, prof) {
  if (prof.empty) return list.sort((a, b) => (HEADLINE.has(fmtOf(b).id) - HEADLINE.has(fmtOf(a).id)) || a.s - b.s || a.f - b.f);
  const sc = new Map(list.map(it => [it.i, relevance(it, prof).score]));
  return list.sort((a, b) => sc.get(b.i) - sc.get(a.i) || a.s - b.s);
}

registerView('home', {
  title: 'Today', tab: 'home', root: true,
  render(el, ctx) {
    const now = nowMin();
    const before = now < DB.start, after = now >= DB.end;
    const today = Math.max(0, Math.min(DB.nDays - 1, dayOf(now)));
    const di = dayInfo(today);
    const sessions = DB.items.filter(it => it.k === 'S' && visible(it));
    const prof = interestProfile();
    let html = '';

    // ---- hero
    const dayItems = sessions.filter(it => it.day === today);
    let prog = 0, heroSub = '';
    if (before) {
      const mins = DB.start - now; const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60);
      heroSub = 'SC26 starts in ' + (d ? d + ' d ' : '') + h + ' h';
    } else if (after) {
      heroSub = 'SC26 has wrapped. The whole program stays browsable.';
      prog = 1;
    } else if (dayItems.length) {
      const lo = Math.min(...dayItems.map(it => it.s)), hi = Math.max(...dayItems.map(it => it.e));
      prog = Math.max(0, Math.min(1, (now - lo) / (hi - lo)));
      const live = dayItems.filter(it => it.s <= now && now < it.e).length;
      heroSub = live ? live + ' sessions running right now' : (now < lo ? 'First session at ' + fmtTime(lo) : 'Sessions are done for today');
    }
    const sim = Store.state.settings.sim;
    html += '<div class="hero card glow"><div class="hero-row"><div><div class="hero-day">' + esc(di.dowLong) + '</div>' +
      '<div class="hero-date">' + di.mon + ' ' + di.date + ' · Chicago</div></div>' +
      '<div class="hero-clock"><b>' + fmtClock(minOfDay(now)).replace(' ', '<small>') + '</small></b><span>' + (sim ? 'simulated time' : 'conference time (CST)') + '</span></div></div>' +
      '<div class="hero-prog"><i style="width:' + Math.round(prog * 100) + '%"></i></div>' +
      '<div class="hero-sub">' + esc(heroSub) + '</div></div>';

    // ---- next in my plan
    const plan = Plan.items();
    const upcoming = plan.filter(it => it.e > now);
    if (upcoming.length) {
      const nx = upcoming[0]; const r = roomOf(nx);
      const live = nx.s <= now;
      const mins = nx.s - now;
      const prev = plan.filter(it => it.e <= nx.s && it.day === nx.day).pop();
      const walk = prev && roomOf(prev) && r ? walkMin(roomOf(prev), r) : null;
      html += section('Next in your plan', '<div class="card next" data-go="#/item/' + esc(nx.id) + '" style="--c:' + fmtOf(nx).c + '">' +
        '<div class="next-when">' + (live ? '<b class="live">Live</b><span>until ' + fmtTime(nx.e) + '</span>'
          : (mins < 600 ? '<b>' + (mins >= 60 ? Math.floor(mins / 60) + '<small>h</small> ' : '') + (mins % 60) + '<small>min</small></b>' : '<b>' + dayInfo(nx.day).dow + '</b>') + '<span>' + fmtTime(nx.s) + '</span>') + '</div>' +
        '<div class="next-main"><div class="it-meta">' + fmtPill(nx) + '</div><div class="it-title">' + esc(nx.t) + '</div>' +
        '<div class="it-sub">' + (r ? '<span class="loc">' + icon('pin') + esc(r.n) + (r.f ? ' · ' + esc(r.b.replace(' Building', '')) + ' ' + esc(r.f) : '') + '</span>' : '') +
        (walk ? '<span>' + icon('walk') + ' about ' + walk + ' min from ' + esc(roomOf(prev).n) + '</span>' : '') + '</div></div>' +
        (r ? '<button class="iconbtn" data-go="#/map/' + r.i + '" aria-label="Show on map">' + icon('pin') + '</button>' : '') + '</div>',
        { moreGo: '#/plan', more: plan.length + ' saved' });
    } else if (!plan.length) {
      html += '<div class="card cta" data-go="#/builder"><div class="cta-ic">' + icon('wand') + '</div><div><b>Build my schedule</b>' +
        '<span>Pick the topics you care about and get a conflict-free plan for the week.</span></div>' + icon('chevR', 'dim') + '</div>';
    }

    // ---- now and next
    if (!before && !after) {
      const live = rank(sessions.filter(it => it.s <= now && now < it.e && it.dur <= 600), prof);
      if (live.length) {
        html += section('Happening now', '<div class="hscroll">' + live.slice(0, 12).map(it => {
          const cur = it.ch.map(c => DB.items[c]).find(c => !c.brk && c.s <= now && now < c.e);
          return hcard(it, cur ? '<i>On stage</i> ' + esc(cur.t) : '');
        }).join('') + '</div>', { sub: live.length + ' sessions', moreGo: '#/schedule?d=' + today + '&live=1' });
      }
      const soon = rank(sessions.filter(it => it.s > now && it.s <= now + 120), prof);
      if (soon.length) {
        html += section('Starting soon', '<div class="hscroll">' + soon.slice(0, 12).map(it => hcard(it)).join('') + '</div>',
          { sub: 'next 2 hours', moreGo: '#/schedule?d=' + today });
      }
    }

    // ---- for you
    if (!prof.empty) {
      // talks and sessions still to come, soonest of the best first (posters have their own gallery)
      const pool = DB.items.filter(it => visible(it) && it.leaf && it.s > now - 10 && it.dur <= 300 && !(it.fl & 16) && !Plan.has(it.id));
      const scored = pool.map(it => [it, relevance(it, prof)]).filter(x => x[1].score >= 0.55)
        .sort((a, b) => (Math.round(b[1].score * 10) - Math.round(a[1].score * 10)) || a[0].s - b[0].s).slice(0, 5);
      if (scored.length) {
        html += section('Picked for your interests', scored.map(([it, r]) => itemCard(it, { showDay: true, score: r.score, parent: true })).join(''),
          { moreGo: '#/builder', more: 'Build schedule' });
      }
    }

    // ---- headliners
    const hlDay = after ? -1 : today;
    let heads = sessions.filter(it => HEADLINE.has(fmtOf(it).id) && (hlDay < 0 || it.day >= hlDay) && it.e > (after ? 0 : now));
    heads = heads.sort((a, b) => a.s - b.s).slice(0, 6);
    if (heads.length) {
      html += section(after ? 'Headline sessions' : 'Headliners coming up', heads.map(it => itemCard(it, { showDay: true })).join(''),
        { moreGo: '#/schedule?f=keynote,plenary,invited,award,gb', more: 'All' });
    }

    // ---- shortcuts
    const tiles = [
      ['#/builder', 'wand', '#C084FC', 'Schedule builder', 'Topics in, plan out'],
      ['#/galaxy', 'sparkles', '#22D3EE', 'Topic galaxy', 'Every talk on one map'],
      ['#/people?tab=foryou', 'users', '#F472B6', 'People to meet', 'Faces, rooms and times'],
      ['#/map', 'pin', '#34D399', 'Venue map', 'Find any room fast'],
      ['#/posters', 'image', '#FB7185', 'Posters', 'Browse the gallery'],
      ['#/explore', 'chart', '#818CF8', 'Insights', 'SC26 by the numbers'],
    ];
    html += section('Explore', '<div class="grid2">' + tiles.map(([go, ic, c, t, s]) =>
      '<div class="tile" data-go="' + go + '" style="--c:' + c + '">' + icon(ic) + '<b>' + t + '</b><span>' + s + '</span></div>').join('') + '</div>');

    // ---- numbers
    const c = DB.meta.counts;
    html += section('SC26 at a glance', '<div class="stats">' +
      statTile(c.sessions, 'sessions', { go: '#/schedule' }) + statTile(c.talks, 'talks & posters', { go: '#/galaxy' }) +
      statTile(c.people, 'contributors', { go: '#/people' }) + statTile(c.orgs, 'organizations', { go: '#/orgs' }) +
      statTile(c.countries, 'countries', { go: '#/globe' }) + statTile(DB.rooms.length, 'rooms', { go: '#/map' }) + '</div>' +
      '<p class="note" style="margin-top:12px">Program data from the public SC26 schedule, captured ' + esc(DB.meta.generated.slice(0, 10)) + '. Room or time changes after that date are not reflected.</p>');

    el.innerHTML = html;
    if (!counted) { counted = true; countUp(el); }
    if (!Store.state.settings.onboarded) setTimeout(() => { if (ctx.alive()) showWelcome(false); }, 700);

    // refresh when the minute changes so "now" stays honest
    let last = now;
    const timer = setInterval(() => { const n = nowMin(); if (n !== last) { last = n; ctx.rerender(); } }, 20000);
    return () => clearInterval(timer);
  },
});
