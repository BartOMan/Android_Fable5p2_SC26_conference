// Detail page for one session, talk or poster.
import {
  DB, FLAG, Plan, Store, Native, nowMin, dayInfo, fmtTime, fmtRange, fmtDur, visible, roomOf, fmtOf, parentOf, textOf,
  kindLabel, siteUrl, relevance, interestProfile, overlaps, toICS, epochMs, speakersOf, posterUrl,
} from '../core.js';
import { registerView } from '../router.js';
import {
  esc, icon, itemCard, talkRow, personRow, chip, section, fmtPill, relBadge, awardBadges, toast, lazyList, avatar,
} from '../ui.js';

const ROLE_LABEL = { author: 'Authors', presenter: 'Presenters', chair: 'Session chairs', panelist: 'Panelists', moderator: 'Moderators', organizer: 'Organizers', alternate: 'Alternate presenters' };

function peopleBlock(it) {
  if (!it.p.length) return '';
  const groups = new Map();
  for (const [pi, role, pres] of it.p) {
    const key = DB.roles[role];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push([DB.people[pi], pres]);
  }
  let h = '';
  for (const [role, list] of groups) {
    const LIMIT = 8;
    const row = ([p, pres]) => personRow(p, { sub: (pres && role === 'author' ? '<span class="presenting">Presenting</span> · ' : '') + esc(p.o.length ? DB.orgs[p.o[0]].n : '') });
    h += '<div class="card list ppl"><div class="ppl-h">' + (ROLE_LABEL[role] || role) + ' <i>' + list.length + '</i></div>' +
      list.slice(0, LIMIT).map(row).join('') +
      (list.length > LIMIT ? '<div class="more-wrap" hidden>' + list.slice(LIMIT).map(row).join('') + '</div><button class="link more-btn" data-act="show-more">Show all ' + list.length + icon('chevD') + '</button>' : '') + '</div>';
  }
  return section('People', h);
}

registerView('item', {
  title: 'Details', tab: 'schedule',
  render(el, ctx) {
    const id = ctx.args.join('/');
    const it = DB.byId.get(id);
    if (!it) { el.innerHTML = '<div class="empty">' + icon('info') + '<h3>Not in the program</h3><p>This item could not be found.</p></div>'; return; }
    const f = fmtOf(it), r = roomOf(it), par = parentOf(it), now = nowMin();
    ctx.setTitle(kindLabel(it));
    ctx.setActions('<button class="iconbtn" data-act="share-item" data-id="' + esc(it.id) + '" aria-label="Share">' + icon('share') + '</button>');
    const text = textOf(it);
    const inPlan = Plan.has(it.id);
    const hasRem = Store.state.reminders[it.id] != null;
    let h = '<div class="detail" style="--c:' + f.c + '">';
    h += '<div class="d-head"><div class="it-meta">' + fmtPill(it) + relBadge(it) + awardBadges(it) + '</div>' +
      (it.st ? '<div class="d-kick">' + esc(it.st) + '</div>' : '') +
      '<h1 class="d-title sel">' + esc(it.t) + '</h1>' +
      (par ? '<button class="d-par" data-go="#/item/' + esc(par.id) + '">' + icon('layers') + '<span>Part of <b>' + esc(par.t) + '</b></span>' + icon('chevR') + '</button>' : '') + '</div>';

    h += '<div class="card d-info">' +
      '<div class="d-row">' + icon('clock') + '<div><b>' + dayInfo(it.day).long + '</b><span>' + fmtRange(it.s, it.e) + ' · ' + fmtDur(it.dur) + ' · Chicago time</span></div></div>' +
      (r ? '<div class="d-row tap" data-go="#/map/' + r.i + '">' + icon('pin') + '<div><b>' + esc(r.n) + '</b><span>' + esc([r.b, r.f].filter(Boolean).join(' · ') || 'McCormick Place') + '</span></div><em>Map' + icon('chevR') + '</em></div>' : '') +
      ((it.fl & (FLAG.LIVE | FLAG.REC)) || (it.reg && it.reg.length) ? '<div class="d-row small">' + icon('info') + '<div><span>' +
        [(it.fl & FLAG.LIVE) ? 'Livestreamed' : '', (it.fl & FLAG.REC) ? 'Recorded' : '',
          it.reg && it.reg.length ? 'Open to: ' + it.reg.map(x => ({ TP: 'Technical Program', W: 'Workshop', T: 'Tutorial', EX: 'Exhibits' }[x] || x)).join(', ') + ' pass' : ''].filter(Boolean).join(' · ') + '</span></div></div>' : '') +
      '</div>';

    h += '<div class="d-actions"><button class="btn primary grow' + (inPlan ? ' saved' : '') + '" data-act="d-plan">' + icon('star') + '<span>' + (inPlan ? 'In My Plan' : 'Add to My Plan') + '</span></button>' +
      '<button class="btn sq' + (hasRem ? ' active' : '') + '" data-act="d-remind" aria-label="Remind me">' + icon('bell') + '</button>' +
      '<button class="btn sq" data-act="d-cal" aria-label="Add to calendar">' + icon('calendar') + '</button></div>';

    const purl = posterUrl(it);
    // stays hidden until it has loaded: online previews can be slow or unavailable
    if (purl) h += '<img class="d-poster" alt="Poster preview" src="' + esc(purl) + '" onload="this.classList.add(\'ok\')" onerror="this.remove()">';

    const chips = it.th.slice(0, 5).map(([t]) => chip(DB.themes[t].n, { go: '#/theme/' + DB.themes[t].id, color: DB.themes[t].c, cls: 'sm' })).join('') +
      it.g.map(g => chip(DB.tags[g].n, { go: '#/tag/' + g, cls: 'sm' })).join('');
    if (chips) h += '<div class="chips d-chips">' + chips + '</div>';

    if (text) {
      const long = text.length > 620;
      h += section(it.k === 'S' && it.ch.length ? 'About this session' : 'Abstract',
        '<div class="card pad"><div class="d-text sel' + (long ? ' clamp' : '') + '">' + esc(text).replace(/\n/g, '<br>') + '</div>' +
        (long ? '<button class="link" data-act="d-more">Read more' + icon('chevD') + '</button>' : '') +
        (it.kw && it.kw.length ? '<div class="kw"><span>Key terms</span>' + it.kw.map(k => chip(k, { go: '#/search?q=' + encodeURIComponent(k), cls: 'sm' })).join('') + '</div>' : '') + '</div>');
    }

    // talks inside a session
    if (it.k === 'S' && it.ch.length) {
      const kids = it.ch.map(c => DB.items[c]);
      const sameTime = kids.every(c => c.s === kids[0].s && c.e === kids[0].e);
      h += section('In this session', '<div class="card list" id="d-kids"></div>', { sub: kids.filter(c => !c.brk).length + (f.id === 'poster' || f.id === 'art' ? ' items' : ' talks') });
      ctx._kids = { kids, sameTime };
    }

    h += peopleBlock(it);

    // links
    let links = '';
    if (it.dl) links += '<button class="d-link" data-act="open-ext" data-url="' + esc(it.dl) + '">' + icon('book') + '<span><b>Read the paper</b><i>IEEE SC Digital Library</i></span>' + icon('ext') + '</button>';
    for (const [label, url] of (it.ln || [])) links += '<button class="d-link" data-act="open-ext" data-url="' + esc(url) + '">' + icon('ext') + '<span><b>' + esc(label) + '</b><i>' + esc(url.replace(/^https?:\/\//, '').slice(0, 44)) + '</i></span>' + icon('chevR') + '</button>';
    if (it.vid) links += '<button class="d-link" data-act="open-ext" data-url="' + esc(it.vid) + '">' + icon('live') + '<span><b>Watch the video</b><i>Opens in your browser</i></span>' + icon('ext') + '</button>';
    if (it.x) links += '<button class="d-link" data-go="#/galaxy?it=' + encodeURIComponent(it.id) + '">' + icon('sparkles') + '<span><b>See it in the topic galaxy</b><i>Find the neighborhood of related work</i></span>' + icon('chevR') + '</button>';
    links += '<button class="d-link" data-act="open-ext" data-url="' + esc(siteUrl(it)) + '">' + icon('globe') + '<span><b>Open on the SC26 website</b><i>Official program page, needs a connection</i></span>' + icon('ext') + '</button>';
    h += section('Links', '<div class="card list">' + links + '</div>');

    if (it.alt && it.alt.length) {
      h += section('Also shown at', it.alt.map(i => itemCard(DB.items[i], { showDay: true, dense: true })).join(''));
    }

    // what else runs at the same time
    const host = par || it;
    const prof = interestProfile();
    let clash = DB.items.filter(o => o.k === 'S' && o.i !== host.i && visible(o) && overlaps(o, it) && o.dur <= 480 && fmtOf(o).id !== 'poster');
    if (clash.length) {
      const sc = new Map(clash.map(o => [o.i, prof.empty ? 0 : relevance(o, prof).score]));
      const simSet = new Set(it.sim);
      clash.sort((a, b) => (sc.get(b.i) - sc.get(a.i)) || ((simSet.has(b.i) ? 1 : 0) - (simSet.has(a.i) ? 1 : 0)) || a.s - b.s);
      h += section('At the same time', clash.slice(0, 4).map(o => itemCard(o, { dense: true, score: !prof.empty && sc.get(o.i) >= 0.3 ? sc.get(o.i) : null })).join('') +
        (clash.length > 4 ? '<button class="link" data-go="#/schedule?d=' + it.day + '">All ' + clash.length + ' parallel sessions' + icon('chevR') + '</button>' : ''),
        { sub: clash.length + ' parallel' });
    }

    if (it.sim.length) {
      h += section('Related work at SC26', it.sim.map(i => DB.items[i]).filter(Boolean).map(o => itemCard(o, { showDay: true, dense: true, parent: true })).join(''), { sub: 'by text similarity' });
    }

    h += section('My notes', '<textarea class="area" id="d-note" placeholder="Questions to ask, people to follow up with…">' + esc(Store.state.notes[it.id] || '') + '</textarea>');
    h += '</div>';
    el.innerHTML = h;

    let stop = null;
    if (ctx._kids) {
      const { kids, sameTime } = ctx._kids;
      stop = lazyList(el.querySelector('#d-kids'), kids.length, (a, b) => kids.slice(a, b).map(c => talkRow(c, { noTime: sameTime })).join(''), 40);
      if (sameTime) el.querySelector('#d-kids').classList.add('notime');
    }

    ctx.on('show-more', t => { const w = t.previousElementSibling; if (w) w.hidden = false; t.remove(); });
    ctx.on('d-more', t => { el.querySelector('.d-text').classList.remove('clamp'); t.remove(); });
    ctx.on('d-plan', t => {
      const on = Plan.toggle(it.id);
      t.classList.toggle('saved', on); t.querySelector('span').textContent = on ? 'In My Plan' : 'Add to My Plan';
      document.querySelectorAll('.star[data-id="' + CSS.escape(it.id) + '"]').forEach(b => b.classList.toggle('on', on));
      if (!on) el.querySelector('[data-act="d-remind"]').classList.remove('active');
      Native.haptic(); toast(on ? 'Added to My Plan' : 'Removed from My Plan');
    });
    ctx.on('d-remind', t => {
      if (!Native.available) { toast('Reminders work in the Android app'); return; }
      if (Store.state.reminders[it.id] != null) {
        delete Store.state.reminders[it.id]; Store.save('reminders'); Native.cancelReminder(it.id);
        t.classList.remove('active'); toast('Reminder removed'); return;
      }
      const at = epochMs(it.s - 10);
      if (at <= Date.now()) { toast('This one has already started'); return; }
      Native.scheduleReminder(it.id, it.t, 'Starts at ' + fmtTime(it.s) + (r ? ' in ' + r.n : ''), at);
      Store.state.reminders[it.id] = 10; Store.save('reminders');
      if (!Plan.has(it.id)) { Plan.add(it.id); const b = el.querySelector('[data-act="d-plan"]'); b.classList.add('saved'); b.querySelector('span').textContent = 'In My Plan'; }
      t.classList.add('active'); toast('Reminder set for 10 minutes before');
    });
    ctx.on('d-cal', () => {
      const where = r ? r.n + (r.b ? ', ' + r.b + ' ' + r.f : '') + ', McCormick Place, Chicago' : 'McCormick Place, Chicago';
      const who = speakersOf(it, 4).map(p => p.n).join(', ');
      if (!Native.addCalendarEvent(it.t, epochMs(it.s), epochMs(it.e), where, kindLabel(it) + (who ? ' · ' + who : '') + '\n' + siteUrl(it))) {
        Native.shareFile('sc26-' + it.id.replace(/[^A-Za-z0-9]+/g, '-') + '.ics', 'text/calendar', toICS([it]));
        toast('Calendar file saved');
      }
    });
    let noteTimer = null;
    const note = el.querySelector('#d-note');
    const saveNote = () => {
      const v = note.value.trim();
      if (v) Store.state.notes[it.id] = note.value; else delete Store.state.notes[it.id];
      Store.save('notes');
    };
    note.addEventListener('input', () => { clearTimeout(noteTimer); noteTimer = setTimeout(saveNote, 500); });
    return () => { if (noteTimer) { clearTimeout(noteTimer); saveNote(); } if (stop) stop(); };
  },
});
