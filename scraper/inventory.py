#!/usr/bin/env python3
"""Count what each downloaded source contains and how its records link together.

Usage:
    python3 -I scraper/inventory.py --raw data/raw --program data/program.json --web app/web/www --out inventory

Reads the cached source files (fetch.py, fetch_openalex.py), the normalized
program (parse.py) and the app bundle (analyze.py) and writes:

    <out>/counts.json     every number quoted in the inventory documents
    <out>/samples/*       one short, real excerpt of each source format

The script only reads local files. It makes no network requests.
Exit codes: 0 success, 1 error.
"""
import argparse
import glob
import json
import os
import re
import sys
from collections import Counter, defaultdict

from bs4 import BeautifulSoup

SVG_RE = re.compile(r"(?s)<svg.*?</svg>")
DAYS = ["2026-11-%02d" % d for d in range(14, 22)]


def read(p):
    with open(p, encoding="utf-8", errors="replace") as f:
        return f.read()


def soup_of(p):
    return BeautifulSoup(SVG_RE.sub("", read(p)), "lxml")


def clean(t):
    return re.sub(r"\s+", " ", t or "").strip()


def q(href, key):
    m = re.search(r"[?&]%s=([^&\"#]+)" % key, href or "")
    return m.group(1) if m else None


def pretty(node, limit=2600):
    """Readable excerpt of an HTML node: one tag per line, long text cut."""
    s = SVG_RE.sub("<svg/>", str(node))
    s = re.sub(r">\s*<", ">\n<", s)
    out = []
    for line in s.split("\n"):
        out.append(line if len(line) <= 220 else line[:200] + " …[cut]")
    s = "\n".join(out)
    return s if len(s) <= limit else s[:limit] + "\n…[excerpt ends]"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--raw", required=True)
    ap.add_argument("--program", required=True)
    ap.add_argument("--web", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    raw = a.raw
    os.makedirs(os.path.join(a.out, "samples"), exist_ok=True)
    C = {}

    def sample(name, text):
        with open(os.path.join(a.out, "samples", name), "w", encoding="utf-8") as f:
            f.write(text.rstrip() + "\n")

    # ------------------------------------------------------------ files
    files = {}
    for p in sorted(glob.glob(os.path.join(raw, "*"))):
        if os.path.isfile(p):
            files[os.path.basename(p)] = os.path.getsize(p)
    for sub in ("sess", "pres", "person", "photo", "poster", "map", "openalex"):
        d = os.path.join(raw, sub)
        fs = [f for f in os.listdir(d)] if os.path.isdir(d) else []
        files[sub + "/"] = {"files": len([f for f in fs if not f.endswith(".404")]),
                            "bytes": sum(os.path.getsize(os.path.join(d, f)) for f in fs)}
    C["files"] = files

    # ------------------------------------------- full program page (filters)
    home = soup_of(os.path.join(raw, "prog_home.html"))
    filt = {}
    for sel in home.select("select"):
        name = sel.get("name") or ""
        opts = [clean(o.get_text()) for o in sel.select("option") if clean(o.get_text())]
        if name:
            filt[name] = opts
    C["full_program_page"] = {
        "filters": {k: (v if len(v) <= 40 else {"count": len(v), "first": v[:5]}) for k, v in filt.items() if k != "tz_selector"},
        "time_zone_choices": len(filt.get("tz_selector", [])),
        "day_snippets": sorted(set(re.findall(r'source="([^"?]+)', read(os.path.join(raw, "prog_home.html"))))),
        "nav_links": sorted({clean(x.get_text()) for x in home.select("nav a") if clean(x.get_text())}),
    }

    # ------------------------------------------------------- daily snippets
    days = {}
    sess_seen = defaultdict(list)
    row_attrs = Counter()
    people_classes = Counter()
    labels = Counter()
    first_row = None
    inner_first = None
    for d in DAYS:
        p = os.path.join(raw, "day_%s.html" % d)
        s = soup_of(p)
        rows = s.select("tr.agenda-item")
        top = [r for r in rows if "presentation-row" in r.get("class", [])]
        inner = [r for r in rows if "presentation-row" not in r.get("class", [])]
        for r in top:
            sess_seen[r["psid"]].append(d)
            for k in r.attrs:
                row_attrs[k] += 1
        for pl in s.select(".ll-people-list"):
            people_classes[" ".join(c for c in pl.get("class", []) if c not in ("ll-inline", "ll-people-list"))] += 1
        for lab in s.select(".info-label"):
            labels[clean(lab.get_text())] += 1
        days[d] = {"bytes": os.path.getsize(p), "session_rows": len(top), "presentation_rows": len(inner),
                   "ical_links": len(s.select("a.ical-link")), "generated": (s.find("table") or {}).get("generated")}
        if first_row is None and top:
            first_row = next((r for r in top if r.select_one(".session-chair")), top[0])
        if inner_first is None and inner:
            inner_first = inner[0]
    nested = set()
    for d in DAYS:
        for m_ in re.finditer(r'<tr class="agenda-item" e_utc="[^"]*" psid="([^"]+)" s_utc="[^"]*" ssid="([^"]+)"', read(os.path.join(raw, "day_%s.html" % d))):
            nested.add(m_.groups())
    C["daily_snippets"] = {
        "distinct_nested_presentations": len(nested),
        "sessions_with_nested_presentations": len({a_ for a_, _ in nested}),
        "per_file": days,
        "unique_sessions": len(sess_seen),
        "files_each_session_appears_in": dict(Counter(len(v) for v in sess_seen.values())),
        "session_row_attributes": sorted(row_attrs),
        "people_list_kinds": dict(people_classes),
        "labels": dict(labels),
    }
    sample("daily_schedule_session_row.html", pretty(first_row))
    sample("daily_schedule_presentation_row.html", pretty(inner_first))

    # ---------------------------------------------------------- search page
    sp = soup_of(os.path.join(raw, "page_search-program.html"))
    sects = {}
    for sec in sp.select(".search-sect"):
        h = sec.find("h2")
        sects[clean(h.get_text()) if h else "?"] = len(sec.select(".searchable_contents"))
    pres = sp.select(".agenda-item.presentation-title")
    jobs = [x for x in pres if (x.get("ssid") or "").startswith("job")]
    real = [x for x in pres if not (x.get("ssid") or "").startswith("job")]
    C["search_page"] = {
        "sections": sects,
        "presentations": len(real), "job_postings_listed_as_presentations": len(jobs),
        "with_abstract": sum(1 for x in real if x.select_one(".abstract")),
        "with_people": sum(1 for x in real if x.select_one(".ll-person")),
        "with_topic_tag": sum(1 for x in real if x.select_one(".tag_group103")),
        "with_room": sum(1 for x in real if x.select_one(".location a")),
        "with_time": sum(1 for x in real if x.select_one(".start-time")),
        "person_mentions": sum(len(x.select(".ll-person")) for x in real),
        "person_mentions_presenting": sum(len(x.select(".ll-person.presenting")) for x in real),
        "person_mentions_with_institution": sum(1 for x in real for p in x.select(".ll-person") if p.select_one(".presenter-institution a")),
        "sessions_listed": len(sp.select(".agenda-item.session-title")),
    }
    ex = next(x for x in real if x.select_one(".abstract") and 2 <= len(x.select(".ll-person")) <= 3)
    sample("search_page_presentation.html", pretty(ex, 4200))

    # ---------------------------------------------------- contributors page
    cp = soup_of(os.path.join(raw, "page_contributors.html"))
    ents = cp.select(".ll-person.presenter-entry")
    uids = [q(e.select_one(".presenter-name a").get("href"), "uid") for e in ents]
    C["contributors_page"] = {
        "people": len(ents),
        "with_country": sum(1 for e in ents if e.select_one(".person-country")),
        "with_institution": sum(1 for e in ents if e.select_one(".presenter-institution a")),
        "institution_links": sum(len(e.select(".presenter-institution a")) for e in ents),
        "presentation_links": sum(len(e.select(".presentation-list .presentation a")) for e in ents),
        "distinct_countries_as_written": len({clean(e.select_one(".person-country").get_text()) for e in ents if e.select_one(".person-country")}),
        "ids_six_digits": sum(1 for u in uids if u and len(u) <= 8),
        "ids_long": sum(1 for u in uids if u and len(u) > 8),
        "event_type_labels": dict(Counter(clean(x.get_text()) for x in cp.select(".presentation-event-type")).most_common()),
    }
    sample("contributors_page_person.html", pretty(ents[1]))

    # --------------------------------------------------- organizations page
    op = soup_of(os.path.join(raw, "page_organizations.html"))
    insts = [i for i in op.select("div.institution") if i.select_one("button.organization-favorite-button")]
    heads = Counter()
    for i in insts:
        for h in i.select(".presenter-header"):
            heads[clean(h.get_text())] += 1
    C["organizations_page"] = {
        "organizations": len(insts),
        "exhibitors": sum(1 for i in insts if i.select_one(".institution-exhibitor")),
        "exhibitors_with_booth_link": sum(1 for i in insts if i.select_one(".institution-exhibitor a[href*='location=']")),
        "exhibitors_with_website": sum(1 for i in insts if i.select_one(".exhibitor-link a")),
        "with_presentations": sum(1 for i in insts if i.select_one(".institution-presentations .agenda-item")),
        "with_sessions": sum(1 for i in insts if i.select_one(".institution-sessions .agenda-item")),
        "with_people": sum(1 for i in insts if i.select_one(".ll-person")),
        "people_group_headers": dict(heads.most_common()),
        "agenda_item_listings": len(op.select(".agenda-item")),
    }
    exo = next(i for i in insts if i.select_one(".ll-person") and not i.select_one(".institution-exhibitor") and len(str(i)) < 9000)
    sample("organizations_page_org.html", pretty(exo, 3600))

    # --------------------------------------------------------- posters page
    pp = soup_of(os.path.join(raw, "page_posters.html"))
    blocks = pp.select(".presentation-display")
    pl = Counter(clean(x.get_text()) for b in blocks for x in b.select(".info-label"))
    C["posters_page"] = {
        "posters": len(blocks),
        "with_preview_image": sum(1 for b in blocks if b.select_one("img.representative-img")),
        "with_video_id": sum(1 for b in blocks if b.select_one("#vimeo_url")),
        "with_abstract": sum(1 for b in blocks if b.select_one(".abstract")),
        "author_mentions": sum(len(b.select(".ll-person")) for b in blocks),
        "author_mentions_with_photo": sum(len(b.select("img.presenter-pic")) for b in blocks),
        "distinct_people_with_photo": len({i.get("src") for b in blocks for i in b.select("img.presenter-pic")}),
        "similar_presentation_links": sum(len(b.select(".recommended-presentation a")) for b in blocks),
        "labels": dict(pl.most_common()),
        "id_prefixes": dict(Counter(re.sub(r"\d+$", "", b.get("presentation") or "") for b in blocks).most_common()),
        "sessions": dict(Counter(b.get("session") for b in blocks).most_common()),
    }
    sample("posters_page_poster.html", pretty(blocks[0], 3600))

    # ------------------------------------------------------------- map data
    md = json.load(open(os.path.join(raw, "mapdata.json")))
    locs = md["locations"]
    C["map_data"] = {
        "top_level_keys": sorted(md.keys()),
        "layers": [{"id": layer["id"], "name": layer["name"], "plan_bytes": os.path.getsize(os.path.join(raw, "map", layer["id"] + ".svg"))} for layer in md["layers"]],
        "locations": len(locs),
        "locations_rooms": sum(1 for x in locs if x["id"].startswith("r")),
        "locations_booths": sum(1 for x in locs if x["id"].startswith("b")),
        "location_fields": dict(Counter(k for x in locs for k in x)),
        "locations_per_layer": dict(Counter(x["layer"] for x in locs)),
        "routes": len(md["routes"]),
        "routes_per_layer": dict(Counter(r["layer"] for r in md["routes"])),
        "settings_keys": sorted(md["settings"].keys()),
    }
    excerpt = json.dumps({"layers": md["layers"][:1], "locations": [x for x in locs if x["id"] in ("rW175abc",)] + locs[200:201],
                          "routes": md["routes"][:1]}, indent=1)[:2600]
    sample("map_data_excerpt.json", re.sub(r"token=[0-9a-f-]+", "token=[left out]", excerpt))

    # -------------------------------------------------------- detail pages
    sd = os.path.join(raw, "sess")
    sfiles = sorted(f for f in os.listdir(sd) if f.endswith(".html"))
    st = Counter()
    lab = Counter()
    for f in sfiles:
        s = soup_of(os.path.join(sd, f)).select_one(".session-display")
        if not s:
            st["no_session_block"] += 1
            continue
        st["pages"] += 1
        st["with_description"] += 1 if s.select_one(".session-description") else 0
        st["with_chair"] += 1 if s.select_one(".session-chair") else 0
        st["chairs_with_institution"] += len(s.select(".session-chair .presenter-institution a"))
        st["with_presentations_table"] += 1 if s.select_one(".session-contents tr.agenda-item") else 0
        st["presentation_rows"] += len(s.select(".session-contents tr.agenda-item"))
        st["similar_session_links"] += len(s.select(".recommended-session a"))
        st["feedback_links"] += len(s.select(".eval-link a"))
        for x in s.select(".info-label"):
            lab[clean(x.get_text())] += 1
    C["session_pages"] = dict(st, labels=dict(lab.most_common()))
    ex_s = soup_of(os.path.join(sd, "sess201.html")).select_one(".session-display")
    for x in ex_s.select(".session-contents tr.agenda-item")[2:]:
        x.extract()
    sample("session_page.html", pretty(ex_s, 5200))

    one = {}
    pr = soup_of(os.path.join(raw, "sample_pres.html")).select_one(".presentation-display")
    one["presentation_page_labels"] = [clean(x.get_text()) for x in pr.select(".info-label")]
    one["presentation_page_has_paper_link"] = bool(pr.select_one(".digital-library-link a"))
    one["presentation_page_paper_link_host"] = re.sub(r"^https?://([^/]+)/.*", r"\1", pr.select_one(".digital-library-link a")["href"])
    one["presentation_page_author_photos"] = len(pr.select("img.presenter-pic"))
    one["presentation_page_similar_links"] = len(pr.select(".recommended-presentation a"))
    pe = soup_of(os.path.join(raw, "sample_person.html")).select_one(".presenter-display")
    one["person_page_has_bio"] = bool(pe.select_one(".presenter-biography"))
    one["person_page_has_photo"] = bool(pe.select_one(".presenter-photo img"))
    one["person_page_listed_items"] = len(pe.select(".agenda-item"))
    one["person_page_labels"] = sorted({clean(x.get_text()) for x in pe.select(".info-label, .biography-header")})
    C["single_pages_seen_once"] = one
    for x in pe.select(".agenda-item")[1:]:
        x.extract()
    sample("person_page.html", pretty(pe, 3600))
    for x in pr.select(".ll-person")[2:]:
        x.extract()
    sample("presentation_page.html", pretty(pr, 5200))

    # ------------------------------------------------------------- OpenAlex
    works = []
    for fn in sorted(glob.glob(os.path.join(raw, "openalex", "page_*.json"))):
        works += json.load(open(fn))["results"]
    C["openalex"] = {
        "works": len(works),
        "by_year": dict(sorted(Counter(w["publication_year"] for w in works).items())),
        "authorships": sum(len(w["authorships"]) for w in works),
        "distinct_author_ids": len({au["author"]["id"] for w in works for au in w["authorships"]}),
        "authorships_with_institution": sum(1 for w in works for au in w["authorships"] if au.get("institutions")),
        "works_with_doi": sum(1 for w in works if w.get("doi")),
        "fields_requested": ["id", "display_name", "publication_year", "cited_by_count", "doi", "authorships"],
    }
    w0 = dict(works[0])
    w0["authorships"] = w0["authorships"][:1]
    sample("openalex_work.json", json.dumps(w0, indent=1)[:2600])

    # ------------------------------------------- normalized program (links)
    P = json.load(open(a.program, encoding="utf-8"))
    S, R = P["sessions"], P["presentations"]
    types, tags = P["types"], P["tags"]
    by_group = Counter(t["group"] for t in tags.values())
    role = Counter(x["role"] for r in R for x in r["people"])
    pres_people = sum(len(r["people"]) for r in R)
    pid_sess = defaultdict(set)
    for r in R:
        pid_sess[r["id"]].add(r["sess"])
    C["normalized_program"] = {
        "sessions": len(S), "presentations": len(R), "people": len(P["people"]), "organization_ids": len(P["orgs"]),
        "rooms": len(P["rooms"]),
        "event_type_codes": types,
        "tag_codes_by_group": dict(by_group),
        "topic_tags": [t["name"] for t in tags.values() if t["group"] == "topic"],
        "recording_tags": [t["name"] for t in tags.values() if t["group"] == "recording"],
        "registration_tags": [t["name"] for t in tags.values() if t["group"] == "registration"],
        "distinct_presentations": len({r["id"] for r in R}),
        "presentation_listings": len(R),
        "presentation_id_prefixes": dict(Counter(re.sub(r"\d+$", "", pid) for pid in {r["id"] for r in R}).most_common()),
        "workshop_series_prefixes": len({re.sub(r"\d+$", "", r["id"]) for r in R if r["id"].startswith("ws_")}),
        "presentations_in_workshop_series": len({r["id"] for r in R if r["id"].startswith("ws_")}),
        "links": {
            "presentation_to_session": len(R),
            "presentations_listed_under_two_sessions": sum(1 for v in pid_sess.values() if len(v) > 1),
            "sessions_flagged_single_presentation": sum(1 for s in S if s.get("single")),
            "sessions_with_presentations": sum(1 for s in S if s["pres"]),
            "presentation_to_person": pres_people,
            "distinct_presentation_person_pairs": len({(r["id"], x["uid"]) for r in R for x in r["people"]}),
            "distinct_people_in_presentations": len({x["uid"] for r in R for x in r["people"]}),
            "distinct_session_chairs": len({x["uid"] for s in S for x in s["people"]}),
            "people_with_two_or_more_organizations": sum(1 for p in P["people"] if len(p["orgs"]) > 1),
            "organization_ids_used_by_people": len({o for p in P["people"] for o in p["orgs"]}),
            "sessions_without_presentations": sum(1 for s in S if not s["pres"]),
            "presentations_with_site_similar_list": len({r["id"] for r in R if r.get("similar")}),
            "presentations_with_extra_links": len({r["id"] for r in R if r.get("links")}),
            "presentation_to_person_presenting": sum(1 for r in R for x in r["people"] if x.get("presenting")),
            "presentation_person_roles": dict(role.most_common()),
            "presentations_with_people": sum(1 for r in R if r["people"]),
            "session_to_chair": sum(len(s["people"]) for s in S),
            "sessions_with_chair": sum(1 for s in S if s["people"]),
            "person_to_organization": sum(len(p["orgs"]) for p in P["people"]),
            "people_with_organization": sum(1 for p in P["people"] if p["orgs"]),
            "people_with_country": sum(1 for p in P["people"] if p.get("country")),
            "people_with_photo_reference": sum(1 for p in P["people"] if p.get("photo")),
            "sessions_with_room": sum(1 for s in S if s.get("room")),
            "presentations_with_room": sum(1 for r in R if r.get("room")),
            "sessions_with_topic_tag": sum(1 for s in S if s["tags"]),
            "presentations_with_topic_tag": sum(1 for r in R if r["tags"]),
            "session_topic_tag_links": sum(len(s["tags"]) for s in S),
            "presentation_topic_tag_links": sum(len(r["tags"]) for r in R),
            "session_event_type_links": sum(len(s["types"]) for s in S),
            "sessions_with_two_or_more_event_types": sum(1 for s in S if len(s["types"]) > 1),
            "sessions_with_description": sum(1 for s in S if s["desc"]),
            "presentations_with_abstract": sum(1 for r in R if r["abstract"]),
            "rooms_found_on_map": sum(1 for r in P["rooms"] if r in P["map"]["locations"]),
        },
        "session_event_types": dict(Counter(types.get(t, t) for s in S for t in s["types"]).most_common()),
    }

    # --------------------------------------------------------- app bundle
    core = json.load(open(os.path.join(a.web, "data", "core.json"), encoding="utf-8"))
    I, H, O = core["items"], core["people"], core["orgs"]
    FL_BREAK, FL_POSTER = 8, 16
    pairs = set()
    for it in I:
        if it.get("fl", 0) & FL_BREAK:
            continue
        ppl = sorted({x[0] for x in it.get("p", [])})
        if 2 <= len(ppl) <= 40:
            for i in range(len(ppl)):
                for j in range(i + 1, len(ppl)):
                    pairs.add((ppl[i], ppl[j]))
    routes_path = os.path.join(a.web, "data", "routes.json")
    C["app_bundle"] = {
        "items": len(I),
        "items_sessions": sum(1 for it in I if it["k"] == "S"),
        "items_talks": sum(1 for it in I if it["k"] == "P"),
        "sessions_merged_with_their_only_presentation": sum(1 for it in I if it.get("pid")),
        "merged_items_led_by_talk_title": sum(1 for it in I if it.get("st")),
        "break_items": sum(1 for it in I if it.get("fl", 0) & FL_BREAK),
        "poster_items": sum(1 for it in I if it.get("fl", 0) & FL_POSTER),
        "talks_also_listed_in_another_session": sum(1 for it in I if it.get("alt")),
        "people": len(H), "people_records_merged": len(P["people"]) - len(H),
        "organizations": len(O), "organization_ids_merged": len(P["orgs"]) - len(O),
        "organizations_by_sector": dict(Counter(o["k"] for o in O)),
        "organizations_without_people": sum(1 for o in O if not o["np"]),
        "countries": len(core["countries"]),
        "formats": [f["n"] for f in core["formats"]], "format_groups": dict(Counter(f["grp"] for f in core["formats"])),
        "themes": len(core["themes"]),
        "items_with_theme": sum(1 for it in I if it.get("th")),
        "theme_links": sum(len(it.get("th", [])) for it in I),
        "items_with_layout_position": sum(1 for it in I if it.get("x")),
        "related_links": sum(len(it.get("sim", [])) for it in I),
        "items_with_key_terms": sum(1 for it in I if it.get("kw")),
        "talks_with_inherited_tags": None,
        "people_with_prior_sc_papers": sum(1 for p in H if p.get("sc")),
        "coauthor_pairs": len(pairs),
        "people_with_bundled_photo": sum(1 for p in H if p.get("ph")),
        "people_with_online_photo_reference": sum(1 for p in H if p.get("px")),
        "posters_with_online_preview_reference": sum(1 for it in I if it.get("ir")),
        "buzzwords": len(core["buzz"]),
        "rooms": len(core["rooms"]), "floor_plans": len(core["layers"]),
        "walkway_routes_file_bytes": os.path.getsize(routes_path) if os.path.exists(routes_path) else 0,
    }
    # tags a talk carries in the app that it did not carry in the source
    src_tagged = {(r["sess"] + "/" + r["id"]) for r in R if r["tags"]}
    C["app_bundle"]["talks_with_inherited_tags"] = sum(1 for it in I if it["k"] == "P" and it.get("g") and it["id"] not in src_tagged)

    with open(os.path.join(a.out, "counts.json"), "w", encoding="utf-8") as f:
        json.dump(C, f, ensure_ascii=False, indent=1)
    print("wrote %s and %d samples" % (os.path.join(a.out, "counts.json"), len(os.listdir(os.path.join(a.out, "samples")))))
    return 0


if __name__ == "__main__":
    sys.exit(main())
