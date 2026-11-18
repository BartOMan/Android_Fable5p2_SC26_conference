// SC26 Atlas: bootstrap. Loads the data bundle, then every view module, then starts the router.
import { loadData, DB, Store, bus, resyncReminders } from './core.js';
import { initRouter } from './router.js';

// A view module that fails to load is reported and skipped; the rest of the app keeps working.
const VIEW_MODULES = [
  'home', 'schedule', 'item', 'search', 'people', 'person', 'plan', 'builder', 'explore', 'settings', 'posters',
  'galaxy', 'charts', 'globe', 'network', 'orgs', 'map',
];

const msg = t => { const el = document.getElementById('splash-msg'); if (el) el.textContent = t; };

async function boot() {
  try {
    await loadData(msg);
    msg('Preparing views…');
    const failed = [];
    await Promise.all(VIEW_MODULES.map(m => import('./views/' + m + '.js').catch(e => { failed.push(m); console.error('view module failed: ' + m, e); })));
    window.SC26 = { DB, Store, bus, failedViews: failed };   // handy for debugging and automated tests
    await initRouter();
    try { resyncReminders(); } catch (e) { console.warn('reminder resync failed', e); }
    const s = document.getElementById('splash');
    s.classList.add('hide'); setTimeout(() => s.remove(), 450);
    document.documentElement.dataset.ready = '1';
  } catch (e) {
    console.error(e);
    msg('Could not start: ' + (e && e.message || e));
    document.documentElement.dataset.ready = 'error';
  }
}
boot();
