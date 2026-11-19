#!/usr/bin/env python3
"""Turn the cached SC26 program pages into one normalized JSON file.

Usage:
    python3 -I scraper/parse.py --raw data/raw --out data/program.json

Reads the pages downloaded by fetch.py (daily schedule snippets, search page,
contributors, organizations, posters, per-session / per-presentation /
per-person pages, map data) and writes sessions, presentations, people,
organizations, rooms, tags and event types with stable ids.

Detail pages are optional: anything missing is reported in the coverage
summary and the record is built from the bulk pages alone.
Exit codes: 0 success, 1 error.
"""
import argparse
import calendar
import json
import os
import re
import sys
import time
from collections import Counter, OrderedDict

from bs4 import BeautifulSoup

SVG_RE = re.compile(r"(?s)<svg.*?</svg>")
DAYS = ["2026-11-%02d" % d for d in range(14, 22)]
TAG_GROUPS = {"tag_group103": "topic", "tag_group105": "recording", "tag_group106": "registration"}
REG_CODES = {"ptrack139": "TP", "ptrack140": "W", "ptrack141": "T", "ptrack142": "EX"}


def load(path):
    with open(path, encoding="utf-8", errors="replace") as f:
        return SVG_RE.sub("", f.read())


def soup_of(path):
    return BeautifulSoup(load(path), "lxml")


def utc_min(s):
    """'2026-11-17T16:30:00Z' -> minutes since the Unix epoch."""
    if not s:
        return None
    return calendar.timegm(time.strptime(s, "%Y-%m-%dT%H:%M:%SZ")) // 60


def clean(t):
    return re.sub(r"\s+", " ", t or "").strip()


def text_with_breaks(el):
    """Inner text of an element, keeping <br> and paragraph breaks as newlines."""
    if el is None:
        return ""
    for br in el.find_all("br"):
        br.replace_with("\n")
    for p in el.find_all(["p", "li", "div"]):
        p.append("\n")
    t = el.get_text()
    t = re.sub(r"[ \t\r\f\v]+", " ", t)
    t = re.sub(r" ?\n ?", "\n", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


def q(href, key):
    m = re.search(r"[?&]%s=([^&\"#]+)" % key, href or "")
    return m.group(1) if m else None


class Model:
    def __init__(self):
        self.types = OrderedDict()      # code -> name
        self.tags = OrderedDict()       # ptrack code -> {name, group}
        self.rooms = OrderedDict()      # location id -> name
        self.sessions = OrderedDict()   # sess id -> dict
        self.pres = OrderedDict()       # (sess id, pres id) -> dict
        self.people = OrderedDict()     # uid -> dict
        self.orgs = OrderedDict()       # inst id -> dict

    # ---- small registries -------------------------------------------------
    def note_types(self, node):
        codes = []
        for d in node.select(".event-type-name, .etype"):
            for c in d.get("class", []):
                if re.match(r"^(evtt|sstype)\d+$", c):
                    self.types.setdefault(c, clean(d.get_text()))
                    if c not in codes:
                        codes.append(c)
        return codes

    def note_tags(self, node):
        """Return ([topic codes], [recording codes], [registration codes])."""
        out = {"topic": [], "recording": [], "registration": []}
        for grp in node.select(".tag-group-list"):
            kind = None
            for c in grp.get("class", []):
                if c in TAG_GROUPS:
                    kind = TAG_GROUPS[c]
            if not kind:
                continue
            for d in grp.select(".program-track"):
                for c in d.get("class", []):
                    m = re.match(r"^(ptrack\d+)(-snippet)?$", c)
                    if not m:
                        continue
                    code = m.group(1)
                    name = clean(d.get_text())
                    if kind == "registration":
                        sp = d.find("span")
                        name = (sp.get("title") if sp and sp.get("title") else name)
                    self.tags.setdefault(code, {"name": name, "group": kind})
                    if code not in out[kind]:
                        out[kind].append(code)
        return out["topic"], out["recording"], out["registration"]

    def note_room(self, node):
        a = node.select_one(".presentation-location a, .location a, .room a")
        if not a:
            return None
        rid = q(a.get("href"), "location")
        if rid:
            self.rooms.setdefault(rid, clean(a.get_text()))
        return rid

    def person(self, pnode):
        """Register a person from an .ll-person node; returns (uid, [inst ids])."""
        a = pnode.select_one(".presenter-name a")
        if not a:
            return None, []
        uid = q(a.get("href"), "uid")
        if not uid:
            return None, []
        # the day view abbreviates given names inside a hidden span; take all text
        name = clean(a.get_text(" "))
        p = self.people.setdefault(uid, {"id": uid, "name": name, "orgs": [], "country": None,
                                         "bio": "", "photo": None})
        if len(name) > len(p["name"]):
            p["name"] = name
        insts = []
        for ia in pnode.select(".presenter-institution a"):
            iid = q(ia.get("href"), "inst")
            if not iid:
                continue
            self.orgs.setdefault(iid, {"id": iid, "name": clean(ia.get_text())})
            insts.append(iid)
            if iid not in p["orgs"]:
                p["orgs"].append(iid)
        img = pnode.select_one("img.presenter-pic, .presenter-photo img")
        if img and img.get("src"):
            p["photo"] = img["src"].split("/")[-1]
        return uid, insts

    def people_list(self, node, default_role="author"):
        """Parse every people list under node -> [{uid, role, presenting, orgs}]."""
        out, seen = [], set()
        lists = node.select(".ll-people-list")
        if not lists:
            lists = [node]
        for pl in lists:
            role = default_role
            cls = pl.get("class", [])
            for r in ("author", "presenter", "panelist", "moderator", "organizer",
                      "alternate-presenter", "session-chair-list", "chair"):
                if r in cls:
                    role = {"session-chair-list": "chair", "alternate-presenter": "alternate"}.get(r, r)
            lab = pl.find_previous_sibling(class_="info-label") or pl.select_one(".info-label")
            if lab:
                lt = clean(lab.get_text()).lower().rstrip("s")
                if lt and lt not in ("people", "description"):
                    role = lt.replace("session chair", "chair").replace("alternate presenter", "alternate")
            for pn in pl.select(".ll-person"):
                uid, insts = self.person(pn)
                if not uid or (uid, role) in seen:
                    continue
                seen.add((uid, role))
                pc = pn.get("class", [])
                if "session-chair" in pc:
                    r2 = "chair"
                else:
                    r2 = role
                out.append({"uid": uid, "role": r2, "presenting": "presenting" in pc, "orgs": insts})
        return out


# ---------------------------------------------------------------------------
def parse_days(m, raw):
    for d in DAYS:
        path = os.path.join(raw, "day_%s.html" % d)
        if not os.path.exists(path):
            continue
        soup = soup_of(path)
        for r in soup.select("tr.agenda-item.presentation-row"):
            sid = r.get("psid")
            if not sid or sid in m.sessions:
                continue
            tnode = r.select_one(".presentation-title")
            topic, rec, reg = m.note_tags(r)
            for code in (r.get("ptracks") or "").split():
                # codes on the row attribute that have no visible label yet
                if code not in topic + rec + reg and code in m.tags:
                    {"topic": topic, "recording": rec, "registration": reg}[m.tags[code]["group"]].append(code)
            # The speaker cell holds session chairs (class "session-chair"). For a session that
            # is a single presentation it holds that presentation's speakers, who are not chairs;
            # they are picked up with the presentation itself.
            listed = m.people_list(r.select_one(".speaker-td") or r, "presenter")
            chairs = [p for p in listed if p["role"] == "chair"]
            m.sessions[sid] = {
                "id": sid,
                "title": clean(tnode.get_text()) if tnode else "",
                "types": m.note_types(r.select_one(".type-td") or r) or (r.get("etypes") or "").split(),
                "start": utc_min(r.get("s_utc")), "end": utc_min(r.get("e_utc")),
                "room": m.note_room(r),
                "tags": topic, "rec": rec, "reg": reg,
                "ptracks": (r.get("ptracks") or "").split(),
                "single": r.get("ssid") if r.get("ssid") not in (None, "none") else None,
                "people": chairs, "desc": "", "pres": [], "similar": [],
            }
        # expanded contents rows hold the per-talk schedule of some sessions
        for row in soup.select("tr.slots-slidedown"):
            for r in row.select("tr.agenda-item"):
                note_pres_row(m, r)
            sid = next((c for c in row.get("class", []) if c.startswith("sess")), None)
            dn = row.select_one(".session-description")
            if sid in m.sessions and dn and not m.sessions[sid]["desc"]:
                lab = dn.select_one(".info-label")
                if lab:
                    lab.extract()
                m.sessions[sid]["desc"] = text_with_breaks(dn)


def note_pres_row(m, r):
    """A presentation row inside a session's contents table."""
    sid, pid = r.get("psid"), r.get("ssid")
    if not sid or not pid or pid == "none" or pid.startswith("job"):
        return None
    key = (sid, pid)
    a = r.select_one(".title-speakers-td > a, .title-speakers-td a")
    p = m.pres.setdefault(key, new_pres(sid, pid))
    if a and not p["title"]:
        p["title"] = clean(a.get_text())
    p["start"] = p["start"] or utc_min(r.get("s_utc"))
    p["end"] = p["end"] or utc_min(r.get("e_utc"))
    ppl = m.people_list(r.select_one(".title-speakers-td") or r)
    if ppl and not p["people"]:
        p["people"] = ppl
    elif ppl:
        merge_roles(p["people"], ppl)
    return key


def new_pres(sid, pid):
    return {"id": pid, "sess": sid, "title": "", "types": [], "start": None, "end": None, "room": None,
            "tags": [], "rec": [], "reg": [], "people": [], "abstract": "", "dl": None, "links": [],
            "similar": [], "image": None, "video": None, "blitz": []}


def merge_roles(base, extra):
    """Search-page people lists have no roles; copy roles over from a richer list."""
    roles = {}
    for e in extra:
        roles.setdefault(e["uid"], e["role"])
    known = {b["uid"] for b in base}
    for b in base:
        if b["uid"] in roles and b["role"] == "author":
            b["role"] = roles[b["uid"]]
    for e in extra:
        if e["uid"] not in known:
            base.append(e)
            known.add(e["uid"])


def parse_search(m, raw):
    path = os.path.join(raw, "page_search-program.html")
    soup = soup_of(path)
    for it in soup.select(".agenda-item.presentation-title"):
        sid, pid = it.get("psid"), it.get("ssid")
        if not sid or not pid or pid == "none" or pid.startswith("job"):
            continue
        p = m.pres.setdefault((sid, pid), new_pres(sid, pid))
        a = it.select_one(".title-link a")
        p["title"] = clean(a.get_text()) if a else p["title"]
        p["types"] = m.note_types(it.select_one(".etypes-list") or it)
        st, en = it.select_one(".start-time"), it.select_one(".end-time")
        p["start"] = utc_min(st.get("utc_time")) if st else p["start"]
        p["end"] = utc_min(en.get("utc_time")) if en else p["end"]
        p["room"] = m.note_room(it) or p["room"]
        p["tags"], p["rec"], p["reg"] = m.note_tags(it)
        ab = it.select_one(".abstract")
        if ab:
            p["abstract"] = text_with_breaks(ab)
        pl = it.select_one(".presentation-title-people")
        if pl:
            ppl = m.people_list(pl)
            if p["people"]:
                merge_roles(ppl, p["people"])
            p["people"] = ppl
    for it in soup.select(".agenda-item.session-title"):
        sid = it.get("psid")
        if sid in m.sessions:
            s = m.sessions[sid]
            topic, rec, reg = m.note_tags(it)
            s["tags"] = s["tags"] or topic
            if not s["types"]:
                s["types"] = m.note_types(it)
            s["room"] = s["room"] or m.note_room(it)


def parse_session_pages(m, raw):
    d = os.path.join(raw, "sess")
    n = 0
    for sid, s in m.sessions.items():
        path = os.path.join(d, sid + ".html")
        if not os.path.exists(path):
            continue
        soup = soup_of(path)
        root = soup.select_one(".session-display")
        if not root:
            continue
        n += 1
        s["page"] = True
        tn = root.select_one(".session-title")
        if tn:
            for x in tn.select(".event-types-small"):
                x.extract()
            t = clean(tn.get_text())
            if t:
                s["title"] = t
        dn = root.select_one(".session-description")
        if dn:
            lab = dn.select_one(".info-label")
            if lab:
                lab.extract()
            s["desc"] = text_with_breaks(dn)
        ch = root.select_one(".session-chairs-list-sect")
        if ch:
            ppl = m.people_list(ch, "chair")
            if ppl:
                s["people"] = ppl
        topic, rec, reg = m.note_tags(root.select_one(".right-col") or root)
        s["tags"] = topic or s["tags"]
        s["rec"] = rec or s["rec"]
        s["reg"] = reg or s["reg"]
        s["room"] = s["room"] or m.note_room(root)
        types = m.note_types(root.select_one(".event-type-sect") or root)
        if types and not s["types"]:
            s["types"] = types
        s["similar"] = [q(a.get("href"), "sess") for a in root.select(".recommended-session a")]
        for r in root.select(".session-contents tr.agenda-item"):
            note_pres_row(m, r)
    return n


def parse_pres_pages(m, raw):
    d = os.path.join(raw, "pres")
    n = 0
    if not os.path.isdir(d):
        return 0
    for (sid, pid), p in m.pres.items():
        path = os.path.join(d, "%s--%s.html" % (sid, pid))
        if not os.path.exists(path):
            continue
        soup = soup_of(path)
        root = soup.select_one(".presentation-display")
        if not root:
            continue
        n += 1
        fill_pres_detail(m, p, root)
    return n


def fill_pres_detail(m, p, root):
    p["page"] = True
    tn = root.select_one(".presentation-title")
    if tn and not p["title"]:
        p["title"] = clean(tn.get_text())
    ab = root.select_one(".abstract-sect .abstract")
    if ab:
        t = text_with_breaks(ab)
        if len(t) >= len(p["abstract"]):
            p["abstract"] = t
    sect = root.select_one(".presenter-details-sect")
    if sect:
        ppl = m.people_list(sect)
        if ppl:
            if p["people"]:
                merge_roles(ppl, p["people"])
            p["people"] = ppl
    a = root.select_one(".digital-library-link a")
    if a and a.get("href"):
        p["dl"] = a["href"]
    for sec in root.select(".info-section"):
        lab = sec.find(class_="info-label", recursive=False)
        lt = clean(lab.get_text()) if lab else ""
        if lt == "Links":
            for la in sec.select("a"):
                if la.get("href", "").startswith("http"):
                    p["links"].append({"label": clean(la.get_text()) or "Link", "url": la["href"]})
        elif lt == "Poster Blitz Groups":
            p["blitz"] = [clean(x.get_text()) for x in sec.select(".program-track, .poster-blitz-group") if clean(x.get_text())]
    p["similar"] = []
    for ra in root.select(".recommended-presentation a"):
        pid, sid = q(ra.get("href"), "id"), q(ra.get("href"), "sess")
        if pid and sid and not pid.startswith("job"):
            p["similar"].append([sid, pid])
    img = root.select_one("img.representative-img")
    if img and img.get("src"):
        p["image"] = img["src"].split("/")[-1]
    v = root.select_one("#vimeo_url")
    if v and v.get("url"):
        p["video"] = v["url"]
    if not p["start"]:
        p["start"], p["end"] = utc_min(root.get("s_utc")), utc_min(root.get("e_utc"))
    if not p["room"]:
        p["room"] = m.note_room(root)
    if not p["types"]:
        p["types"] = m.note_types(root.select_one(".event-type-sect") or root)
    if not p["tags"]:
        p["tags"], rec, reg = m.note_tags(root.select_one(".right-col") or root)
        p["rec"] = p["rec"] or rec
        p["reg"] = p["reg"] or reg


def parse_posters(m, raw):
    path = os.path.join(raw, "page_posters.html")
    if not os.path.exists(path):
        return 0
    soup = soup_of(path)
    n = 0
    for root in soup.select(".presentation-display"):
        sid, pid = root.get("session"), root.get("presentation")
        if not sid or not pid:
            continue
        p = m.pres.setdefault((sid, pid), new_pres(sid, pid))
        had_page = p.get("page")
        fill_pres_detail(m, p, root)
        if not had_page:
            p.pop("page", None)
        p["poster"] = True
        n += 1
    return n


def parse_contributors(m, raw):
    soup = soup_of(os.path.join(raw, "page_contributors.html"))
    n = 0
    for pn in soup.select(".ll-person.presenter-entry"):
        uid, _ = m.person(pn)
        if not uid:
            continue
        n += 1
        c = pn.select_one(".person-country")
        if c:
            m.people[uid]["country"] = clean(c.get_text())
        # the index name is the canonical "First Last" form
        a = pn.select_one(".presenter-name a")
        m.people[uid]["name"] = clean(a.get_text(" "))
        m.people[uid]["indexed"] = True
    return n


def parse_person_pages(m, raw):
    d = os.path.join(raw, "person")
    n = 0
    if not os.path.isdir(d):
        return 0
    for uid, p in m.people.items():
        path = os.path.join(d, uid + ".html")
        if not os.path.exists(path):
            continue
        soup = soup_of(path)
        root = soup.select_one(".presenter-display")
        if not root:
            continue
        n += 1
        p["page"] = True
        nn = root.select_one(".presenter-desc .presenter-name")
        if nn and clean(nn.get_text()):
            p["name"] = clean(nn.get_text())
        orgs = []
        for ia in root.select(".presenter-desc .presenter-institution a"):
            iid = q(ia.get("href"), "inst")
            if iid:
                m.orgs.setdefault(iid, {"id": iid, "name": clean(ia.get_text())})
                orgs.append(iid)
        if orgs:
            # keep the profile's own affiliation order first
            p["orgs"] = orgs + [o for o in p["orgs"] if o not in orgs]
        b = root.select_one(".presenter-biography")
        if b:
            p["bio"] = text_with_breaks(b)
        img = root.select_one(".presenter-photo img")
        if img and img.get("src"):
            p["photo"] = img["src"].split("/")[-1]
    return n


def parse_orgs(m, raw):
    soup = soup_of(os.path.join(raw, "page_organizations.html"))
    n = 0
    for inst in soup.select("div.institution"):
        btn = inst.select_one("button.organization-favorite-button")
        if not btn:
            continue
        iid = (btn.get("data-organization-id") or "").replace("org", "")
        name = btn.get("data-organization-name") or ""
        if not iid:
            continue
        n += 1
        o = m.orgs.setdefault(iid, {"id": iid, "name": name})
        o["name"] = clean(name) or o["name"]
        ex = inst.select_one(".institution-exhibitor")
        if ex:
            o["exhibitor"] = True
            ba = ex.select_one(".booth-header")
            if ba:
                a = ba.find_next("a")
                if a:
                    o["booth"] = clean(a.get_text())
            w = ex.select_one(".exhibitor-link a")
            if w and w.get("href"):
                o["url"] = w["href"]
        # people affiliated with this organization (keeps uid -> org links complete)
        for pn in inst.select(".ll-person"):
            a = pn.select_one(".presenter-name a")
            uid = q(a.get("href"), "uid") if a else None
            if uid:
                p = m.people.setdefault(uid, {"id": uid, "name": clean(a.get_text(" ")), "orgs": [],
                                              "country": None, "bio": "", "photo": None})
                if iid not in p["orgs"]:
                    p["orgs"].append(iid)
    return n


def parse_map(m, raw):
    path = os.path.join(raw, "mapdata.json")
    if not os.path.exists(path):
        return {}
    d = json.load(open(path))
    locs = {}
    for loc in d["locations"]:
        if loc["id"].startswith("r"):
            locs[loc["id"]] = {"title": loc["title"], "layer": loc["layer"],
                               "x": loc["coord"][0], "y": loc["coord"][1], "zoom": loc.get("zoom")}
    layers = [{"id": layer["id"], "name": layer["name"]} for layer in d["layers"]]
    return {"layers": layers, "locations": locs}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--raw", required=True, help="cache directory written by fetch.py")
    ap.add_argument("--out", required=True, help="output JSON path")
    a = ap.parse_args()

    m = Model()
    parse_days(m, a.raw)
    parse_search(m, a.raw)
    n_sess_pages = parse_session_pages(m, a.raw)
    n_pres_pages = parse_pres_pages(m, a.raw)
    n_posters = parse_posters(m, a.raw)
    n_contrib = parse_contributors(m, a.raw)
    n_orgs = parse_orgs(m, a.raw)
    n_person_pages = parse_person_pages(m, a.raw)
    mapinfo = parse_map(m, a.raw)

    # A presentation can be listed under two sessions (a poster in the display session and in
    # the reception, a doctoral showcase talk and its poster). Detail found on one listing
    # (abstract, preview image, video, links, people) belongs to the other listing as well.
    by_pid = {}
    for (sid, pid), p in m.pres.items():
        by_pid.setdefault(pid, []).append(p)
    shared = 0
    for group in by_pid.values():
        if len(group) < 2:
            continue
        for k in ("abstract", "image", "video", "links", "similar", "blitz", "people", "tags", "dl", "poster"):
            best = max((g.get(k) for g in group), key=lambda v: len(v) if hasattr(v, "__len__") else int(bool(v)))
            if not best:
                continue
            for g in group:
                if not g.get(k):
                    g[k] = best if not isinstance(best, list) else list(best)
                    shared += 1

    # link presentations to sessions, inherit missing fields from the session
    orphans = 0
    for (sid, pid), p in m.pres.items():
        s = m.sessions.get(sid)
        if not s:
            orphans += 1
            continue
        s["pres"].append(pid)
        for k in ("room", "start", "end"):
            if p[k] is None:
                p[k] = s[k]
        if not p["types"]:
            p["types"] = list(s["types"])
    for s in m.sessions.values():
        s["pres"].sort(key=lambda pid: (m.pres[(s["id"], pid)]["start"] or 0,
                                        m.pres[(s["id"], pid)]["end"] or 0, pid))

    # "generated" is when the program pages were downloaded, which is the date the data stands for.
    # Re-running this script later must not make the snapshot look newer than it is.
    bulk = [os.path.join(a.raw, "day_%s.html" % d) for d in DAYS] + [os.path.join(a.raw, "page_search-program.html")]
    fetched = max(os.path.getmtime(p) for p in bulk if os.path.exists(p))
    out = {
        "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(fetched)),
        "source": "https://sc26.conference-program.com/",
        "types": m.types,
        "tags": m.tags,
        "rooms": m.rooms,
        "map": mapinfo,
        "sessions": list(m.sessions.values()),
        "presentations": list(m.pres.values()),
        "people": list(m.people.values()),
        "orgs": list(m.orgs.values()),
    }
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)

    # ---- coverage summary -------------------------------------------------
    S, P, H = out["sessions"], out["presentations"], out["people"]
    print("sessions            %5d   (detail pages %d, with description %d)" % (
        len(S), n_sess_pages, sum(1 for s in S if s["desc"])))
    print("presentations       %5d   (detail pages %d, posters %d, with abstract %d, orphans %d)" % (
        len(P), n_pres_pages, n_posters, sum(1 for p in P if p["abstract"]), orphans))
    print("  with people       %5d   with DL link %d" % (sum(1 for p in P if p["people"]), sum(1 for p in P if p["dl"])))
    print("people              %5d   (index %d, profile pages %d, bios %d, photos %d, country %d)" % (
        len(H), n_contrib, n_person_pages, sum(1 for p in H if p["bio"]), sum(1 for p in H if p["photo"]),
        sum(1 for p in H if p["country"])))
    print("organizations       %5d   (index %d, exhibitors %d)" % (
        len(out["orgs"]), n_orgs, sum(1 for o in out["orgs"] if o.get("exhibitor"))))
    print("rooms               %5d   (on map %d)" % (
        len(m.rooms), sum(1 for r in m.rooms if r in mapinfo.get("locations", {}))))
    print("event types         %5d   topic tags %d" % (
        len(m.types), sum(1 for t in m.tags.values() if t["group"] == "topic")))
    tc = Counter()
    for s in S:
        for t in s["types"]:
            tc[m.types.get(t, t)] += 1
    print("session types:", dict(tc.most_common()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
