// SC26 Atlas: hash router, top bar, bottom navigation and click delegation.
//
// A view is registered with registerView(name, def). def fields:
//   title   string or (args, query) => string
//   tab     name of the bottom tab to highlight ('home' | 'schedule' | 'explore' | 'people' | 'plan')
//   root    true when the view is a tab root (no back arrow)
//   full    true for edge-to-edge views that manage their own scrolling (maps, canvases)
//   render  (el, ctx) => optional cleanup function. May be async.
// ctx: { args, query, on(action, fn), setTitle(text), setActions(html), rerender(), isBack }
import { DB, Plan, Follows, Native, bus, roomOf, fmtWhen, siteUrl, kindLabel } from './core.js';
import { icon, esc, toast, closeSheet, sheetOpen, growLists } from './ui.js';

const views = {};
const TABS = [
  ['home', 'Today', 'home'], ['schedule', 'Schedule', 'calendar'], ['explore', 'Explore', 'compass'],
  ['people', 'People', 'users'], ['plan', 'My Plan', 'bookmark'],
];
let current = null;          // { name, def, key, cleanup, actions }
const scrollMemo = new Map();
const globalActions = {};

export function registerView(name, def) { views[name] = def; }
export function onGlobalAction(name, fn) { globalActions[name] = fn; }

// a hand-typed "%" that is not a valid escape must not stop the app
const dec = s => { try { return decodeURIComponent(s); } catch (e) { return s; } };
export function parseHash(hash) {
  const h = (hash || '').replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  const parts = path.split('/').filter(Boolean).map(dec);
  const query = {};
  if (qs) for (const kv of qs.split('&')) { const [k, v] = kv.split('='); if (k) query[dec(k)] = dec((v || '').replace(/\+/g, ' ')); }
  return { name: parts[0] || 'home', args: parts.slice(1), query };
}
const depth = () => (history.state && history.state.d) || 0;

export function go(hash, o = {}) {
  if (!hash) return;
  if (hash === location.hash && !o.force) { document.getElementById('view').scrollTo({ top: 0, behavior: 'smooth' }); return; }
  const d = depth() + (o.replace ? 0 : 1);
  history[o.replace ? 'replaceState' : 'pushState']({ d }, '', hash);
  render(false);
}
export function back() {
  if (depth() > 0) history.back();
  else go('#/home', { replace: true });
}
/** Update the query part of the current URL without adding a history entry or re-rendering. */
export function setQuery(q) {
  const { name, args } = parseHash(location.hash);
  const qs = Object.entries(q).filter(([, v]) => v != null && v !== '').map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');
  const hash = '#/' + [name, ...args.map(encodeURIComponent)].join('/') + (qs ? '?' + qs : '');
  history.replaceState({ d: depth() }, '', hash);
  if (current) current.key = hash;
}

function chrome() {
  const el = document.getElementById('app');
  el.innerHTML =
    '<header id="top"><button class="iconbtn" id="top-back" data-act="back" aria-label="Back">' + icon('back') + '</button>' +
    '<div id="top-brand"><span class="logo"></span><b>SC26 Atlas</b></div>' +
    '<h1 id="top-title"></h1><div id="top-actions"></div>' +
    '<button class="iconbtn" data-go="#/search" aria-label="Search" id="top-search">' + icon('search') + '</button>' +
    '<button class="iconbtn" data-go="#/settings" aria-label="Settings" id="top-settings">' + icon('gear') + '</button></header>' +
    '<main id="view" tabindex="-1"></main>' +
    '<nav id="tabs">' + TABS.map(([id, label, ic]) =>
      '<button data-tab="' + id + '" data-go="#/' + id + '">' + icon(ic) + '<span>' + label + '</span>' + (id === 'plan' ? '<i id="plan-badge"></i>' : '') + '</button>').join('') + '</nav>';
  updatePlanBadge();
}
function updatePlanBadge() {
  const b = document.getElementById('plan-badge'); if (!b) return;
  const n = Plan.count(); b.textContent = n ? String(n) : ''; b.style.display = n ? '' : 'none';
}

async function render(isBack, opts = {}) {
  const view = document.getElementById('view');
  const route = parseHash(location.hash);
  const def = views[route.name] || views.notfound;
  if (current) {
    scrollMemo.set(current.key, view.scrollTop);
    if (typeof current.cleanup === 'function') { try { current.cleanup(); } catch (e) { console.error(e); } }
  }
  closeSheet();
  const me = { name: route.name, def, key: location.hash, cleanup: null, actions: {} };
  current = me;
  const top = document.getElementById('top');
  const isRoot = !!def.root;
  top.classList.toggle('root', isRoot);
  top.classList.toggle('sub', !isRoot);
  document.getElementById('top-actions').innerHTML = '';
  const setTitle = t => { if (current === me) { document.getElementById('top-title').textContent = t || ''; document.title = (t ? t + ' · ' : '') + 'SC26 Atlas'; } };
  setTitle(typeof def.title === 'function' ? def.title(route.args, route.query) : def.title);
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === def.tab));
  document.body.classList.toggle('full', !!def.full);
  view.className = (def.full ? 'full ' : '') + 'v-' + route.name;
  view.innerHTML = '';
  view.scrollTop = 0;
  const ctx = {
    args: route.args, query: route.query, isBack,
    on: (name, fn) => { me.actions[name] = fn; },
    setTitle,
    setActions: html => { if (current === me) document.getElementById('top-actions').innerHTML = html; },
    // re-run the view. Keeps the scroll position unless { top: true } is passed.
    rerender: (o) => { if (current === me) render(true, o || {}); },
    alive: () => current === me,
  };
  try {
    const cleanup = await def.render(view, ctx);
    if (current !== me) { if (typeof cleanup === 'function') cleanup(); return; }
    me.cleanup = cleanup;
  } catch (e) {
    console.error(e);
    view.innerHTML = '<div class="empty">' + icon('info') + '<h3>Something went wrong</h3><p>' + esc(e && e.message || e) + '</p><button class="btn" data-go="#/home">Back to Today</button></div>';
  }
  view.classList.add(isBack ? 'enter-back' : 'enter');
  if (isBack && !opts.top && scrollMemo.has(me.key)) {
    const y = scrollMemo.get(me.key);
    requestAnimationFrame(() => {
      if (current !== me) return;
      // long lists render in chunks: load enough of them to reach the remembered position
      for (let guard = 0; guard < 80 && view.scrollHeight - view.clientHeight < y; guard++) if (!growLists()) break;
      view.scrollTop = y;
    });
  }
}

function onClick(ev) {
  const actEl = ev.target.closest('[data-act]');
  if (actEl && document.body.contains(actEl)) {
    const name = actEl.dataset.act;
    const fn = (current && current.actions[name]) || globalActions[name];
    if (fn) { ev.preventDefault(); ev.stopPropagation(); fn(actEl, ev); return; }
  }
  const goEl = ev.target.closest('[data-go]');
  if (goEl) {
    ev.preventDefault();
    const hash = goEl.dataset.go;
    const isTab = goEl.dataset.tab != null;
    // switching between tab roots should not pile up history entries
    go(hash, { replace: isTab && current && current.def.root && depth() === 0 });
    return;
  }
  const a = ev.target.closest('a[href]');
  if (a && /^(https?:|mailto:)/.test(a.getAttribute('href'))) {
    ev.preventDefault();
    Native.openExternal(a.href);
  }
}

function syncStars(id) {
  const on = Plan.has(id);
  document.querySelectorAll('.star[data-id="' + CSS.escape(id) + '"]').forEach(b => {
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
  });
}

export function initRouter() {
  chrome();
  document.addEventListener('click', onClick);
  window.addEventListener('popstate', () => render(true));
  bus.on('plan', updatePlanBadge);

  onGlobalAction('back', () => back());
  onGlobalAction('sheet-close', () => closeSheet());
  onGlobalAction('star', (el) => {
    const id = el.dataset.id; const it = DB.byId.get(id); if (!it) return;
    const on = Plan.toggle(it.id);
    syncStars(it.id);
    el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
    Native.haptic();
    toast(on ? 'Added to My Plan' : 'Removed from My Plan');
  });
  onGlobalAction('follow-person', (el) => {
    const on = Follows.togglePerson(el.dataset.id);
    el.classList.toggle('on', on);
    const s = el.querySelector('span'); if (s) s.textContent = on ? 'Following' : 'Follow';
    toast(on ? 'Following: their sessions rank higher in your schedule' : 'Unfollowed');
  });
  onGlobalAction('share-item', (el) => {
    const it = DB.byId.get(el.dataset.id); if (!it) return;
    const r = roomOf(it);
    const res = Native.share(it.t, it.t + '\n' + kindLabel(it) + ' · ' + fmtWhen(it) + (r ? ' · ' + r.n : '') + '\n' + siteUrl(it));
    if (res === 'copied') toast('Copied to clipboard');
  });
  onGlobalAction('open-ext', (el) => Native.openExternal(el.dataset.url));

  // Android back button / gesture. Returns true when the web app handled it.
  window.__sc26Back = () => {
    if (sheetOpen()) { closeSheet(); return true; }
    if (depth() > 0) { history.back(); return true; }
    if (current && current.name !== 'home') { go('#/home', { replace: true }); return true; }
    return false;
  };
  // A tapped session reminder opens the item.
  window.__sc26Open = (id) => { if (DB.byId && DB.byId.get(id)) go('#/item/' + id); };

  if (!location.hash || location.hash === '#') history.replaceState({ d: 0 }, '', '#/home');
  else if (!history.state) history.replaceState({ d: 0 }, '', location.hash);
  return render(false);
}

registerView('notfound', {
  title: 'Not found', root: false,
  render(el) { el.innerHTML = '<div class="empty">' + icon('compass') + '<h3>Page not found</h3><p>That screen does not exist.</p><button class="btn" data-go="#/home">Go to Today</button></div>'; },
});
