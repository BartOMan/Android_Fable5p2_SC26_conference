// My Plan: the starred sessions as a day-by-day agenda with conflicts, gaps and walking hints.
import {
  DB, Plan, Store, Native, nowMin, dayOf, dayInfo, fmtTime, fmtDur, roomOf, walkMin, planConflicts, toICS, planAsText,
  epochMs, bus,
} from '../core.js';
import { registerView, go } from '../router.js';
import { esc, icon, itemCard, chip, section, toast, openSheet, closeSheet } from '../ui.js';

let memoDay = null;

function agenda(list, conflicts) {
  const now = nowMin();
  let h = '', prev = null, nowDrawn = false;
  for (const it of list) {
    if (!nowDrawn && dayOf(now) === it.day && it.s > now) {
      nowDrawn = true;
      h += '<div class="nowline"><span>Now · ' + fmtTime(now) + '</span></div>';
    }
    if (prev) {
      const gap = it.s - prev.e;
      const a = roomOf(prev), b = roomOf(it);
      const w = a && b && a.i !== b.i ? walkMin(a, b) : 0;
      if (gap < 0) {
        h += '<div class="gap bad">' + icon('info') + '<span>Overlaps the previous one by ' + fmtDur(-gap) + '</span></div>';
      } else if (w || gap >= 20) {
        const tight = w && gap < w + 3;
        h += '<div class="gap' + (tight ? ' tight' : '') + '"' + (w ? ' data-go="#/map/' + b.i + '?from=' + a.i + '"' : '') + '>' +
          (w ? icon('walk') + '<span>' + (gap ? fmtDur(gap) + ' gap · ' : 'Back to back · ') + 'about ' + w + ' min walk to ' + esc(b.n) + (tight ? ' · tight' : '') + '</span>' + icon('chevR')
            : icon('clock') + '<span>' + fmtDur(gap) + ' free</span>') + '</div>';
      }
    }
    const cf = conflicts.get(it.id);
    const note = Store.state.notes[it.id];
    const rem = Store.state.reminders[it.id] != null;
    h += itemCard(it, { parent: true, extra:
      (cf ? '<div class="conflict">' + icon('info') + 'Overlaps with ' + esc(cf.map(x => x.t).join('; ')) + '</div>' : '') +
      (rem || note ? '<div class="plan-flags">' + (rem ? '<span class="badge">' + icon('bell') + 'Reminder set</span>' : '') + (note ? '<span class="badge">' + icon('note') + esc(note.slice(0, 60)) + (note.length > 60 ? '…' : '') + '</span>' : '') + '</div>' : '') });
    prev = it;
  }
  return h;
}

registerView('plan', {
  title: 'My Plan', tab: 'plan', root: true,
  render(el, ctx) {
    const list = Plan.items();
    if (!list.length) {
      el.innerHTML = '<div class="empty">' + icon('bookmark') + '<h3>Your plan is empty</h3><p>Tap the star on any session or talk to save it here. Or let the app build a plan from your interests.</p>' +
        '<button class="btn primary" data-go="#/builder">' + icon('wand') + 'Build my schedule</button>' +
        '<div style="height:10px"></div><button class="btn" data-go="#/schedule">Browse the schedule</button></div>';
      const off0 = bus.on('plan', () => ctx.rerender());
      return off0;
    }
    const now = nowMin();
    const days = Array.from(new Set(list.map(it => it.day))).sort((a, b) => a - b);
    const today = dayOf(now);
    if (memoDay == null || !days.includes(memoDay)) memoDay = days.includes(today) ? today : (days.find(d => d > today) ?? days[0]);
    const conflicts = planConflicts();
    const mins = list.reduce((a, it) => a + it.dur, 0);
    const dayList = list.filter(it => it.day === memoDay);
    const nConf = new Set(Array.from(conflicts.keys()).filter(id => DB.byId.get(id).day === memoDay)).size;
    ctx.setActions('<button class="iconbtn" data-act="pl-menu" aria-label="Plan options">' + icon('more') + '</button>');
    let h = '<div class="daytabs">' + days.map(d => {
      const di = dayInfo(d); const n = list.filter(it => it.day === d).length;
      return '<button class="daytab' + (d === memoDay ? ' on' : '') + (d === today ? ' today' : '') + '" data-act="pl-day" data-id="' + d + '"><small>' + di.dow + '</small><b>' + di.date + '</b><em>' + n + '</em></button>';
    }).join('') + '</div>';
    h += '<div class="plan-sum"><span><b>' + list.length + '</b> saved</span><span><b>' + fmtDur(mins) + '</b> in total</span>' +
      (conflicts.size ? '<span class="warn"><b>' + conflicts.size + '</b> overlapping</span>' : '<span class="good">No overlaps</span>') + '</div>';
    h += section(dayInfo(memoDay).long, agenda(dayList, conflicts), { sub: dayList.length + (dayList.length === 1 ? ' item' : ' items') + (nConf ? ' · ' + nConf + ' overlapping' : '') });
    h += '<div class="btnrow" style="margin-top:16px"><button class="btn" data-go="#/builder">' + icon('wand') + 'Fill the gaps</button>' +
      '<button class="btn" data-act="pl-share">' + icon('share') + 'Share</button></div>';
    el.innerHTML = h;
    const tab = el.querySelector('.daytab.on'); if (tab) tab.scrollIntoView({ inline: 'center', block: 'nearest' });

    ctx.on('pl-day', t => { memoDay = +t.dataset.id; ctx.rerender({ top: true }); });
    ctx.on('pl-share', () => { const r = Native.share('My SC26 plan', planAsText(Plan.items())); if (r === 'copied') toast('Plan copied to clipboard'); });
    ctx.on('pl-menu', () => {
      const future = Plan.items().filter(it => epochMs(it.s - 10) > Date.now());
      openSheet('<div class="card list">' +
        '<button class="d-link" data-act="pl-ics">' + icon('download') + '<span><b>Export to a calendar file</b><i>An .ics file with every saved item</i></span>' + icon('chevR') + '</button>' +
        '<button class="d-link" data-act="pl-share">' + icon('share') + '<span><b>Share as text</b><i>Times, titles and rooms</i></span>' + icon('chevR') + '</button>' +
        '<button class="d-link" data-act="pl-remind">' + icon('bell') + '<span><b>Remind me before each one</b><i>' + (Native.available ? 'A notification 10 minutes ahead, for ' + future.length + ' upcoming items' : 'Available in the Android app') + '</i></span>' + icon('chevR') + '</button>' +
        '<button class="d-link" data-act="pl-clear">' + icon('trash') + '<span><b>Clear my plan</b><i>Removes all ' + Plan.count() + ' saved items</i></span>' + icon('chevR') + '</button></div>', { title: 'My Plan' });
    });
    ctx.on('pl-ics', () => { Native.shareFile('sc26-my-plan.ics', 'text/calendar', toICS(Plan.items())); closeSheet(); toast('Calendar file ready'); });
    ctx.on('pl-remind', () => {
      if (!Native.available) { toast('Reminders work in the Android app'); return; }
      let n = 0;
      for (const it of Plan.items()) {
        const at = epochMs(it.s - 10); if (at <= Date.now()) continue;
        const r = roomOf(it);
        Native.scheduleReminder(it.id, it.t, 'Starts at ' + fmtTime(it.s) + (r ? ' in ' + r.n : ''), at);
        Store.state.reminders[it.id] = 10; n++;
      }
      Store.save('reminders'); closeSheet(); toast(n ? n + ' reminders set' : 'Nothing upcoming to remind about'); ctx.rerender();
    });
    ctx.on('pl-clear', () => {
      openSheet('<p class="lead">Remove all ' + Plan.count() + ' saved items? Notes stay.</p><div class="btnrow"><button class="btn" data-act="sheet-close">Keep them</button><button class="btn on" data-act="pl-clear-yes">' + icon('trash') + 'Clear plan</button></div>', { title: 'Clear my plan' });
    });
    ctx.on('pl-clear-yes', () => { Plan.clear(); closeSheet(); toast('Plan cleared'); });
    const off = bus.on('plan', () => ctx.rerender());
    return off;
  },
});
