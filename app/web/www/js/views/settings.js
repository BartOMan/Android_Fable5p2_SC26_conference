// Settings, data sources and the first-run welcome.
import { DB, Store, Plan, Native, nowMin, setSimTime, dayInfo, dayOf, fmtTime } from '../core.js';
import { registerView } from '../router.js';
import { esc, icon, section, chip, toast, openSheet, closeSheet } from '../ui.js';

const PASSES = [['TP', 'Technical Program'], ['W', 'Workshops'], ['T', 'Tutorials'], ['EX', 'Exhibits']];

registerView('settings', {
  title: 'Settings', tab: 'home',
  render(el, ctx) {
    const s = Store.state.settings;
    const c = DB.meta.counts;
    const now = nowMin();
    const sim = s.sim;
    const pad = n => (n < 10 ? '0' : '') + n;
    const local = new Date((now + DB.meta.tzOffsetMin) * 60000);
    const localIso = local.getUTCFullYear() + '-' + pad(local.getUTCMonth() + 1) + '-' + pad(local.getUTCDate()) + 'T' + pad(local.getUTCHours()) + ':' + pad(local.getUTCMinutes());
    el.innerHTML =
      section('What to show', '<div class="card pad">' +
        '<div class="toggle"><div><b>Technical program only</b><span>Hide receptions, logistics, exhibits and student events everywhere in the app</span></div><button class="sw' + (s.techOnly ? ' on' : '') + '" data-act="set-tech" aria-label="Technical program only"></button></div></div>') +
      section('My registration', '<div class="chips">' + PASSES.map(([id, n]) => chip(n, { act: 'set-pass', id, on: s.passes.includes(id) })).join('') + '</div><p class="note" style="margin-top:8px">The schedule builder skips sessions that need a pass you do not have.</p>') +
      section('Clock', '<div class="card pad"><p class="small" style="color:var(--tx2);margin-bottom:10px">The app shows conference time (Chicago, CST). It is now <b>' + dayInfo(Math.max(0, Math.min(DB.nDays - 1, dayOf(now)))).label + ', ' + fmtTime(now) + '</b>' + (sim ? ' (simulated)' : '') + '.</p>' +
        '<div class="field"><input type="datetime-local" id="set-sim" value="' + localIso + '" min="2026-11-13T00:00" max="2026-11-22T23:59"></div>' +
        '<div class="btnrow" style="margin-top:10px"><button class="btn" data-act="set-sim">Pretend it is this time</button><button class="btn' + (sim ? '' : ' ghost') + '" data-act="set-real"' + (sim ? '' : ' disabled') + '>Use the real time</button></div>' +
        '<p class="note" style="margin-top:8px">Handy for planning a later day or for a look back after the conference.</p></div>') +
      section('Data', '<div class="card pad"><dl class="kv">' +
        '<dt>Program captured</dt><dd>' + esc(DB.meta.generated.replace('T', ' ').replace('Z', ' UTC')) + '</dd>' +
        '<dt>Sessions</dt><dd>' + c.sessions + '</dd><dt>Talks and posters</dt><dd>' + c.talks.toLocaleString('en-US') + ' with abstracts</dd>' +
        '<dt>Contributors</dt><dd>' + c.people.toLocaleString('en-US') + (c.photos ? ', ' + c.photos + ' photos bundled' : '') + '</dd>' +
        '<dt>Organizations</dt><dd>' + c.orgs.toLocaleString('en-US') + '</dd><dt>My Plan</dt><dd>' + Plan.count() + ' saved, ' + Object.keys(Store.state.notes).length + ' notes</dd>' +
        '<dt>App version</dt><dd>' + esc(Native.appVersion()) + '</dd></dl>' +
        '<div class="hr"></div><p class="note">Sources: the public SC26 schedule at sc26.conference-program.com (sessions, abstracts, contributors, photos, floor plans) and OpenAlex (earlier SC papers per author). ' +
        'Themes, similarity, activity ranks, sectors and walking times are computed by this app and are estimates. Room or time changes made after the capture date are not shown here, so check the official schedule for last-minute moves. ' +
        'This is an independent companion, not an official SC26 product.</p>' +
        '<div class="btnrow" style="margin-top:12px"><button class="btn" data-act="open-ext" data-url="' + esc(DB.meta.siteBase) + '">' + icon('ext') + 'Official schedule</button></div></div>') +
      section('Reset', '<div class="btnrow"><button class="btn" data-act="set-welcome">Show the welcome again</button><button class="btn on" data-act="set-reset">' + icon('trash') + 'Erase my data</button></div>');
    ctx.on('set-tech', t => { s.techOnly = !s.techOnly; t.classList.toggle('on', s.techOnly); Store.save('settings'); });
    ctx.on('set-pass', t => { const i = s.passes.indexOf(t.dataset.id); if (i >= 0) s.passes.splice(i, 1); else s.passes.push(t.dataset.id); t.classList.toggle('on', i < 0); Store.save('settings'); });
    ctx.on('set-sim', () => { const v = el.querySelector('#set-sim').value; if (!v) return; setSimTime(v); toast('Clock set to ' + v.replace('T', ' ')); ctx.rerender(); });
    ctx.on('set-real', () => { setSimTime(null); toast('Back to the real time'); ctx.rerender(); });
    ctx.on('set-welcome', () => showWelcome(true));
    ctx.on('set-reset', () => {
      openSheet('<p class="lead">This erases your plan, notes, interests and follows on this phone. The program itself stays.</p><div class="btnrow"><button class="btn" data-act="sheet-close">Cancel</button><button class="btn on" data-act="set-reset-yes">' + icon('trash') + 'Erase</button></div>', { title: 'Erase my data' });
    });
    ctx.on('set-reset-yes', () => { Store.reset(); closeSheet(); toast('Your data was erased'); ctx.rerender(); });
  },
});

/** One-time welcome sheet that explains the four things worth knowing. */
export function showWelcome(force) {
  if (!force && Store.state.settings.onboarded) return;
  Store.state.settings.onboarded = true; Store.save();
  openSheet('<div class="welcome"><div class="orb sm"></div><h2>Welcome to SC26 Atlas</h2><p class="lead">The whole SC26 program in your pocket. It works without a connection.</p>' +
    '<div class="wl">' + icon('wand') + '<div><b>Build a schedule from your interests</b><span>Pick themes and get a conflict-free plan for each day.</span></div></div>' +
    '<div class="wl">' + icon('sparkles') + '<div><b>See the whole conference at once</b><span>The topic galaxy places every talk by what it is about.</span></div></div>' +
    '<div class="wl">' + icon('users') + '<div><b>Find the people</b><span>Who presents on your topics, where and when to catch them.</span></div></div>' +
    '<div class="wl">' + icon('pin') + '<div><b>Find the room</b><span>Floor plans with every session room and walking estimates.</span></div></div>' +
    '<div class="btnrow" style="margin-top:16px"><button class="btn" data-act="sheet-close">Look around</button><button class="btn primary" data-go="#/builder">Pick my interests</button></div></div>', {});
}
