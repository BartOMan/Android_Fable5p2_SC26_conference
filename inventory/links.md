# Who connected what

The app moves freely between talks, people, organizations, rooms and topics.
This file separates the connections the source already printed from the ones
the app had to make.

A "connection" here means: given one record, you can find the related record
without guessing, because both carry the same identifier.

## A. Connections supplied by the source

The app uses these as they are. Identifiers are described in
[records.md](records.md).

| # | From | To | How the source prints it | Where | How many |
|---|---|---|---|---|---|
| 1 | Presentation | its Session | Session and presentation identifiers side by side on every entry | search page, session pages, daily files, posters page | all 1,363 presentations; 39 sit under two sessions |
| 2 | Session | its presentations, in order, with start and end times | A nested table of rows | session pages, hidden rows of the daily files | 279 sessions have presentations |
| 3 | Session | "this session is one presentation" | The session row carries the presentation's identifier | daily files | 152 sessions |
| 4 | Presentation | People, in author order | A link with the person identifier for every name | search page | 5,516 pairs on 1,251 presentations |
| 5 | Person on a presentation | presenting or not | A mark on each name | search page | 1,998 names marked presenting |
| 6 | Person on a presentation | role (author, presenter, panelist, moderator, organizer, alternate) | A heading above each group of names | session pages and hidden rows only | 984 of 1,363 presentations |
| 7 | Session | its chairs | Links marked as session chair | daily files, session pages | 348 pairs, 170 sessions |
| 8 | Person | Organizations | A link with the organization identifier next to the name, repeated wherever the person is listed | every list of people | 4,844 pairs, 3,970 people |
| 9 | Person | Country | Text after the name | contributor index only | 3,669 people |
| 10 | Person | all their presentations | A list under each name | contributor index | 5,846 entries |
| 11 | Organization | its presentations, sessions and people | Lists under each organization | organization index | 1,159 / 185 / 1,157 organizations |
| 12 | Session, Presentation | Room | A link with the location identifier | daily files, search page | 405 of 407 sessions; all presentations |
| 13 | Room | floor and position on the plan | The map data uses the same location identifier as the schedule | map data | 64 of 64 program rooms found |
| 14 | Floor | its drawing | File address in the map data | map data | 7 |
| 15 | Floor | walkway lines | Line segments tied to a floor | map data | 2,142 |
| 16 | Exhibitor | booth, and booth position on the map | Booth link on the organization; the map entry links back to the organization | organization index, map data | 581 exhibitors, 623 booths |
| 17 | Session, Presentation | Event types | Codes with names | everywhere | all |
| 18 | Session, Presentation | official topic tags | Codes with names | daily files, search page | 179 sessions, 876 presentations |
| 19 | Session, Presentation | recording tags and registration passes | Codes with names | daily files, search page | nearly all |
| 20 | Poster | preview image, video, authors' own links | Addresses in the poster entry | posters page | 199 / 39 / 11 |
| 21 | Person | photo | The photo's address is built from the person identifier | posters page, presentation and person pages | 150 people known to have one |
| 22 | Person | biography | Text on the profile | person page | seen once; not downloaded |
| 23 | Presentation | the published paper | A link to the IEEE Computer Society Digital Library | presentation page | seen once; not downloaded |
| 24 | Presentation | similar presentations | A list picked by the site | posters page, presentation page | 190 posters |
| 25 | Session | similar sessions | A list picked by the site | session pages | 123 of 124 pages read |
| 26 | Presentation | next presentation | A link | presentation page | seen once |
| 27 | Session, Presentation | calendar file | A link | everywhere | all |

Two things made the source easy to work with:

- **One identifier per thing, used on every page.** A person has the same
  identifier in the search page, the contributor index, a session page and a
  poster entry. No matching by name was needed inside the schedule site.
- **The schedule and the map share room identifiers.** The map is a separate
  service, yet a room in the schedule (`rW175abc`) is found in the map data
  under the same name. All 64 rooms matched without any hand work.

## B. Source connections the app does not use

| Source connection | What the app does instead |
|---|---|
| Similar presentations and similar sessions picked by the site (24, 25) | Computes its own "related work" from the text. The site's lists were only available for posters and 124 sessions |
| Next presentation (26) | Shows "at the same time" and the session's own order |
| Calendar files (27) | Writes its own calendar file and reminders |
| The contributor index's list of each person's presentations (10) and the organization index's lists (11) | Rebuilds both from connection 4 and 8, which gives the same result |
| Booth positions and exhibitor descriptions and websites (16) | Keeps only an exhibitor flag and the booth number |
| "Poster Blitz" marker, title after the name ("PhD"), feedback links | Not shown |

Connections 22 and 23 (biography, published paper) and most of 21 (photos)
are missing from the app because the pages could not be downloaded.

## C. Connections the app built

"How firm" says how far to trust the result: **exact** means it follows
from the source without judgment, **rule** means a hand-written rule that
was checked by eye, **estimate** means it can be wrong for individual cases.

| # | What the app built | From what | How | How many | How firm |
|---|---|---|---|---|---|
| 1 | One list holding sessions and presentations | Connections 1 to 3 | A session that is a single presentation is folded together with it; a presentation listed twice is kept once and shown under both sessions | 1,615 items; 155 folded; 39 listed twice | Exact |
| 2 | Breaks and poster kinds | Presentation identifier prefix and title | `brea...` is a break; `rpost`, `src_post`, `drs`, `int_post`, `art` give the kind of poster | 89 breaks; 199 posters | Rule |
| 3 | 23 formats in three groups (technical, community, vendor) and one main format per item | The 27 event types | A hand-written table and a fixed priority order (Keynote before Invited Talk before Paper ...) | 13 technical, 8 community, 2 vendor formats | Rule |
| 4 | Award marks | Event types "Best Paper Finalist", "Best Student Paper Finalist", "Gordon Bell" | Direct | 13, 13 and 12 items | Exact |
| 5 | Duplicate people merged | Name and organizations | Two profiles are one person when the names are identical and they share an organization | 30 merged, 3,947 people left | Rule |
| 6 | Organization spellings merged | Organization names | Names compared without case, accents, punctuation and bracketed short names, plus about 40 hand-written aliases (LLNL, anything starting with NVIDIA, ...) | 1,680 identifiers become 1,547 organizations | Rule |
| 7 | Organization sector | Organization name, exhibitor flag | Word patterns: university, lab or research center, industry, other | 553 / 225 / 588 / 181 | Estimate |
| 8 | Organization country | Connection 8 and 9 | The most common country among its people | 1,014 organizations | Estimate |
| 9 | Country names cleaned and placed on a map | Country text | 49 spellings become 46 countries; a hand-written table adds the standard country code and a map position; the code matches a public world map | 46 | Rule |
| 10 | Research themes | Titles and abstracts | 36 themes, each a hand-written list of weighted words and phrases tuned to this program (`scraper/themes.py`); a title hit counts three times | 2,989 item-to-theme links on 1,366 items; 98% of items with text get a theme | Rule, tuned by hand |
| 11 | Related work | Titles and abstracts | Word-weight comparison of texts (TF-IDF, cosine similarity); the six closest items | 6,406 links among the 1,136 items with enough text | Estimate |
| 12 | Key terms per item | Same text model | The most characteristic words of each item | 1,136 items | Estimate |
| 13 | Galaxy positions | Same text model | A two-dimensional layout that keeps similar texts close (t-SNE) | 1,136 items | Estimate; only nearness is meaningful |
| 14 | Buzzwords | Titles | Most frequent words and two-word phrases after removing a hand-written list of generic words | 90 | Rule |
| 15 | Who works with whom | Connection 4 | Two people are linked when they share an item with at most 40 people | 15,051 pairs | Exact |
| 16 | Activity ranking | Connections 4 to 7 and the formats | Weighted count: a keynote counts more than a paper, a paper more than a poster; presenting counts more than co-authoring | every person | Rule; the weights are a judgment |
| 17 | Earlier SC papers | OpenAlex and the person's name and organizations | Match on first and last name without accents or initials; when a name is shared, only papers whose organization matches count | 1,373 people | Estimate; namesakes can slip in |
| 18 | Building and floor names for rooms | Floor identifiers in the map data | Hand-written names for the 7 floors | 64 rooms | Exact for this venue |
| 19 | Walking minutes between rooms | Room positions (13) | Distance on the plan turned into minutes, with fixed additions for changing level, wing or building | any pair of rooms | Estimate |
| 20 | Walking route on a floor | Walkway lines (15) and room positions | Each room is attached to the nearest walkway point; shortest path along the lines (`scraper/build_routes.py`) | same-floor pairs; West level 1 splits into two unconnected wings | Rule; not checked in the building |
| 21 | Interest match, built schedule | Themes, tags, keywords, followed people, times, rooms | Scores every item, then picks the non-overlapping set with the highest total that leaves time to walk | computed on the phone | Rule |
| 22 | "Now", "next", time blocks, overlap warnings | Times | Comparison with the clock and with each other | all items | Exact |
| 23 | Search | Titles, abstracts, names, organizations, rooms, tags, themes | A word index built on the phone | all items | Exact matching, ranked by rule |

## D. Screen by screen

| Screen or feature | Source connections used as they are | Added by the app |
|---|---|---|
| Today | Times, rooms (12) | "Now" and "next" from the clock; order by interests |
| Schedule list and room grid | Session times, rooms, event types, tags; session to talks (1, 2, 12, 17, 18) | Formats and the "technical program only" switch; grouping by start time; theme filter |
| Search | Titles, abstracts, people, organizations, rooms, tags | Index and ranking; theme matches |
| Session and talk pages | Session and its talks, people in order with presenting marks and roles, room, tags, poster image, video (1 to 7, 12, 17 to 20) | Related work, key terms, "at the same time", themes, notes, reminders |
| Person page | The person's talks, organizations, country, photo address (4, 8, 9, 21) | Co-authors, earlier SC papers, conversation starters |
| People lists | The people themselves | Activity ranking, "SC veterans", "For you" |
| Organization page and leaderboard | Organization to people to talks (8, 4) | Merged spellings, sector, country, theme breakdown |
| Themes, topics by day, buzzwords, topic galaxy | Official tags shown next to the themes (18) | Themes, similarity, layout, buzzwords |
| Formats, conference pulse | Event types, times (17) | Format grouping; counting sessions per quarter hour |
| World of SC26 and country pages | Person to country (9) | Country to map shape; organization to country |
| Collaboration network | Talk to people (4) | Pairs of people; coloring by sector or country |
| Venue map and room pages | Shared room identifier, positions, floor plans, walkway lines (13 to 15) | Pin colors from the clock, walking minutes, shortest route, building names |
| Posters | Poster entries, preview image, video (20) | Themes, match score |
| Schedule builder and My Plan | Times, rooms, registration passes (12, 19) | Scoring, choosing the plan, walking gaps, calendar file, reminders |

## E. What this build depended on

These are the properties of the SC26 source that the app's seamless feel
rests on. Each one is a question to ask of any other conference site.

1. Is the whole program public, without a sign-in?
2. Are there a few large pages that list everything (all presentations with
   abstracts, all contributors, all organizations), or only one page per
   item?
3. Does every session, presentation, person, organization and room carry an
   identifier that stays the same from page to page?
4. Does each presentation name its session, and each session list its talks
   with times?
5. Are people listed with their organization, a presenting mark and a role?
6. Is a country (or city) given for people or organizations?
7. Are exact times available, with the time zone stated?
8. Is there a venue map with data behind it, and does it use the same room
   names or identifiers as the schedule?
9. Are there official topic tags, and how much of the program do they cover?
10. Are abstracts present for most items? Themes, related work and the
    galaxy all come from abstract text.
11. Are photos, biographies and paper links on separate per-item pages, and
    how fast may those pages be requested?
