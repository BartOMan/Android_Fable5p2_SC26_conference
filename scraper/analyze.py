#!/usr/bin/env python3
"""Build the data bundle the SC26 Atlas app ships with.

Usage:
    python3 -I scraper/analyze.py --program data/program.json --raw data/raw --web app/web/www [--theme-report]

Input: the normalized program written by parse.py, cached photos and floor
plans from fetch.py, and past SC papers from fetch_openalex.py.

Output (under <web>/data and <web>/img):
    data/core.json   items, people, organizations, rooms, themes, layout
    data/text.json   abstracts, descriptions and biographies
    img/p/<uid>.webp contributor photos, 160 px
    img/poster/*.webp poster thumbnails
    map/*.svg        floor plans

Analysis steps: merge organization aliases, classify formats, score curated
themes, TF-IDF similarity ("related talks"), a 2-D t-SNE layout of all talks
(the "galaxy"), contributor activity scores, and prior SC publication counts.
Exit codes: 0 success, 1 error.
"""
import argparse
import glob
import json
import math
import os
import re
import shutil
import sys
import unicodedata
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from themes import THEMES, THRESHOLD  # noqa: E402

TZ_OFFSET_MIN = -360  # conference time is US Central Standard Time (UTC-6)
DAYS = ["2026-11-%02d" % d for d in range(14, 22)]

# (format id, label, group, [source type names], color)
FORMATS = [
    ("keynote", "Keynote", "tech", ["Keynote"], "#F59E0B"),
    ("plenary", "Plenary", "tech", ["HPC Unites Plenary"], "#FB923C"),
    ("invited", "Invited Talk", "tech", ["Invited Talk"], "#F472B6"),
    ("gb", "Gordon Bell Finalist", "tech", ["ACM Gordon Bell Finalist", "ACM Gordon Bell Climate Modeling Finalist"], "#FACC15"),
    ("award", "Awards", "tech", ["Awards and Award Talks"], "#EAB308"),
    ("paper", "Paper", "tech", ["Paper"], "#38BDF8"),
    ("panel", "Panel", "tech", ["Panel"], "#A78BFA"),
    ("bof", "Birds of a Feather", "tech", ["Birds of a Feather"], "#34D399"),
    ("tutorial", "Tutorial", "tech", ["Tutorial"], "#2DD4BF"),
    ("workshop", "Workshop", "tech", ["Workshop"], "#818CF8"),
    ("poster", "Poster", "tech", ["Posters"], "#FB7185"),
    ("art", "Art of HPC", "tech", ["Art of HPC"], "#E879F9"),
    ("nre", "SCinet Research Exhibition", "tech", ["SCinet Network Research Exhibition"], "#22D3EE"),
    ("exforum", "Exhibitor Forum", "vendor", ["Exhibitor Forum"], "#94A3B8"),
    ("rth", "Regional Tech Hub", "community", ["Regional Tech Hub"], "#4ADE80"),
    ("early", "Early Career", "community", ["Early Career"], "#A3E635"),
    ("students", "Students@SC", "community", ["Students@SC"], "#BEF264"),
    ("scc", "Student Cluster Competition", "community", ["Student Cluster Competition", "SCC Connect"], "#FDBA74"),
    ("community", "Community", "community", ["Community Engagement"], "#7DD3FC"),
    ("reception", "Reception", "community", ["Reception"], "#FDA4AF"),
    ("exhibits", "Exhibits", "vendor", ["Exhibits"], "#CBD5E1"),
    ("career", "Career Fair", "community", ["Career Fair"], "#D9F99D"),
    ("other", "Other", "community", ["SC27"], "#94A3B8"),
]
FLAG_BEST_PAPER, FLAG_BEST_STUDENT, FLAG_GB, FLAG_BREAK, FLAG_POSTER, FLAG_LIVE, FLAG_REC, FLAG_TEXT = 1, 2, 4, 8, 16, 32, 64, 128

ROLE_ORDER = ["author", "presenter", "chair", "panelist", "moderator", "organizer", "alternate"]
# weight of one appearance in the contributor activity score
ROLE_WEIGHT = {"author": 1.0, "presenter": 1.6, "chair": 1.2, "panelist": 1.8, "moderator": 1.8,
               "organizer": 1.4, "alternate": 0.5}
FORMAT_WEIGHT = {"keynote": 6, "plenary": 5, "invited": 4, "gb": 3, "award": 3, "paper": 2, "panel": 1.6,
                 "tutorial": 1.6, "bof": 1.2, "workshop": 1.0, "poster": 0.8, "art": 0.8, "nre": 0.8,
                 "exforum": 0.6}

# name in the program -> (display name, ISO 3166 numeric, latitude, longitude)
COUNTRIES = {
    "United States of America": ("United States", "840", 39.8, -98.6), "USA": ("United States", "840", 39.8, -98.6),
    "Virgin Islands (USA)": ("United States", "840", 39.8, -98.6),
    "China": ("China", "156", 35.0, 103.8), "Germany": ("Germany", "276", 51.2, 10.4), "Japan": ("Japan", "392", 36.2, 138.3),
    "United Kingdom": ("United Kingdom", "826", 54.0, -2.0), "France": ("France", "250", 46.6, 2.3),
    "Switzerland": ("Switzerland", "756", 46.8, 8.2), "Italy": ("Italy", "380", 42.8, 12.6), "Spain": ("Spain", "724", 40.2, -3.6),
    "Canada": ("Canada", "124", 56.1, -106.3), "India": ("India", "356", 21.0, 78.9), "South Korea": ("South Korea", "410", 36.4, 127.9),
    "Brazil": ("Brazil", "076", -10.8, -52.9), "Brasil": ("Brazil", "076", -10.8, -52.9), "Norway": ("Norway", "578", 61.0, 8.5), "Sweden": ("Sweden", "752", 62.0, 15.0),
    "Hong Kong": ("Hong Kong", "344", 22.3, 114.2), "Singapore": ("Singapore", "702", 1.35, 103.8),
    "Czech Republic": ("Czechia", "203", 49.8, 15.5), "Czechia": ("Czechia", "203", 49.8, 15.5), "Taiwan": ("Taiwan", "158", 23.7, 121.0),
    "Vietnam": ("Vietnam", "704", 16.0, 107.8), "Australia": ("Australia", "036", -25.3, 133.8),
    "Saudi Arabia": ("Saudi Arabia", "682", 24.0, 45.0), "Finland": ("Finland", "246", 64.0, 26.0), "Israel": ("Israel", "376", 31.4, 35.0),
    "Netherlands": ("Netherlands", "528", 52.2, 5.3), "Belgium": ("Belgium", "056", 50.6, 4.6), "Poland": ("Poland", "616", 52.1, 19.4),
    "South Africa": ("South Africa", "710", -29.0, 24.0), "Portugal": ("Portugal", "620", 39.6, -8.0), "Turkey": ("Türkiye", "792", 39.0, 35.2),
    "Colombia": ("Colombia", "170", 4.1, -72.9), "Ireland": ("Ireland", "372", 53.2, -8.1), "Costa Rica": ("Costa Rica", "188", 9.9, -84.2),
    "Hungary": ("Hungary", "348", 47.2, 19.4), "Austria": ("Austria", "040", 47.6, 14.1), "New Zealand": ("New Zealand", "554", -41.8, 172.8),
    "Macau": ("Macau", "446", 22.2, 113.55), "Uruguay": ("Uruguay", "858", -32.8, -56.0), "Luxembourg": ("Luxembourg", "442", 49.8, 6.1),
    "Swaziland": ("Eswatini", "748", -26.5, 31.5), "Bangladesh": ("Bangladesh", "050", 23.7, 90.3), "Kenya": ("Kenya", "404", 0.2, 37.9),
    "Denmark": ("Denmark", "208", 56.0, 9.5), "Greece": ("Greece", "300", 39.1, 22.0), "Mexico": ("Mexico", "484", 23.6, -102.5),
    "Argentina": ("Argentina", "032", -35.4, -65.2), "Chile": ("Chile", "152", -33.5, -70.7), "Russia": ("Russia", "643", 61.5, 99.0),
    "United Arab Emirates": ("United Arab Emirates", "784", 24.0, 54.0), "Qatar": ("Qatar", "634", 25.3, 51.2),
    "Thailand": ("Thailand", "764", 15.1, 101.0), "Malaysia": ("Malaysia", "458", 4.2, 102.0), "Indonesia": ("Indonesia", "360", -2.2, 117.3),
    "Pakistan": ("Pakistan", "586", 30.0, 69.4), "Egypt": ("Egypt", "818", 26.5, 29.9), "Nigeria": ("Nigeria", "566", 9.6, 8.1),
    "Estonia": ("Estonia", "233", 58.7, 25.5), "Slovenia": ("Slovenia", "705", 46.1, 14.8), "Croatia": ("Croatia", "191", 45.1, 15.2),
    "Romania": ("Romania", "642", 45.9, 25.0), "Bulgaria": ("Bulgaria", "100", 42.8, 25.2), "Serbia": ("Serbia", "688", 44.2, 20.8),
    "Slovakia": ("Slovakia", "703", 48.7, 19.5), "Iceland": ("Iceland", "352", 65.0, -18.6), "Cyprus": ("Cyprus", "196", 35.0, 33.2),
    "Iran": ("Iran", "364", 32.6, 54.3), "Philippines": ("Philippines", "608", 12.9, 122.9), "Peru": ("Peru", "604", -9.2, -75.0),
    "Ecuador": ("Ecuador", "218", -1.4, -78.4), "Morocco": ("Morocco", "504", 31.8, -6.3), "Ghana": ("Ghana", "288", 7.9, -1.2),
}

ORG_ALIASES = {  # normalized key -> canonical normalized key
    "nvidia": "nvidia corporation", "hewlett packard enterprise": "hpe", "amd": "advanced micro devices",
    "intel": "intel corporation", "intel labs": "intel corporation", "ibm research": "ibm", "ibm corporation": "ibm",
    "university of illinois at urbana champaign": "university of illinois urbana champaign",
    "university of illinois": "university of illinois urbana champaign", "uiuc": "university of illinois urbana champaign",
    "university of illinois at chicago": "university of illinois chicago", "georgia tech": "georgia institute of technology",
    "nudt": "national university of defense technology", "forschungzentrum juelich": "forschungszentrum julich",
    "forschungszentrum juelich": "forschungszentrum julich", "julich research centre": "forschungszentrum julich",
    "cea": "french alternative energies and atomic energy commission", "meta": "meta platforms inc",
    "google": "google llc", "google research": "google llc", "microsoft": "microsoft corporation",
    "microsoft research": "microsoft corporation", "aws": "amazon web services", "amazon": "amazon web services",
    "mit": "massachusetts institute of technology", "llnl": "lawrence livermore national laboratory",
    "ornl": "oak ridge national laboratory", "anl": "argonne national laboratory", "lbnl": "lawrence berkeley national laboratory",
    "lanl": "los alamos national laboratory", "sandia national laboratory": "sandia national laboratories",
    "pnnl": "pacific northwest national laboratory", "inria": "french institute for research in computer science and automation",
    "tu munich": "technical university of munich", "tu dresden": "technical university of dresden",
    "tu darmstadt": "technical university of darmstadt", "esnet": "energy sciences network",
    "ncsa": "national center for supercomputing applications", "sdsc": "san diego supercomputer center",
    "tacc": "texas advanced computing center", "nersc": "national energy research scientific computing center",
    "eth zuerich": "eth zurich", "epcc": "edinburgh parallel computing centre", "bsc": "barcelona supercomputing center",
    "university of tennessee": "university of tennessee knoxville", "virginia polytechnic institute and state university": "virginia tech",
}
ORG_DISPLAY = {"french institute for research in computer science and automation": "Inria",
               "advanced micro devices": "AMD", "hpe": "Hewlett Packard Enterprise (HPE)",
               "nvidia corporation": "NVIDIA", "meta platforms inc": "Meta", "google llc": "Google",
               "microsoft corporation": "Microsoft", "intel corporation": "Intel", "ibm": "IBM",
               "french alternative energies and atomic energy commission": "CEA (French Alternative Energies and Atomic Energy Commission)"}

STOP_EXTRA = set("""hpc high performance computing paper present presents presented work works propose proposed proposes
approach approaches based using use used uses results result show shows shown demonstrate demonstrates achieve achieves
achieved novel new existing however also can may will two three one first second across including include includes
well many much more most such via within without toward towards while often still yet thus therefore our we their
this that these those it its they them which who whom whose what when where why how session sessions talk talks
workshop workshops panel bof tutorial poster posters presentation presentations attendees participants discuss
discussion discussions sc sc26 supercomputing conference ieee acm international annual 2026 2025 th st nd rd
system systems application applications scale large data model models time research challenges challenge
state art end real world key provide provides enable enables enabling make makes need needs number order range
different several various current future recent significant significantly important critical""".split())


def nkey(s):
    """Normalize a name for matching: lowercase, no accents, no punctuation."""
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    s = re.sub(r"\([^)]*\)", " ", s)
    s = s.replace("&", " and ")
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    s = re.sub(r"^the ", "", s.strip())
    return re.sub(r"\s+", " ", s).strip()


def person_key(name):
    """'Michael E. Papka' -> 'michael papka' (first + last token, initials dropped)."""
    k = nkey(name).replace(" and ", " ")
    toks = [t for t in k.split() if len(t) > 1]
    if len(toks) < 2:
        return k
    return toks[0] + " " + toks[-1]


def org_sector(name, exhibitor=False):
    """Rough sector of an organization from its name: edu, lab, com or oth."""
    n = " " + nkey(name) + " "
    if re.search(r" (independent|freelance|retired|self employed|none|n a|unaffiliated) ", n):
        return "oth"
    if re.search(r" (universit|college|school|institute of technology|polytechni|eth |epfl |academy of sciences|"
                 r"institut[eo]? .*technolog|virginia tech|georgia tech|illinois tech|mit |kaist|kaust|iit |iisc|"
                 r"hochschule|universidad|universite|universita|universidade|universitat|graduate|faculty|academy|"
                 r"caltech|ucl |usc |uic |uiuc|ucla|ucsd|ucsb|uc berkeley|unicamp|unesp|fau |rwth|kth |dtu |tum |"
                 r"nyu |cmu |lsu |asu |osu |psu |ut dallas|ut austin|texas a and m|missouri s and t|northwestern |"
                 r"politecnico|ecole|sorbonne|imperial college|tu wien|tu delft|kit |nudt|ustc|sjtu)", n):
        return "edu"
    if re.search(r" (national lab|laborator|lab |labs? of|sciences network|national aeronautics|atomic energy|light source|research and innovation|supercomput|computing cent|computing facility|research cent|"
                 r"riken|cern|nasa|noaa|ncar|inria|cea |cnrs|fraunhofer|max planck|helmholtz|forschungszentrum|csiro|"
                 r"institute|institut |science network|research network|education network|ncsa|nersc|tacc|epcc|cscs|"
                 r"csc |lrz|hlrs|cineca|observatory|accelerator|department of|national institutes|national center|"
                 r"national centre|national science|agency|ministry|government|air force|army|navy|research council|"
                 r"foundation|stfc|hartree|eurohpc|consortium|esnet|internet2|geant|reannz|rede nacional|nhr|"
                 r"sandia|llnl|ornl|lanl|snl |pnnl|doe |nsf |cancer center|clinic|hospital|medical center|"
                 r"association|society|working group|centre|center for|centro|zentrum|bsc|jsc|olcf|alcf|embl)", n):
        return "lab"
    if exhibitor or re.search(r" (inc|corp|corporation|ltd|llc|gmbh|co|technologies|technology|systems|ai|cloud|data|"
                              r"semiconductor|microsystems|networks|software|solutions|group|sas|sasu|bv|ag|plc|limited|"
                              r"company|labs|quantum|computing|nvidia|intel|amd|ibm|hpe|meta|google|microsoft|amazon|"
                              r"cisco|huawei|fujitsu|nec|dell|lenovo|arm|samsung|hynix|micron|cerebras|coreweave|"
                              r"quantinuum|iqm|infleqtion|alibaba|tencent|baidu|bytedance|oracle|apple|qualcomm|"
                              r"broadcom|marvell|ciena|arista|juniper|atos|eviden|cray|supermicro|penguin|openai|"
                              r"anthropic|deepmind|imec|ou) ", n):
        return "com"
    return "oth"


def hsl_hex(h, s, li):
    c = (1 - abs(2 * li - 1)) * s
    x = c * (1 - abs((h / 60) % 2 - 1))
    m = li - c / 2
    r, g, b = [(c, x, 0), (x, c, 0), (0, c, x), (0, x, c), (x, 0, c), (c, 0, x)][int(h // 60) % 6]
    return "#%02X%02X%02X" % tuple(int(round((v + m) * 255)) for v in (r, g, b))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--program", required=True)
    ap.add_argument("--raw", required=True)
    ap.add_argument("--web", required=True)
    ap.add_argument("--theme-report", action="store_true", help="print theme coverage and sample titles")
    ap.add_argument("--no-images", action="store_true", help="skip photo / poster conversion")
    a = ap.parse_args()

    import numpy as np
    from sklearn.decomposition import TruncatedSVD
    from sklearn.feature_extraction.text import TfidfVectorizer, ENGLISH_STOP_WORDS
    from sklearn.manifold import TSNE

    D = json.load(open(a.program, encoding="utf-8"))
    types, tagdefs = D["types"], D["tags"]
    S = {s["id"]: s for s in D["sessions"]}
    P = D["presentations"]

    # ------------------------------------------------------------------ orgs
    raw_orgs = {o["id"]: o for o in D["orgs"]}
    people_per_org = Counter()
    for p in D["people"]:
        for o in p["orgs"]:
            people_per_org[o] += 1
    groups = defaultdict(list)
    for oid, o in raw_orgs.items():
        k = nkey(o["name"])
        if k.startswith("nvidia"):
            k = "nvidia corporation"
        k = ORG_ALIASES.get(k, k)
        groups[k].append(oid)
    org_index, orgs = {}, []
    for k, ids in groups.items():
        ids.sort(key=lambda i: (-people_per_org[i], raw_orgs[i]["name"]))
        with_paren = [i for i in ids if "(" in raw_orgs[i]["name"] and nkey(raw_orgs[i]["name"]) == k]
        name = ORG_DISPLAY.get(k) or raw_orgs[(with_paren or ids)[0]]["name"]
        idx = len(orgs)
        is_ex = any(raw_orgs[i].get("exhibitor") for i in ids)
        orgs.append({"n": name, "k": org_sector(name, is_ex), "key": k,
                     "ex": 1 if is_ex else 0,
                     "booth": next((raw_orgs[i]["booth"] for i in ids if raw_orgs[i].get("booth")), None)})
        for i in ids:
            org_index[i] = idx

    # --------------------------------------------------------------- people
    countries, country_index = [], {}

    def cidx(name):
        if not name:
            return -1
        disp, num, lat, lon = COUNTRIES.get(name, (name, None, None, None))
        if disp not in country_index:
            country_index[disp] = len(countries)
            countries.append({"name": disp, "num": num, "lat": lat, "lon": lon})
        return country_index[disp]

    # The program lists some contributors under two profile ids. Two records are the
    # same person when the names match exactly and they share an organization.
    appearances = Counter()
    for s in D["sessions"]:
        for x in s["people"]:
            appearances[x["uid"]] += 1
    for p in P:
        for x in p["people"]:
            appearances[x["uid"]] += 1
    people, pidx, by_name = [], {}, defaultdict(list)
    merged_people = 0
    for p in sorted(D["people"], key=lambda p: -appearances[p["id"]]):
        o = []
        for i in p["orgs"]:
            if org_index[i] not in o:
                o.append(org_index[i])
        nk = re.sub(r"\s+", " ", p["name"].lower().strip())
        twin = next((j for j in by_name[nk] if set(people[j]["o"]) & set(o)), None)
        if twin is not None:
            t = people[twin]
            pidx[p["id"]] = twin
            t["o"] += [x for x in o if x not in t["o"]]
            if t["c"] < 0:
                t["c"] = cidx(p.get("country"))
            t["_photo"] = t["_photo"] or p.get("photo")
            t["_bio"] = t["_bio"] or (p.get("bio") or "")
            merged_people += 1
            continue
        pidx[p["id"]] = len(people)
        by_name[nk].append(len(people))
        people.append({"id": p["id"], "n": p["name"], "o": o, "c": cidx(p.get("country")),
                       "_photo": p.get("photo"), "_bio": p.get("bio") or ""})
    # keep the directory in alphabetical order by family name
    order = sorted(range(len(people)), key=lambda i: (nkey(people[i]["n"]).split()[-1:] or [""], nkey(people[i]["n"])))
    remap = {old: new for new, old in enumerate(order)}
    people = [people[i] for i in order]
    pidx = {uid: remap[i] for uid, i in pidx.items()}

    # ---------------------------------------------------------------- rooms
    locs = D.get("map", {}).get("locations", {})
    layer_names = {"West1": ("West Building", "Level 1"), "west2": ("West Building", "Level 2"),
                   "west3": ("West Building", "Level 3"), "west4": ("West Building", "Level 4"),
                   "south1": ("South Building", "Level 1"), "lakeside3": ("Lakeside Center", "Level 3"),
                   "overview": ("McCormick Place", "Campus overview")}
    rooms, ridx = [], {}
    for rid, name in D["rooms"].items():
        loc = locs.get(rid, {})
        ridx[rid] = len(rooms)
        b, f = layer_names.get(loc.get("layer"), ("", ""))
        rooms.append({"id": rid, "n": name, "l": loc.get("layer"), "x": loc.get("x"), "y": loc.get("y"),
                      "b": b, "f": f})
    layers = []
    for layer in D.get("map", {}).get("layers", []):
        b, f = layer_names.get(layer["id"], (layer["name"], ""))
        layers.append({"id": layer["id"], "n": (b + " · " + f).strip(" ·"), "b": b, "f": f,
                       "file": "map/%s.svg" % layer["id"]})

    # -------------------------------------------------------------- formats
    fmt_of_type = {}
    for i, (fid, label, group, srcs, color) in enumerate(FORMATS):
        for s in srcs:
            fmt_of_type[s] = i
    fmt_id = {f[0]: i for i, f in enumerate(FORMATS)}

    def formats_for(type_codes, pid=""):
        names = [types.get(t, t) for t in type_codes]
        fs = sorted({fmt_of_type[n] for n in names if n in fmt_of_type})
        flags = 0
        if "Best Paper Finalist" in names:
            flags |= FLAG_BEST_PAPER
        if "Best Student Paper Finalist" in names:
            flags |= FLAG_BEST_STUDENT
        if any("Gordon Bell" in n for n in names):
            flags |= FLAG_GB
        if not fs:
            fs = [fmt_id["other"]]
        # an Art of HPC poster is art first; a Regional Tech Hub invited talk is an invited talk first
        if fmt_id["art"] in fs and fmt_id["poster"] in fs:
            fs = [fmt_id["art"]] + [f for f in fs if f != fmt_id["art"]]
        return fs, flags

    topic_codes = [c for c, t in tagdefs.items() if t["group"] == "topic"]
    tags = [{"id": c, "n": tagdefs[c]["name"]} for c in topic_codes]
    tidx = {c: i for i, c in enumerate(topic_codes)}
    live_codes = {c for c, t in tagdefs.items() if t["name"] == "Livestreamed"}
    rec_codes = {c for c, t in tagdefs.items() if t["name"] == "Recorded"}
    reg_short = {"Tech Program Reg Pass": "TP", "Workshop Reg Pass": "W", "Tutorial Reg Pass": "T", "Exhibits Reg Pass": "EX"}

    def reg_of(codes):
        return [reg_short.get(tagdefs[c]["name"], tagdefs[c]["name"]) for c in codes if c in tagdefs]

    def ppl(lst):
        out, seen = [], set()
        for x in lst:
            if x["uid"] not in pidx:
                continue
            role = x["role"]
            pres = 1 if x.get("presenting") else 0
            if role == "author/presenter":
                role, pres = "author", 1
            if role not in ROLE_ORDER:
                role = "presenter" if pres else "author"
            key = (x["uid"], role)
            if key in seen:
                continue
            seen.add(key)
            out.append([pidx[x["uid"]], ROLE_ORDER.index(role), pres])
        return out

    # ---------------------------------------------------------------- items
    by_sess = defaultdict(list)
    for p in P:
        by_sess[p["sess"]].append(p)
    canon = {}  # presentation id -> owning session (the more specific one when listed twice)
    for p in P:
        cur = canon.get(p["id"])
        if cur is None or len(by_sess[p["sess"]]) < len(by_sess[cur]):
            canon[p["id"]] = p["sess"]

    items, texts = [], []
    item_of_sess, item_of_pres = {}, {}

    def is_break(p):
        return p["id"].startswith("brea") or bool(re.match(
            r"^\s*(coffee |morning |afternoon |lunch |networking )?(break|lunch)\b", p["title"], re.I))

    def add(it, text):
        items.append(it)
        texts.append(text)
        return len(items) - 1

    for s in D["sessions"]:
        kids = sorted(by_sess.get(s["id"], []), key=lambda p: (p["start"] or 0, p["end"] or 0, p["id"]))
        fs, flags = formats_for(s["types"])
        if set(s["rec"]) & live_codes:
            flags |= FLAG_LIVE
        if set(s["rec"]) & rec_codes:
            flags |= FLAG_REC
        it = {"id": s["id"], "k": "S", "t": s["title"], "f": fs[0], "fs": fs, "fl": flags,
              "s": s["start"], "e": s["end"], "r": ridx.get(s["room"], -1),
              "g": [tidx[c] for c in s["tags"] if c in tidx], "p": ppl(s["people"]), "ch": [],
              "reg": reg_of(s["reg"])}
        text = s["desc"]
        merged = None
        if len(kids) == 1 and not is_break(kids[0]) and canon[kids[0]["id"]] == s["id"] and (
                s.get("single") or (kids[0]["start"] == s["start"] and kids[0]["end"] == s["end"])):
            merged = kids[0]
            it["pid"] = merged["id"]
            # the talk can have its own title (keynote, plenary, award talk): lead with it and
            # keep the session name as a kicker; near-identical variants are only recorded
            mt = merged["title"]
            if mt and mt != s["title"]:
                ta, tb = set(nkey(mt).split()), set(nkey(s["title"]).split())
                if len(ta & tb) < 0.5 * max(1, len(ta | tb)):
                    it["st"], it["t"] = s["title"], mt
                else:
                    it["pt"] = mt
            if len(merged["abstract"]) >= len(text):
                text = merged["abstract"]
            # authors first, then session chairs that are not already listed
            have = {(x[0], x[1]) for x in ppl(merged["people"])}
            it["p"] = ppl(merged["people"]) + [x for x in it["p"] if (x[0], x[1]) not in have]
            if merged["tags"] and not it["g"]:
                it["g"] = [tidx[c] for c in merged["tags"] if c in tidx]
            for k_src, k_dst in (("dl", "dl"), ("video", "vid")):
                if merged.get(k_src):
                    it[k_dst] = merged[k_src]
            if merged.get("links"):
                it["ln"] = [[x["label"], x["url"]] for x in merged["links"]]
            fs2, fl2 = formats_for(merged["types"])
            it["fl"] |= fl2
        si = add(it, text)
        item_of_sess[s["id"]] = si
        if merged:
            item_of_pres[(s["id"], merged["id"])] = si
            continue
        for p in kids:
            if canon[p["id"]] != s["id"]:
                continue  # listed again under a broader session; linked below
            fs, flags = formats_for(p["types"] or s["types"])
            if is_break(p):
                flags |= FLAG_BREAK
            if p.get("poster") or FORMATS[fs[0]][0] == "poster":
                flags |= FLAG_POSTER
            if set(p["rec"] or s["rec"]) & live_codes:
                flags |= FLAG_LIVE
            if set(p["rec"] or s["rec"]) & rec_codes:
                flags |= FLAG_REC
            g = [tidx[c] for c in p["tags"] if c in tidx] or list(it["g"])
            pit = {"id": s["id"] + "/" + p["id"], "k": "P", "par": si, "t": p["title"], "f": fs[0], "fs": fs,
                   "fl": flags, "s": p["start"], "e": p["end"], "r": ridx.get(p["room"] or s["room"], it["r"]),
                   "g": g, "p": ppl(p["people"])}
            if p.get("dl"):
                pit["dl"] = p["dl"]
            if p.get("video"):
                pit["vid"] = p["video"]
            if p.get("links"):
                pit["ln"] = [[x["label"], x["url"]] for x in p["links"]]
            if p.get("image"):
                pit["_img"] = p["image"]
            sub = re.sub(r"\d+$", "", p["id"])
            kind = {"rpost": "Research Poster", "src_post": "ACM Student Research Competition",
                    "drs": "Doctoral Showcase", "int_post": "Interactive e-Poster", "art": "Art of HPC",
                    "artc": "Art of HPC"}.get(sub)
            if kind:
                pit["sub"] = kind
            pi = add(pit, p["abstract"])
            item_of_pres[(s["id"], p["id"])] = pi
            items[si]["ch"].append(pi)
    # second listings (poster reception, doctoral showcase display ...)
    for p in P:
        if canon[p["id"]] != p["sess"]:
            pi = item_of_pres.get((canon[p["id"]], p["id"]))
            si = item_of_sess.get(p["sess"])
            if pi is not None and si is not None and pi != si:
                items[si]["ch"].append(pi)
                items[pi].setdefault("alt", []).append(si)
                item_of_pres[(p["sess"], p["id"])] = pi
    for it in items:
        if it["k"] == "S" and it["ch"]:
            it["ch"].sort(key=lambda i: (items[i]["s"] or 0, items[i]["e"] or 0))

    n = len(items)
    for i, it in enumerate(items):
        if len(texts[i]) >= 40:
            it["fl"] |= FLAG_TEXT

    # content items: what the galaxy, the themes and "related" operate on
    def is_content(i):
        it = items[i]
        if it["fl"] & FLAG_BREAK:
            return False
        if it["k"] == "S" and it["ch"]:
            return False
        return len(texts[i]) >= 120

    def doc(i):
        it = items[i]
        par = items[it["par"]]["t"] if it["k"] == "P" else ""
        return it["t"], texts[i], par

    # --------------------------------------------------------------- themes
    compiled = [(tid, name, [(re.compile(rx, re.I), w) for rx, w in pats]) for tid, name, pats in THEMES]
    theme_count = Counter()
    for i, it in enumerate(items):
        if it["fl"] & FLAG_BREAK:
            continue
        title, body, par = doc(i)
        if it["k"] == "S" and it["ch"]:
            body = body + " " + " ".join(items[c]["t"] for c in it["ch"])
        scores = []
        for ti, (tid, name, pats) in enumerate(compiled):
            sc = 0.0
            for rx, w in pats:
                ht = len(rx.findall(title))
                hb = len(rx.findall(body))
                sc += w * (3 * min(ht, 1) + min(hb, 3))
            # a short workshop talk inherits a little context from its session title
            if par:
                sc += 0.5 * sum(w for rx, w in pats if rx.search(par))
            if sc >= THRESHOLD:
                scores.append((sc, ti))
        scores.sort(reverse=True)
        if scores:
            top = scores[0][0]
            keep = [(ti, max(1, min(9, int(round(9 * sc / top))))) for sc, ti in scores[:5] if sc >= 0.34 * top]
            it["th"] = [[ti, v] for ti, v in keep]
            for ti, v in keep:
                theme_count[ti] += 1
    themes = []
    for ti, (tid, name, pats) in enumerate(compiled):
        themes.append({"id": tid, "n": name, "c": hsl_hex((ti * 360.0 / len(compiled) * 7) % 360, 0.72, 0.62),
                       "cnt": theme_count[ti]})

    # ------------------------------------------------- TF-IDF, related, galaxy
    cidxs = [i for i in range(n) if is_content(i)]
    stop = list(ENGLISH_STOP_WORDS | STOP_EXTRA)
    corpus = []
    for i in cidxs:
        title, body, par = doc(i)
        corpus.append((title + ". ") * 3 + body)
    vec = TfidfVectorizer(stop_words=stop, ngram_range=(1, 2), min_df=2, max_df=0.35, sublinear_tf=True,
                          token_pattern=r"(?u)\b[a-zA-Z][a-zA-Z0-9+#\-/]{1,}\b")
    X = vec.fit_transform(corpus)
    vocab = np.array(vec.get_feature_names_out())
    sims = (X @ X.T).toarray()
    np.fill_diagonal(sims, 0)
    for row, i in enumerate(cidxs):
        order = np.argsort(-sims[row])[:8]
        items[i]["sim"] = [int(cidxs[j]) for j in order if sims[row, j] > 0.08][:6]
        # most characteristic terms of this item
        r = X.getrow(row)
        if r.nnz:
            top = r.indices[np.argsort(-r.data)[:12]]
            kws = []
            for t in vocab[top]:
                if any(t in k or k in t for k in kws):
                    continue
                kws.append(t)
                if len(kws) == 5:
                    break
            items[i]["kw"] = kws
    svd = TruncatedSVD(n_components=min(60, X.shape[1] - 1), random_state=7)
    Z = svd.fit_transform(X)
    Z /= (np.linalg.norm(Z, axis=1, keepdims=True) + 1e-9)
    xy = TSNE(n_components=2, perplexity=32, init="pca", learning_rate="auto", random_state=7,
              metric="cosine").fit_transform(Z)
    xy -= xy.min(0)
    xy /= xy.max(0)
    for row, i in enumerate(cidxs):
        items[i]["x"] = [int(round(xy[row, 0] * 1000)), int(round(xy[row, 1] * 1000))]

    # buzzwords: terms that keep showing up in titles (titles carry the topical words)
    from sklearn.feature_extraction.text import CountVectorizer
    generic = set("""hpc ai performance data systems computing scientific workshop research science scale applications
        international using talk software analysis framework high efficient building community future tech regional hub
        invited meet greet room remarks study new impact closing welcome world panel lessons design case sc modern large
        best annual acm talks based presentations poster display advanced featured shuttle discussion early age time
        understanding leveraging enabling evaluating characterizing accelerating students papers conversation model
        models learning hardware architecture architectures management tools open support user resource execution
        evaluation generation code computational characterization engineering emerging center machine environments
        integration platforms platform production global computation era space strategies access student unified
        opening session introduction keynote lightning break lunch towards toward via approach system application
        network networks 2026 th nd st rd ieee workloads workload hybrid adaptive dynamic scalable scaling
        heterogeneous distributed parallel infrastructure optimization modeling simulation simulations control
        interactive prediction operational operations challenges ecosystem cluster clusters image search engine
        detection representation placement discovery programming runtime pipeline stack error linear kernel kernels
        accelerated accelerator accelerators communication collective large-scale high-performance multiplication
        decomposition barrier fabric mission digital genesis reduction supercomputers supercomputing""".split())
    titles = [it["t"] for it in items if not it["fl"] & FLAG_BREAK]
    cv = CountVectorizer(stop_words="english", ngram_range=(1, 2), min_df=7, binary=True,
                         token_pattern=r"(?u)\b[a-zA-Z][a-zA-Z0-9+#\-/]{1,}\b")
    tdf = np.asarray(cv.fit_transform(titles).sum(0)).ravel()
    cand = sorted(zip(tdf.tolist(), cv.get_feature_names_out().tolist()), reverse=True)
    buzz = []
    for c, t in cand:
        toks = t.split()
        if all(x in generic for x in toks) or len(t) < 3:
            continue
        if len(toks) == 2 and (toks[0] in generic and toks[1] in generic):
            continue
        # skip a single word when a kept phrase already covers nearly all of its uses
        if len(toks) == 1 and any(t in b[0].split() and b[1] >= 0.8 * c for b in buzz):
            continue
        buzz.append([t, int(c)])
        if len(buzz) == 90:
            break

    # ---------------------------------------------------- contributor scores
    act = defaultdict(float)
    cnt_items = Counter()
    for it in items:
        if it["fl"] & FLAG_BREAK:
            continue
        fw = FORMAT_WEIGHT.get(FORMATS[it["f"]][0], 0.6)
        for pi, role, pres in it["p"]:
            w = ROLE_WEIGHT[ROLE_ORDER[role]]
            if pres and ROLE_ORDER[role] == "author":
                w = 1.6
            act[pi] += fw * w
            cnt_items[pi] += 1
    for i, p in enumerate(people):
        p["w"] = round(act[i], 1)
        p["ni"] = cnt_items[i]

    # ----------------------------------------------- prior SC papers (OpenAlex)
    oa_files = sorted(glob.glob(os.path.join(a.raw, "openalex", "page_*.json")))
    hist_n = 0
    if oa_files:
        by_name = defaultdict(list)
        for fn in oa_files:
            for w in json.load(open(fn))["results"]:
                for au in w.get("authorships", []):
                    raw_name = au.get("raw_author_name") or au["author"].get("display_name") or ""
                    inst = [nkey(x.get("display_name", "")) for x in au.get("institutions", [])]
                    inst += [nkey(x) for x in au.get("raw_affiliation_strings", [])]
                    by_name[person_key(raw_name)].append({
                        "aid": au["author"].get("id"), "y": w.get("publication_year"),
                        "c": w.get("cited_by_count") or 0, "t": w.get("display_name") or "", "inst": inst,
                        "wid": w["id"]})
        key_count = Counter(person_key(p["n"]) for p in people)
        for p in people:
            recs = by_name.get(person_key(p["n"]))
            if not recs:
                continue
            aids = {r["aid"] for r in recs}
            if len(aids) > 1 or key_count[person_key(p["n"])] > 1:
                # several OpenAlex author profiles, or several SC26 contributors, share this name:
                # keep only papers whose affiliation matches one of this person's SC26 organizations
                mine = [orgs[o]["key"] for o in p["o"]]
                mine_tokens = [set(k.split()) - {"of", "the", "and", "university", "institute", "national", "laboratory"} for k in mine]
                keep = []
                for r in recs:
                    ok = False
                    for k, toks in zip(mine, mine_tokens):
                        for ins in r["inst"]:
                            if not ins:
                                continue
                            if k and (k in ins or ins in k):
                                ok = True
                            elif toks and len(toks & set(ins.split())) >= max(1, min(2, len(toks))):
                                ok = True
                    if ok:
                        keep.append(r)
                recs = keep
            seen, uniq = set(), []
            for r in recs:
                if r["wid"] not in seen:
                    seen.add(r["wid"])
                    uniq.append(r)
            if not uniq:
                continue
            best = max(uniq, key=lambda r: r["c"])
            ys = [r["y"] for r in uniq if r["y"]]
            p["sc"] = [len(uniq), min(ys), max(ys), sum(r["c"] for r in uniq), best["t"][:140], best["y"], best["c"]]
            hist_n += 1

    # -------------------------------------------------------------- org stats
    org_people = Counter()
    org_country = defaultdict(Counter)
    for p in people:
        for o in p["o"]:
            org_people[o] += 1
            if p["c"] >= 0:
                org_country[o][p["c"]] += 1
    for i, o in enumerate(orgs):
        o["np"] = org_people[i]
        o["c"] = org_country[i].most_common(1)[0][0] if org_country[i] else -1
        del o["key"]
        if not o["booth"]:
            del o["booth"]
        if not o["ex"]:
            del o["ex"]
    for c in countries:
        c["np"] = 0
    for p in people:
        if p["c"] >= 0:
            countries[p["c"]]["np"] += 1

    # ---------------------------------------------------------------- images
    img_dir = os.path.join(a.web, "img")
    n_photo = n_poster = 0
    if not a.no_images:
        from PIL import Image, ImageOps
        os.makedirs(os.path.join(img_dir, "p"), exist_ok=True)
        os.makedirs(os.path.join(img_dir, "poster"), exist_ok=True)
        for p in people:
            fn = p["_photo"]
            src = os.path.join(a.raw, "photo", fn) if fn else None
            dst = os.path.join(img_dir, "p", p["id"] + ".webp")
            if src and os.path.exists(src):
                try:
                    if not os.path.exists(dst) or os.path.getmtime(dst) < os.path.getmtime(src):
                        im = ImageOps.exif_transpose(Image.open(src)).convert("RGB")
                        im = ImageOps.fit(im, (160, 160), Image.LANCZOS, centering=(0.5, 0.35))
                        im.save(dst, "WEBP", quality=72, method=6)
                    p["ph"] = 1
                    n_photo += 1
                except Exception as e:
                    print("  photo %s unreadable: %s" % (fn, e), file=sys.stderr)
        for it in items:
            fn = it.pop("_img", None)
            src = os.path.join(a.raw, "poster", fn) if fn else None
            if src and os.path.exists(src):
                name = re.sub(r"[^A-Za-z0-9_]+", "_", it["id"]) + ".webp"
                dst = os.path.join(img_dir, "poster", name)
                try:
                    if not os.path.exists(dst):
                        im = Image.open(src).convert("RGB")
                        im.thumbnail((560, 560), Image.LANCZOS)
                        im.save(dst, "WEBP", quality=68, method=6)
                    it["img"] = name
                    n_poster += 1
                except Exception as e:
                    print("  poster %s unreadable: %s" % (fn, e), file=sys.stderr)
            elif fn:
                it["ir"] = fn   # preview exists online but is not bundled
    for it in items:
        fn = it.pop("_img", None)
        if fn and "img" not in it:
            it["ir"] = fn
    # a photo the program site is known to have but that is not bundled: load it online
    for p in people:
        if p["_photo"] and not p.get("ph"):
            p["px"] = p["_photo"].rsplit(".", 1)[-1]
    bios = {}
    for i, p in enumerate(people):
        if p["_bio"]:
            bios[str(i)] = p["_bio"]
        del p["_photo"], p["_bio"]

    # floor plans
    os.makedirs(os.path.join(a.web, "map"), exist_ok=True)
    for layer in layers:
        src = os.path.join(a.raw, "map", layer["id"] + ".svg")
        if os.path.exists(src):
            shutil.copyfile(src, os.path.join(a.web, layer["file"]))
            head = open(src, encoding="utf-8", errors="replace").read(600)
            m = re.search(r'viewBox="([\d.\- ]+)"', head)
            if m:
                vb = [float(v) for v in m.group(1).split()]
                layer["w"], layer["h"] = vb[2], vb[3]

    # ----------------------------------------------------------------- write
    counts = {
        "items": sum(1 for it in items if not it["fl"] & FLAG_BREAK),
        "sessions": sum(1 for it in items if it["k"] == "S"),
        "talks": len(cidxs),
        "people": len(people), "orgs": len(orgs), "countries": len(countries),
        "photos": n_photo, "posters": n_poster, "scHistory": hist_n,
    }
    for it in items:
        for k in ("p", "g", "ch", "reg"):
            if k in it and not it[k]:
                del it[k]
        if it.get("fs") == [it["f"]]:
            del it["fs"]
        if not it["fl"]:
            del it["fl"]
        if it["r"] < 0:
            del it["r"]
    core = {
        "meta": {"generated": D["generated"], "source": D["source"], "tzOffsetMin": TZ_OFFSET_MIN, "tzName": "CST",
                 "days": DAYS, "counts": counts,
                 "photoBase": "https://sc26.conference-program.com/wp-content/linklings_snippets/presenter_pics/wp_presenter_img_",
                 "posterBase": "https://sc26.conference-program.com/wp-content/linklings_snippets/representative_images/",
                 "siteBase": "https://sc26.conference-program.com/"},
        "formats": [{"id": f[0], "n": f[1], "grp": f[2], "c": f[4]} for f in FORMATS],
        "roles": ROLE_ORDER, "tags": tags, "themes": themes, "rooms": rooms, "layers": layers,
        "countries": countries, "orgs": orgs, "people": people, "items": items, "buzz": buzz,
    }
    os.makedirs(os.path.join(a.web, "data"), exist_ok=True)
    with open(os.path.join(a.web, "data", "core.json"), "w", encoding="utf-8") as f:
        json.dump(core, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(a.web, "data", "text.json"), "w", encoding="utf-8") as f:
        json.dump({"items": texts, "bios": bios}, f, ensure_ascii=False, separators=(",", ":"))

    print("items %d (sessions %d, content %d)  people %d  orgs %d  countries %d" % (
        n, counts["sessions"], counts["talks"], len(people), len(orgs), len(countries)))
    print("photos bundled %d, posters %d, bios %d, prior-SC matches %d" % (n_photo, n_poster, len(bios), hist_n))
    themed = sum(1 for i in cidxs if items[i].get("th"))
    print("content items with a theme: %d of %d (%.0f%%)" % (themed, len(cidxs), 100.0 * themed / len(cidxs)))
    for fn in ("core.json", "text.json"):
        print("  %s %.2f MB" % (fn, os.path.getsize(os.path.join(a.web, "data", fn)) / 1e6))
    if a.theme_report:
        for ti, th in enumerate(themes):
            ex = [it["t"][:70] for it in items if it.get("th") and it["th"][0][0] == ti][:4]
            print("%4d  %-44s %s" % (th["cnt"], th["n"], " | ".join(ex)))
        print("no theme:", [items[i]["t"][:60] for i in cidxs if not items[i].get("th")][:25])
        print("buzz:", buzz[:60])
    return 0


if __name__ == "__main__":
    sys.exit(main())
