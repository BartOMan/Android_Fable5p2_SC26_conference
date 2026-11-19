# Record types, identifiers and fields

The source is a set of record types that refer to each other by identifier,
printed as HTML. This file lists each type, how it is identified, which
fields it carries, and how complete each field was in the SC26 download.
The real excerpts in [samples/](samples) show what each looks like.

Counts are from [counts.json](counts.json).

## Session

A block in the schedule: a paper session, a workshop, a tutorial, a Birds of
a Feather meeting, a reception.

- **Identifier:** `sess` plus a number, for example `sess201`. Printed as the
  attribute `psid` on every row and in every link (`?sess=sess201`).
- **Count:** 407.

| Field | Where it is printed | Filled in |
|---|---|---|
| Title | daily files | 407 of 407 |
| Start and end time (exact UTC, plus Chicago time as text) | daily files | 407 |
| Event types, one to three per session | daily files | 407; 20 sessions carry two or more |
| Room | daily files | 405 |
| Official topic tags | daily files | 179 |
| Recording tags (Livestreamed, Recorded, ...) and registration passes | daily files | nearly all |
| Chairs, as links to people | daily files, session page | 170 sessions, 348 chair entries, 272 people |
| "This session is a single presentation" marker (the row carries that presentation's identifier) | daily files | 152 |
| Description | hidden row in the daily files, session page | 92 captured (89 of the 124 session pages had one) |
| Its presentations, in order, with times and role labels | hidden row in the daily files (66 sessions), session page | 279 sessions have at least one presentation; 128 have none |
| "Similar Sessions" picked by the site | session page | 123 of the 124 pages read |
| Calendar file link, feedback link | daily files, session page | all |

Event types and how many sessions carry each: Birds of a Feather 79,
Community Engagement 66, Workshop 50, Paper 42, Tutorial 33, Regional Tech
Hub 23, Panel 21, Exhibits 19, Exhibitor Forum 15, Art of HPC 13,
Students@SC 11, Posters 9, SCC Connect 7, Student Cluster Competition 7,
Reception 6, Awards and Award Talks 6, Invited Talk 6, Keynote 3, SCinet
Network Research Exhibition 3, Best Paper Finalist 3, Best Student Paper
Finalist 3, ACM Gordon Bell Finalist 2, Early Career 1, HPC Unites Plenary 1,
ACM Gordon Bell Climate Modeling Finalist 1, Career Fair 1, SC27 1.

## Presentation

One talk, paper, poster, panel or other item inside a session.

- **Identifier:** a short type prefix plus a number, for example `pap1017`,
  `bof234`, `rpost163`, `ws_pdsw103`. It is always printed together with its
  session identifier (`psid="sess201" ssid="pap1017"`).
- **Count:** 1,363 distinct presentations. 39 of them are listed under a
  second session as well (a poster in the display session and in the
  reception; a doctoral showcase talk and its poster), which gives 1,402
  listings.

| Field | Where it is printed | Filled in |
|---|---|---|
| Title | search page | 1,363 of 1,363 |
| Session it belongs to | search page | 1,363 |
| Start and end time | search page | 1,363 |
| Room | search page | 1,363 |
| Event types | search page | 1,363 |
| Abstract (the site calls it "Description") | search page | 1,161 |
| People, in order, each with organizations and a presenting / not presenting mark | search page | 1,251 presentations; 5,516 distinct person-on-presentation pairs; 1,998 entries marked presenting |
| Role label for each group of people (Authors, Presenter, Author/Presenter, Panelists, Moderator, Organizers, Alternate Presenter) | session page and the hidden rows of the daily files only | available for 984 of the 1,363 presentations: those in the 149 sessions whose page or hidden row was read |
| Official topic tags | search page | 876 |
| Recording tags and registration passes | search page | nearly all |
| Preview image | posters page | 199 posters |
| Video (Vimeo) | posters page | 39 posters |
| Links added by the authors | posters page | 11 posters |
| "Poster Blitz" marker | posters page | 39 posters |
| "Similar Presentations" picked by the site | posters page, presentation page | 190 posters |
| Link to the published paper | presentation page | seen on the one page read |
| "Next Presentation" | presentation page | seen on the one page read |

What the identifier prefixes stand for, read from the event types of the
items that carry them:

| Prefix | Count | Kind |
|---|---|---|
| `ws_...` (53 different, one per workshop series) | 453 | Workshop papers and talks |
| `misc`, `miscp` | 173, 29 | Program items without a submission of their own: openings, invited talks inside workshops, panels, closings |
| `pap` | 149 | Papers |
| `rpost` | 118 | Research posters |
| `brea` | 89 | Breaks |
| `bof` | 79 | Birds of a Feather |
| `exforum` | 43 | Exhibitor Forum talks |
| `wksp` | 41 | A workshop's own entry, listing its organizers |
| `src_post` | 37 | ACM Student Research Competition posters |
| `tut` | 31 | Tutorials |
| `art`, `artc` | 22, 5 | Art of HPC pieces |
| `pan` | 20 | Panels |
| `nre` | 15 | SCinet Network Research Exhibition |
| `mtgt` | 15 | Meet-and-greet sessions |
| `drs` | 12 | Doctoral Showcase |
| `inv` | 12 | Invited talks |
| `gb`, `gbv` | 6, 3 | Gordon Bell finalists and Gordon Bell climate modeling finalists |
| `int_post` | 5 | Interactive research e-posters |
| `awd` | 4 | Award talks and the awards ceremony |
| `key`, `hpcplen` | 1, 1 | Keynote, plenary |

## Person

Anyone named in the program: author, speaker, panelist, organizer, chair.

- **Identifier:** `uid`, a number. 3,901 people have a six-digit one
  (`uid=360143`); 76 have a long one. Printed in every link to a person.
- **Count:** 3,977 in the contributor index. All but 2 also appear on a
  presentation or as a session chair.

| Field | Where it is printed | Filled in |
|---|---|---|
| Name | everywhere a person is listed | 3,977 |
| Organizations, as links | next to the name in every list | 3,970 people; 716 have two or more; 4,844 person-organization pairs |
| Country, as text | contributor index only | 3,669 (49 different spellings) |
| Their presentations, each with its event type | contributor index | 5,846 entries |
| "Has a photo" (the photo itself is at an address built from the `uid`) | author lists on the posters page and on presentation pages | 150 people known |
| Title after the name, such as "PhD" | contributor index | 8 people; the app does not carry it |
| Biography | person page | seen on the one page read |
| Photo | person page | seen on the one page read |

The pages that were read print no email address, job position, personal web
page or ORCID for a person.

## Organization

- **Identifier:** `inst`, a long number (`inst=15890852802229824650`).
  Printed in every link to an organization.
- **Count:** 1,651 in the organization index. 1,680 identifiers appear in
  total, because 29 are used only next to a person's name. People point at
  1,179 of them; most of the rest are exhibitors.

| Field | Where it is printed | Filled in |
|---|---|---|
| Name | everywhere | all |
| Exhibitor: booth number (a link to the map), description, website | organization index | 581 exhibitors; 542 with a website |
| Its presentations | organization index | 1,159 organizations |
| Its sessions | organization index | 185 |
| Its people, under "Contributors" and "Session Chairs" | organization index | 1,157 |

The source gives an organization no country, no type (university, lab,
company) and no parent. The same organization often appears under several
identifiers with slightly different spellings ("Argonne National
Laboratory" and "Argonne National Laboratory (ANL)").

## Room and other places

- **Identifier:** a location name with a letter in front: `r` for rooms and
  areas (`rW175abc`), `b` for exhibitor booths (`b1854`). The schedule pages
  and the map data use the same identifiers.
- **Count:** the program uses 64 rooms. The map data lists 764 places: 141
  rooms and areas, 623 booths.

| Field | Where it is printed | Filled in |
|---|---|---|
| Name | schedule pages, map data | all |
| Floor (`layer`) | map data | all 764 |
| Position on the floor plan, as fractions of its width and height | map data | all 764 |
| Zoom level the site uses for it | map data | all 764 |
| Booths: link to the exhibitor's organization identifier | map data | 623 |

Other map records: 7 floors, each with a name and a drawing; 2,142 walkway
line segments, each tied to a floor, that the site uses to draw walking
directions.

## Event type and tag

- **Event type:** 27, each with a code (`sstype127` Paper, `evtt104`
  Posters) and a name. Printed on every session and presentation.
- **Tag:** 31, each with a code (`ptrack104` Algorithms), in three groups:
  23 topic tags, 4 recording tags, 4 registration passes.

Topic tags: AI/ML, Algorithms, Applications, Architectures, Art of HPC,
Biomedical, Cloud Computing, Community, Data Analytics, Education and
Workforce Development, Emerging Technologies, Meet and Greet, Networks,
Papers in Conversation, Power and Energy, Profiling and Optimization Tools,
Programming Frameworks, Quantum Computing, State of the Practice, Storage,
Sustainability, System Software, Visualization.

## Earlier SC paper (OpenAlex)

- **Identifier:** an OpenAlex work address (`https://openalex.org/W...`) and
  a DOI.
- **Count:** 2,770 papers, 2010 to 2025. The count per year is uneven (57 to
  490), and 2023 to 2025 include workshop papers.

| Field | Filled in |
|---|---|
| Title, year, DOI, citation count | 2,770 |
| Authors: name as printed on the paper, OpenAlex author identifier | 15,178 author entries, 8,084 distinct author identifiers |
| Author's organization at the time, with country code | 14,606 of the author entries |

OpenAlex and the SC26 program share no identifier. The only way to connect
them is the person's name (see [links.md](links.md)).
