# SC26 Atlas web app: developer notes

SC26 Atlas is an offline conference companion for SC26 (Chicago, 15–20 Nov 2026).
The web app in `app/web/www` runs inside an Android WebView (served from
`https://appassets.androidplatform.net/assets/www/`) and in any desktop browser
for development. There is no build step and no network access at runtime:
everything is plain ES modules, plain CSS and bundled JSON.

## Run and test

```bash
# serve the app (already running on this machine during development)
python3 -m http.server 8765 --bind 127.0.0.1 --directory app/web/www
# open http://127.0.0.1:8765/index.html?now=2026-11-18T10:40#/home

# screenshot one screen at phone size and list console errors
NODE_PATH=/tmp/sc26build/webtest/node_modules node app/web/tests/shot.mjs '#/home' /tmp/out.png now=2026-11-18T10:40 full=1

# run every browser test (add a width such as 360 to test a narrow phone)
NODE_PATH=/tmp/sc26build/webtest/node_modules node app/web/tests/run_all.mjs
```

`?now=YYYY-MM-DDTHH:MM` simulates the conference-local clock (CST, UTC-6).
The entry page is `index.html`, the same file the APK loads.
`playwright-core` is installed in `/tmp/sc26build/webtest/node_modules`; launch
Chrome with `chromium.launch({ channel: 'chrome', headless: true })`, viewport
412 x 915, `isMobile: true, hasTouch: true`. Wait for
`document.documentElement.dataset.ready === '1'` before interacting.
`window.SC26 = { DB, Store, bus, failedViews }` is exposed for tests.

## Files

| Path | Role |
|---|---|
| `js/core.js` | data loading and indexes (`DB`), time helpers, `Store`/`Plan`/`Follows`, search, interest matching (`relevance`), walking estimate (`walkMin`), calendar export, `Native` bridge |
| `js/ui.js` | HTML-string components: `itemCard`, `talkRow`, `personRow`, `orgRow`, `avatar`, `chip`, `pill`, `section`, `icon`, `emptyState`, `openSheet`, `toast`, `lazyList`, `esc` |
| `js/router.js` | `registerView`, `go`, `back`, `setQuery`, click delegation, top bar, tabs |
| `js/app.js` | bootstrap; lists the view modules to import |
| `js/views/*.js` | one module per screen group; each calls `registerView` |
| `css/app.css` | design tokens and shared components. Read it before writing styles |
| `css/views.css`, `css/viz.css`, `css/geo.css`, `css/map.css` | per-area styles |
| `vendor/d3.min.js` | d3 v7 as the global `d3` (classic script) |
| `vendor/topojson-client.min.js` | global `topojson` |
| `data/core.json`, `data/text.json`, `data/world-110m.json` | bundled data |
| `data/routes.json` | walkway network per floor for the venue map (built by `scraper/build_routes.py`) |
| `map/*.svg` | floor plans (800 x 1000 viewBox) |

## View contract

```js
import { DB, nowMin } from '../core.js';
import { registerView, go } from '../router.js';
import { esc, itemCard, section } from '../ui.js';

registerView('themes', {
  title: 'Themes',            // string or (args, query) => string
  tab: 'explore',             // which bottom tab stays highlighted
  root: false,                // true only for the five tab roots
  full: false,                // true = edge-to-edge, no padding, view manages its own scrolling
  render(el, ctx) {           // el is the empty <main id="view">; may be async
    el.innerHTML = '...';
    ctx.on('my-action', (target, event) => { /* handles clicks on [data-act="my-action"] */ });
    return () => { /* cleanup: timers, observers, animation frames, listeners */ };
  },
});
```

- Route `#/name/arg1/arg2?k=v` gives `ctx.args = ['arg1','arg2']`, `ctx.query = {k:'v'}`.
- Navigation: put `data-go="#/item/<id>"` on any element, or call `go('#/...')`.
- Actions: `data-act="name"` plus `ctx.on('name', fn)`. Global actions that already
  work everywhere: `star` (with `data-id="<item id>"`), `follow-person`, `share-item`,
  `open-ext` (with `data-url`), `back`, `sheet-close`.
- `ctx.setTitle(text)`, `ctx.setActions(html)` (buttons at the right of the top bar),
  `ctx.rerender()` (keeps scroll position), `ctx.alive()`.
- `setQuery({k: v})` rewrites the URL query without re-rendering, so state survives Back.
- Always return a cleanup function when the view starts timers, animation frames,
  observers, d3 simulations or window listeners.
- Query parameters the views understand: `schedule` `d f g th mine live v`; `search` `q`; `people` `tab q c`;
  `builder` `step`; `posters` `kind th q`; `galaxy` `theme it q`; `theme` and `tag` `d`; `heatmap` `s m`;
  `globe` `c scale`; `network` `p color`; `orgs` `k s q`; `map` `layer from sel`; `room` `d`.
- Existing routes you can link to: `#/item/<itemId>`, `#/person/<personId>`,
  `#/org/<orgIdx>`, `#/theme/<themeId>`, `#/tag/<tagIdx>`, `#/country/<countryIdx>`,
  `#/room/<roomIdx>`, `#/map/<roomIdx>`, `#/search?q=text`, `#/schedule?d=<day>`,
  `#/galaxy`, `#/globe`, `#/network?p=<personId>`, `#/orgs`, `#/people`, `#/plan`, `#/builder`.

## Data model (`DB` after `loadData()`)

Times are minutes since the Unix epoch (UTC). Use the helpers in `core.js`
(`dayOf`, `minOfDay`, `fmtTime`, `fmtRange`, `dayInfo`, `nowMin`) and never `new Date()`
for conference times. Conference days are indexes 0..7 (Sat 14 Nov .. Sat 21 Nov).

- `DB.items[i]`: sessions and talks.
  - `i` index, `id` (`sess201` or `sess201/pap1017`), `k` `'S'` session or `'P'` talk/poster inside a session
  - `t` title, `s`/`e` start/end minute, `day`, `dur`, `r` room index (may be undefined)
  - `f` primary format index into `DB.formats`, `fs` all format indexes, `grp` `'tech' | 'community' | 'vendor'`
  - `fl` flags, see `FLAG` (`BREAK`, `POSTER`, `LIVE`, `REC`, `BEST_PAPER`, `BEST_STUDENT`, `GB`, `TEXT`); `brk` true for breaks
  - `g` official topic tag indexes (`DB.tags`), `th` curated themes as `[[themeIdx, strength 1..9], ...]` strongest first
  - `p` people as `[[personIdx, roleIdx, presenting 0|1], ...]` (`DB.roles[roleIdx]`)
  - `par` parent session index (talks), `ch` child indexes (sessions), `leaf` true when it has no children
  - `x` `[x, y]` in 0..1000: position in the 2-D similarity layout (only content items, about 1,100 of them)
  - `sim` up to 6 most similar item indexes, `kw` up to 5 characteristic terms
  - `dl` paper link, `ln` extra links, `img` poster thumbnail file in `img/poster/`, `sub` poster kind, `alt` other sessions that list it
  - `DB.text[i]` abstract or description
- `DB.formats[f]`: `{id, n, grp, c}` (c = color). `DB.tags[g]`: `{id, n, items[]}`.
- `DB.themes[t]`: `{id, n, c, cnt, items[]}`: 36 curated research themes, each with its own color.
- `DB.people[p]`: `{i, id, n, o:[orgIdx], c: countryIdx | -1, w: activity score, ni, items:[[itemIdx, roleIdx, presenting]], ph: 1 when a photo is bundled, px, sc}`.
  `sc = [papers, firstYear, lastYear, citations, topTitle, topYear, topCitations]` = prior papers in the SC proceedings 2010–2025 (OpenAlex, matched by name).
  Use `avatar(p, size)` from `ui.js` for portraits.
- `DB.orgs[o]`: `{i, n, k: 'edu'|'lab'|'com'|'oth', c: countryIdx, np, ni, people[], items:Set, ex, booth}`.
- `DB.countries[c]`: `{i, name, num (ISO 3166 numeric, matches world-110m ids), lat, lon, np, people[], orgs:Set}`.
- `DB.rooms[r]`: `{i, id, n, l: layer id, x, y (0..1 on that layer's floor plan), b: building, f: floor, items[]}`.
- `DB.layers`: `{id, n, b, f, file, w, h}` floor plans.
- `DB.buzz`: `[[term, count], ...]` frequent title terms.
- `visible(it)` applies the user's "technical program only" setting. Use it for lists and charts
  unless the screen is about one specific item.
- Saved plan: `Plan.has(id)`, `Plan.toggle(id)`, `Plan.items()`. Interests: `interestProfile()` then `relevance(it, prof).score`.

## Conventions

- Dark theme only. Use the CSS variables in `app.css` (`--card`, `--line`, `--tx2`, `--acc`, `--grad`, ...).
- Touch first: tap targets at least 40 px, no hover-only affordances, no tooltips that need a mouse.
- Screens are about 360–430 CSS px wide. Check 360 px as well as 412 px.
- Canvas drawing: size the backing store by `devicePixelRatio` (cap at 2.5), redraw on resize,
  keep 60 fps while panning on a mid-range phone (batch by color, avoid per-point shadows).
- Escape every piece of program text with `esc()` before putting it in HTML.
- Plain language in the UI. No "lorem", no placeholder text, no dead buttons.
- Sector and "prior SC papers" are estimates. Label them as estimates where shown.
