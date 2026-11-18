// Profiles: one contributor, and one organization.
import {
  DB, Follows, Native, nowMin, dayInfo, fmtTime, roomOf, fmtOf, coauthors, flagOf, SECTOR, visible, photoUrl,
} from '../core.js';
import { registerView } from '../router.js';
import { esc, icon, itemCard, personRow, orgRow, chip, section, avatar, followBtn, statTile, lazyList, toast } from '../ui.js';

const ROLE_WORD = { author: 'Author', presenter: 'Presenter', chair: 'Session chair', panelist: 'Panelist', moderator: 'Moderator', organizer: 'Organizer', alternate: 'Alternate presenter' };

registerView('person', {
  title: 'Contributor', tab: 'people',
  render(el, ctx) {
    const p = DB.personById.get(ctx.args[0]);
    if (!p) { el.innerHTML = '<div class="empty">' + icon('user') + '<h3>Not found</h3><p>This contributor is not in the program.</p></div>'; return; }
    ctx.setTitle(p.n);
    const now = nowMin();
    const c = p.c >= 0 ? DB.countries[p.c] : null;
    const its = p.items.map(([i, role, pres]) => ({ it: DB.items[i], role: DB.roles[role], pres })).filter(x => !x.it.brk);
    // one row per item, strongest role first
    const seen = new Map();
    for (const x of its) {
      const cur = seen.get(x.it.i);
      if (!cur || (x.pres && !cur.pres) || (cur.role === 'chair' && x.role !== 'chair')) seen.set(x.it.i, x);
    }
    const rows = Array.from(seen.values()).sort((a, b) => a.it.s - b.it.s);
    const upcoming = rows.filter(x => x.it.e > now), past = rows.filter(x => x.it.e <= now);
    const bio = DB.bios[p.i];
    const co = Array.from(coauthors(p).entries()).sort((a, b) => b[1] - a[1] || DB.people[b[0]].w - DB.people[a[0]].w);
    const themeScore = new Map();
    for (const { it, pres } of rows) for (const [t, v] of it.th) themeScore.set(t, (themeScore.get(t) || 0) + v * (pres ? 1.5 : 1));
    const topThemes = Array.from(themeScore.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t]) => DB.themes[t]);
    const kws = [];
    for (const { it, pres } of rows.slice().sort((a, b) => b.pres - a.pres)) for (const k of (it.kw || [])) if (!kws.includes(k) && kws.length < 8) kws.push(k);

    let h = '<div class="profile"><div class="profile-top">' + avatar(p, 96, { guess: true }).replace('class="av"', 'class="av ring"') +
      '<div class="profile-id"><h1 class="sel">' + esc(p.n) + '</h1>' +
      p.o.slice(0, 3).map(o => '<button class="profile-org" data-go="#/org/' + o + '">' + esc(DB.orgs[o].n) + '</button>').join('') +
      (c ? '<button class="profile-org dim" data-go="#/country/' + c.i + '">' + flagOf(c) + ' ' + esc(c.name) + '</button>' : '') + '</div></div>' +
      '<div class="btnrow" style="margin-top:14px">' + followBtn(p).replace('btn sm', 'btn') +
      '<button class="btn" data-go="#/network?p=' + esc(p.id) + '">' + icon('network') + '<span>Network</span></button>' +
      '<button class="btn sq" data-act="p-share" aria-label="Share">' + icon('share') + '</button></div></div>';

    const nPres = rows.filter(x => x.pres || x.role === 'presenter' || x.role === 'panelist').length;
    h += '<div class="stats" style="margin-top:14px">' + statTile(rows.length, rows.length === 1 ? 'program item' : 'program items') +
      statTile(nPres, 'as speaker') + statTile(co.length, 'collaborators here') + '</div>';

    if (p.sc) {
      h += '<div class="card pad vet"><div class="vet-n"><b>' + p.sc[0] + '</b><span>earlier SC papers</span></div><div class="vet-t">' +
        '<b>' + p.sc[1] + (p.sc[2] !== p.sc[1] ? ' to ' + p.sc[2] : '') + '</b> · ' + p.sc[3].toLocaleString('en-US') + ' citations' +
        (p.sc[4] ? '<span>Most cited: “' + esc(p.sc[4]) + '” (' + p.sc[5] + ')</span>' : '') +
        '<i>Estimate from OpenAlex, matched by name. Namesakes may be included.</i></div></div>';
    }

    if (upcoming.length) {
      h += section('Where to find ' + esc(p.n.split(' ')[0]), upcoming.map(x => itemCard(x.it, { showDay: true, parent: true, dense: true,
        extra: '<div class="role-line">' + (x.pres ? icon('mic') + 'Presenting' : esc(ROLE_WORD[x.role] || x.role)) + '</div>' })).join(''), { sub: upcoming.length + ' coming up' });
    }
    if (topThemes.length || kws.length) {
      h += section('Conversation starters', '<div class="card pad">' +
        (topThemes.length ? '<div class="starter-h">Works on</div><div class="chips">' + topThemes.map(t => chip(t.n, { go: '#/theme/' + t.id, color: t.c, cls: 'sm' })).join('') + '</div>' : '') +
        (kws.length ? '<div class="starter-h">Ask about</div><div class="chips">' + kws.map(k => chip(k, { go: '#/search?q=' + encodeURIComponent(k), cls: 'sm' })).join('') + '</div>' : '') +
        (rows.length ? '<div class="starter-h">An opener</div><p class="starter-q sel">“I saw you are part of ‘' + esc((rows.find(x => x.pres) || rows[0]).it.t) + '’. What surprised you most in that work?”</p>' : '') + '</div>');
    }
    if (bio) h += section('About', '<div class="card pad"><div class="d-text sel' + (bio.length > 500 ? ' clamp' : '') + '">' + esc(bio).replace(/\n/g, '<br>') + '</div>' + (bio.length > 500 ? '<button class="link" data-act="p-more">Read more' + icon('chevD') + '</button>' : '') + '</div>');
    if (co.length) {
      h += section('Works with', '<div class="card list">' + co.slice(0, 6).map(([i, n]) => personRow(DB.people[i], { right: n + (n === 1 ? ' shared' : ' shared') })).join('') + '</div>' +
        (co.length > 6 ? '<button class="link" data-go="#/network?p=' + esc(p.id) + '">See all ' + co.length + ' in the network view' + icon('chevR') + '</button>' : ''), { sub: co.length + ' at SC26' });
    }
    if (past.length) h += section('Earlier this week', past.map(x => itemCard(x.it, { showDay: true, parent: true, dense: true })).join(''));
    h += section('Links', '<div class="card list">' +
      '<button class="d-link" data-act="open-ext" data-url="' + esc(DB.meta.siteBase + 'presenter/?uid=' + p.id) + '">' + icon('globe') + '<span><b>Profile on the SC26 website</b><i>Needs a connection</i></span>' + icon('ext') + '</button>' +
      '<button class="d-link" data-act="open-ext" data-url="' + esc('https://www.google.com/search?q=' + encodeURIComponent(p.n + ' ' + (p.o.length ? DB.orgs[p.o[0]].n : ''))) + '">' + icon('search') + '<span><b>Look up on the web</b><i>Opens a search in your browser</i></span>' + icon('ext') + '</button></div>');
    if (!photoUrl(p)) h += '<p class="note" style="margin-top:12px">No photo is published for this person in the SC26 program.</p>';
    el.innerHTML = h;
    ctx.on('p-more', t => { t.previousElementSibling.classList.remove('clamp'); t.remove(); });
    ctx.on('p-share', () => {
      const nx = upcoming[0];
      const r = Native.share(p.n, p.n + (p.o.length ? ' (' + DB.orgs[p.o[0]].n + ')' : '') + (nx ? '\nNext at SC26: ' + nx.it.t + ', ' + dayInfo(nx.it.day).label + ' ' + fmtTime(nx.it.s) + (roomOf(nx.it) ? ', ' + roomOf(nx.it).n : '') : ''));
      if (r === 'copied') toast('Copied to clipboard');
    });
  },
});

registerView('org', {
  title: 'Organization', tab: 'people',
  render(el, ctx) {
    const o = DB.orgs[+ctx.args[0]];
    if (!o) { el.innerHTML = '<div class="empty">' + icon('building') + '<h3>Not found</h3><p>This organization is not in the program.</p></div>'; return; }
    ctx.setTitle(o.n);
    const c = o.c >= 0 ? DB.countries[o.c] : null;
    const people = o.people.map(i => DB.people[i]).sort((a, b) => b.w - a.w);
    const items = Array.from(o.items).map(i => DB.items[i]).filter(it => !it.brk && (visible(it) || true)).sort((a, b) => a.s - b.s);
    const leaf = items.filter(it => it.leaf);
    const themeCount = new Map();
    for (const it of leaf) for (const [t] of it.th.slice(0, 2)) themeCount.set(t, (themeCount.get(t) || 0) + 1);
    const top = Array.from(themeCount.entries()).sort((a, b) => b[1] - a[1]).slice(0, 7);
    const maxT = top.length ? top[0][1] : 1;
    const on = Follows.hasOrg(o.n);
    const fcount = new Map();
    for (const it of leaf) fcount.set(it.f, (fcount.get(it.f) || 0) + 1);
    let h = '<div class="profile"><div class="profile-top"><span class="av sq ring" style="--s:84px;--h:' + (o.n.length * 37 % 360) + '">' + icon('building') + '</span>' +
      '<div class="profile-id"><h1 class="sel">' + esc(o.n) + '</h1><span class="profile-org dim">' + esc(SECTOR[o.k]) + ' (estimated)</span>' +
      (c ? '<button class="profile-org dim" data-go="#/country/' + c.i + '">' + flagOf(c) + ' ' + esc(c.name) + '</button>' : '') +
      (o.booth ? '<span class="profile-org dim">Exhibit booth ' + esc(o.booth) + '</span>' : '') + '</div></div>' +
      '<div class="btnrow" style="margin-top:14px"><button class="btn' + (on ? ' on' : '') + '" data-act="o-follow">' + icon('heart') + '<span>' + (on ? 'Following' : 'Follow') + '</span></button></div></div>';
    h += '<div class="stats" style="margin-top:14px">' + statTile(people.length, 'contributors') + statTile(leaf.length, 'talks & sessions') + statTile(themeCount.size, 'themes') + '</div>';
    if (top.length) {
      h += section('What they present', '<div class="card pad"><div class="bars">' + top.map(([t, n]) =>
        '<div class="barrow" data-go="#/theme/' + DB.themes[t].id + '" style="--c:' + DB.themes[t].c + '"><span>' + esc(DB.themes[t].n) + '</span><span class="track"><i style="width:' + Math.round(100 * n / maxT) + '%"></i></span><b>' + n + '</b></div>').join('') + '</div>' +
        '<div class="legend" style="margin-top:12px">' + Array.from(fcount.entries()).sort((a, b) => b[1] - a[1]).map(([f, n]) => '<span><i style="--c:' + DB.formats[f].c + '"></i>' + esc(DB.formats[f].n) + ' ' + n + '</span>').join('') + '</div></div>');
    }
    h += section('People', '<div class="card list" id="o-people"></div>', { sub: String(people.length) });
    h += section('In the program', '<div id="o-items"></div>', { sub: String(leaf.length) });
    el.innerHTML = h;
    const s1 = lazyList(el.querySelector('#o-people'), Math.min(people.length, 400), (a, b) => people.slice(a, b).map(p => personRow(p, { sub: p.ni + (p.ni === 1 ? ' program item' : ' program items'), size: 40 })).join(''), 12);
    const s2 = lazyList(el.querySelector('#o-items'), leaf.length, (a, b) => leaf.slice(a, b).map(it => itemCard(it, { showDay: true, parent: true, dense: true })).join(''), 15);
    ctx.on('o-follow', t => {
      const v = Follows.toggleOrg(o.n);
      t.classList.toggle('on', v); t.querySelector('span').textContent = v ? 'Following' : 'Follow';
      toast(v ? 'Following: their sessions rank higher in your schedule' : 'Unfollowed');
    });
    return () => { s1(); s2(); };
  },
});
