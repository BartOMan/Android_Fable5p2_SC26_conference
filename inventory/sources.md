# Sources

Everything the build touched, grouped by where it came from. Sizes are the
uncompressed size of what was downloaded. "Used" means the app's data was
built from it.

Status words used below:

- **Used**: downloaded and built into the app.
- **Sampled**: one example was read to learn what the page holds.
- **Referenced**: the source prints a link to it; it was not fetched.
- **Blocked**: a download was attempted and refused.
- **Not looked at**: it exists and was left alone.

## 1. The SC26 schedule site

Address: `https://sc26.conference-program.com/`. A WordPress site (version
7.1.4) with the Linklings program plugin (`linklings_wp_program`, version
1.2.119). All pages are public and need no sign-in. All of them are HTML.

### 1a. Pages that hold the whole program (used)

Seven kinds of page, 14 downloads. Between them they held every session,
presentation, abstract, contributor, organization and room.

| # | Page | Address | Size | What is in it |
|---|---|---|---|---|
| 1 | Full Program page | `/` | 0.1 MB | The frame of the schedule: filter menus and the names of the eight daily files. No program entries of its own |
| 2 | Daily schedule files, one per day, 14 to 21 Nov | `/wp-content/linklings_snippets/wp_program_view_all_YYYY-MM-DD.txt` | 8 files, 10.2 MB | An HTML table. One row per session: time, event types, title, chairs or speakers, room, tags. 407 sessions in total. For 66 sessions a second, hidden row holds the description and a nested table of its talks (233 talks) |
| 3 | Search page | `/search-program/` | 11.7 MB | Four lists on one page: 1,363 presentations with abstract, people, room, time and tags; 254 sessions; 1,651 organizations; 3,977 contributors |
| 4 | Contributor index | `/contributors/` | 3.8 MB | 3,977 people, A to Z: name, organizations, country, and the presentations each person is on |
| 5 | Organization index | `/organizations/` | 14.1 MB | 1,651 organizations: their presentations, sessions, contributors and session chairs; for 581 exhibitors also booth, description and website |
| 6 | Posters page | `/posters/` | 2.1 MB | 199 posters with full detail: abstract, authors, preview image, video for 39, related posters |
| 7 | Map page | `/map/` | 0.1 MB | A frame that loads the venue map from Mapplic (section 2) |

Things worth knowing about these pages:

- The Full Program page shows the site's own filter lists: 27 event types,
  23 topic tags, 66 rooms, hourly time slots, 4 registration passes, 4
  recording options and 62 time zones.
- Each daily file also repeats the sessions of the day before and the day
  after, so every session appears in three files. The file carries the time
  the site last rebuilt it (`2026-11-17 18:34:49`).
- Times are printed twice: as text in Chicago time and as an exact UTC time
  in an attribute (`s_utc`, `e_utc`, `utc_time`). The app reads the UTC value.
- The search page alone covers every presentation. The daily files alone
  cover every session. Together they were enough for the whole program.

### 1b. One page per session (used in part)

| Page | Address | Fetched | What it adds |
|---|---|---|---|
| Session page | `/session/?sess=<session id>` | 124 of 407, 13.8 MB | Description, chairs with their organizations, the ordered list of talks with times and role labels (Authors, Presenter, Panelists, Moderator, Organizers), "Similar Sessions", a feedback link |

The site stopped answering during this download. The remaining 283 session
pages were not fetched. For 66 sessions the daily files already carry the
same description and talk list.

### 1c. Pages read once to see what they hold (sampled)

| Page | Address | What it holds |
|---|---|---|
| Presentation page | `/presentation/?id=<presentation id>&sess=<session id>` | Everything the search page has, plus a link to the published paper in the IEEE Computer Society Digital Library, author photos, "Next Presentation" and "Similar Presentations" |
| Person page | `/presenter/?uid=<person id>` | Name, organizations, biography, photo, and the person's presentations |
| Location page | `/map/?location=<location id>` | The map page opened on one room |
| One photo | `/wp-content/linklings_snippets/presenter_pics/wp_presenter_img_<person id>.jpg` | A 200 x 200 portrait. Fetched once to confirm the address pattern; not kept |
| Plugin script | `/wp-content/plugins/linklings_wp_program/public/js/full_program.js` | Read to learn how the page loads the daily files |

### 1d. Referenced by the source, not fetched

| What | Where the link appears | Why it was not fetched |
|---|---|---|
| 1,362 more presentation pages | every presentation title | Blocked before this step |
| 3,900 more person pages (3,901 people have a profile id) | every person's name | Blocked before this step |
| Contributor photos | poster author lists mark 150 people as having one | Blocked. The app loads these 150 online when the phone is connected |
| 199 poster preview images | posters page | Blocked. The app loads them online when the phone is connected |
| Organization pages, `/organization/?inst=<organization id>` | every organization name | Not fetched; the organization index was used |
| Calendar files, `get_cal.php?id=<session id>` or `<session id>--<presentation id>` | every session and talk | Not needed; the app writes its own calendar file |
| Videos on Vimeo | 39 posters | The app keeps the link and opens it in the browser |
| Feedback forms on `submissions.supercomputing.org` | session pages | Not relevant to the app |
| Outside links added by authors (GitHub, project sites) | 11 posters | The app keeps the links |

### 1e. On the site and not looked at

- Menu pages: Attendees, My Schedule, Recommendations, Happening Now, Career
  Fair, SC Steps Challenge, Support, Preferences. None of them was opened, so
  it is not known which need a sign-in.
- The site's programming addresses under `/wp-json/`. They were visible in
  the page source and were never called.
- Exhibitor descriptions and websites. They are in the organization index
  that was downloaded, and the app does not carry them. It keeps only the
  exhibitor flag and booth number.

## 2. The venue map

The map on the schedule site is drawn by Mapplic, a separate map service.

| # | Source | Address | Format | Size | What is in it | Status |
|---|---|---|---|---|---|---|
| 8 | Map data | `https://mapplic.com/getMapData?id=<map id>` | JSON | 0.4 MB | 7 floors, 764 named places with coordinates (141 rooms and areas, 623 exhibitor booths), 2,142 walkway line segments, display settings | Used |
| 9 | Floor plans | one file per floor on `firebasestorage.googleapis.com` | SVG drawings | 7 files, 1.9 MB | West Building levels 1 to 4, South Building level 1, Lakeside Center level 3, campus overview | Used |

The 64 rooms that the program uses all appear in the map data under the same
identifier, which is what lets the app drop a pin on the right room. Booth
positions (623) are in the data and the app does not use them.

## 3. Outside sources

| # | Source | Address | Format | Size | What was taken | Status |
|---|---|---|---|---|---|---|
| 10 | OpenAlex, an open index of research papers | `https://api.openalex.org/works?filter=primary_location.source.id:S4363608557,publication_year:2010-2025` | JSON, 14 pages of 200 | 14.5 MB | 2,770 papers published under the SC conference, 2010 to 2025: title, year, citation count, DOI, and 15,178 author entries with name and organization | Used |
| 11 | DBLP, a computer science bibliography | `https://dblp.org/search/publ/api` | | | Nothing. The site answered with a "making sure you're not a bot" page | Blocked, not used |
| 12 | World map outlines (`world-atlas` package, file `countries-110m.json`) | npm package registry | JSON (TopoJSON) | 0.1 MB | Country shapes for the globe | Used |
| 13 | Charting library (`d3` 7.9.2) and map helper (`topojson-client` 3.1.0) | npm package registry | JavaScript | 0.3 MB | Program code, no conference data | Used |
| 14 | Main conference site home page | `https://sc26.supercomputing.org/` | HTML | 0.2 MB | Only the link to the schedule site. None of its other pages were read | Used to find the schedule site |

## 4. How the download went

1. The eight daily files and the five index pages were fetched one after
   another. This worked.
2. Session pages were then requested five at a time with no pause. After
   about 126 requests in a few seconds the site stopped accepting
   connections from this computer. It was still refusing more than six hours
   later.
3. The downloader (`scraper/fetch.py`) was changed to fetch one page at a
   time with a pause and to stop at the first sign of a block.

In total the schedule site served about 150 pages and 56 MB before the block.
