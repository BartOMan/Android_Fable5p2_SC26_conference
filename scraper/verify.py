#!/usr/bin/env python3
"""Check that the app's data bundle contains everything the public program lists.

Usage:
    python3 -I scraper/verify.py --raw data/raw --web app/web/www

Re-reads the cached program pages independently of parse.py (plain regular
expressions on the HTML) and compares them with app/web/www/data/core.json:

  1. every session id in the daily schedule pages is an item
  2. every presentation in the search page is an item (or merged into its session)
  3. every contributor in the contributor index is a person (or merged twin)
  4. title, start, end and room of every presentation match the search page
  5. every room used by the program has a position on a floor plan

Exit codes: 0 everything matches, 1 at least one check failed.
"""
import argparse
import calendar
import html
import json
import os
import re
import sys
import time

DAYS = ["2026-11-%02d" % d for d in range(14, 22)]


def read(p):
    with open(p, encoding="utf-8", errors="replace") as f:
        return f.read()


def utc_min(s):
    return calendar.timegm(time.strptime(s, "%Y-%m-%dT%H:%M:%SZ")) // 60


def text(s):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s))).strip()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--raw", required=True)
    ap.add_argument("--web", required=True)
    a = ap.parse_args()
    core = json.load(open(os.path.join(a.web, "data", "core.json"), encoding="utf-8"))
    texts = json.load(open(os.path.join(a.web, "data", "text.json"), encoding="utf-8"))["items"]
    items = core["items"]
    by_id = {}
    for it in items:
        by_id[it["id"]] = it
        if it.get("pid"):
            by_id[it["id"] + "/" + it["pid"]] = it
    # a presentation listed under two sessions lives under one of them
    by_pid = {}
    for it in items:
        pid = it.get("pid") or (it["id"].split("/")[1] if "/" in it["id"] else None)
        if pid:
            by_pid.setdefault(pid, it)
    rooms = core["rooms"]
    fails = 0

    def check(name, bad, total, sample=None):
        nonlocal fails
        ok = not bad
        if not ok:
            fails += 1
        print("%s %-58s %d of %d%s" % ("✓" if ok else "✗", name, total - (len(bad) if hasattr(bad, "__len__") else bad), total,
                                        ("   missing: " + ", ".join(sorted(bad)[:6])) if bad and hasattr(bad, "__len__") else ""))

    # 1. sessions
    sess = set()
    for d in DAYS:
        p = os.path.join(a.raw, "day_%s.html" % d)
        if os.path.exists(p):
            sess.update(re.findall(r'<tr class="agenda-item presentation-row[^"]*"[^>]*psid="(sess\d+)"', read(p)))
    check("sessions from the daily pages are in the app", {s for s in sess if s not in by_id}, len(sess))

    # 2 + 4. presentations
    page = read(os.path.join(a.raw, "page_search-program.html"))
    blocks = re.split(r'(?=<div class="agenda-item presentation-title searchable_contents")', page)[1:]
    missing, wrong_title, wrong_time, wrong_room, no_text, n = set(), [], [], [], [], 0
    for b in blocks:
        m = re.match(r'<div class="agenda-item presentation-title searchable_contents" psid="([^"]+)" ssid="([^"]+)"', b)
        if not m or m.group(2).startswith("job"):
            continue
        n += 1
        sid, pid = m.groups()
        it = by_id.get(sid + "/" + pid) or by_pid.get(pid)
        if not it:
            missing.add(sid + "/" + pid)
            continue
        t = re.search(r'<div class="title-link"><a [^>]*>(.*?)</a>', b, re.S)
        title = text(t.group(1)) if t else ""
        if title and title not in (it["t"], it.get("st"), it.get("pt")):
            wrong_title.append(pid)
        st = re.search(r'start-time"[^>]*utc_time="([^"]+)"', b)
        en = re.search(r'end-time"[^>]*utc_time="([^"]+)"', b)
        same_listing = it["id"] in (sid + "/" + pid, sid)
        if st and en and same_listing and (utc_min(st.group(1)) != it["s"] or utc_min(en.group(1)) != it["e"]):
            wrong_time.append(pid)
        loc = re.search(r'location=(r[^"&]+)"', b)
        if loc and same_listing and (it.get("r") is None or rooms[it["r"]]["id"] != html.unescape(loc.group(1))):
            wrong_room.append(pid)
        ab = re.search(r'<span class="abstract"[^>]*>(.*?)</span></div>', b, re.S)
        if ab and len(text(ab.group(1))) > 40 and len(texts[items.index(it)]) < 40:
            no_text.append(pid)
    check("presentations from the search page are in the app", missing, n)
    check("presentation titles match the source", wrong_title, n)
    check("presentation start and end times match the source", wrong_time, n)
    check("presentation rooms match the source", wrong_room, n)
    check("abstracts in the source are in the app", no_text, n)

    # 3. contributors
    idx = read(os.path.join(a.raw, "page_contributors.html"))
    uids = set(re.findall(r'data-link-type="author-index.person" href="[^"]*uid=(\d+)"', idx))
    have = {p["id"] for p in core["people"]}
    names = {re.sub(r"\s+", " ", p["n"].lower().strip()) for p in core["people"]}
    lost = set()
    for m in re.finditer(r'data-link-type="author-index.person" href="[^"]*uid=(\d+)">([^<]*)</a>', idx):
        if m.group(1) not in have and re.sub(r"\s+", " ", html.unescape(m.group(2)).lower().strip()) not in names:
            lost.add(m.group(1))
    check("contributors from the index are in the app (twins merged)", lost, len(uids))

    # 5. rooms
    used = {it["r"] for it in items if it.get("r") is not None}
    check("rooms used by the program have a floor plan position", {rooms[r]["n"] for r in used if rooms[r].get("x") is None}, len(used))

    c = core["meta"]["counts"]
    print("\napp bundle: %d sessions, %d talks and posters with text, %d contributors, %d organizations, captured %s" % (
        c["sessions"], c["talks"], c["people"], c["orgs"], core["meta"]["generated"]))
    print("all checks passed" if not fails else "%d check(s) failed" % fails)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
