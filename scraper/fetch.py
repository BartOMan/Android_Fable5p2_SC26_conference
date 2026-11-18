#!/usr/bin/env python3
"""Download the public SC26 program pages into a local cache.

Usage:
    python3 -I scraper/fetch.py --raw data/raw [--delay 1.2] [--limit N] [--only bulk|sessions|presentations|people|photos]

The site blocks an address that sends many requests at once (about 120 pages
in a few seconds was enough). Detail pages are therefore fetched one at a
time with a pause between requests, most important first, and the run stops
at the first sign of blocking so a later run can resume from the cache.

The SC26 schedule site (https://sc26.conference-program.com, run by Linklings)
publishes the whole program without a login. This script fetches:

  1. the bulk pages (daily schedule snippets, search page, contributors,
     organizations, posters, map data and floor plans)
  2. one page per session, per presentation and per contributor
  3. contributor photos referenced by those pages

Every response is cached on disk, so re-running only fetches what is missing.
Exit codes: 0 success, 1 error, 2 finished with some failed downloads.
"""
import argparse
import gzip
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = "https://sc26.conference-program.com"
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/126.0 Safari/537.36")
DAYS = ["2026-11-%02d" % d for d in range(14, 22)]
BULK_PAGES = ["contributors", "organizations", "posters", "map", "search-program"]


def http_get(url, binary=False, tries=2):
    """Return (status, bytes). Retries on network errors and 5xx/429."""
    last = None
    for attempt in range(tries):
        req = urllib.request.Request(url, headers={
            "User-Agent": UA, "Accept-Encoding": "gzip", "Accept": "*/*"})
        try:
            with urllib.request.urlopen(req, timeout=25) as r:
                data = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    data = gzip.decompress(data)
                return r.status, data
        except urllib.error.HTTPError as e:
            if e.code in (404, 403, 410):
                return e.code, b""
            last = e
        except Exception as e:  # network trouble: retry with backoff
            last = e
        time.sleep(1.5 * (attempt + 1))
    raise RuntimeError("failed %s: %s" % (url, last))


def cached(path, url, binary=False, min_size=200):
    """Fetch url into path unless a usable cached copy exists. Returns status string."""
    if os.path.exists(path) and os.path.getsize(path) >= min_size:
        return "cached"
    if os.path.exists(path + ".404"):
        return "404"
    status, data = http_get(url, binary=binary)
    if status != 200:
        open(path + ".404", "w").close()
        return str(status)
    tmp = path + ".part"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)
    return "fetched"


class Blocked(Exception):
    pass


DELAY = 1.2


def run_pool(jobs, workers, label):
    """Fetch jobs [(path, url)] one at a time with a pause. Returns the number of failures.

    Raises Blocked after three failures in a row, which is how a rate-limit ban shows up.
    """
    stats = {}
    fails = streak = 0
    t0 = time.time()
    for i, (p, u) in enumerate(jobs, 1):
        try:
            st = cached(p, u)
            streak = 0
        except Exception as e:
            st = "error"
            fails += 1
            streak += 1
            print("  ! %s -> %s" % (u, e), file=sys.stderr)
            if streak >= 3:
                print("  %s stopped at %d/%d %s" % (label, i, len(jobs), stats), flush=True)
                raise Blocked("three failures in a row; the site is probably blocking this address")
        stats[st] = stats.get(st, 0) + 1
        if st == "fetched":
            time.sleep(DELAY)
        if i % 100 == 0 or i == len(jobs):
            print("  %s %d/%d %s (%.0fs)" % (label, i, len(jobs), stats, time.time() - t0), flush=True)
    return fails


def read(path):
    with open(path, encoding="utf-8", errors="replace") as f:
        return f.read()


def fetch_bulk(raw):
    home = os.path.join(raw, "prog_home.html")
    cached(home, BASE + "/")
    ver = re.search(r"wp_program_view_all_[0-9-]+\.txt\?v=(\d+)", read(home))
    ver = ver.group(1) if ver else "1"
    jobs = []
    for d in DAYS:
        jobs.append((os.path.join(raw, "day_%s.html" % d),
                     "%s/wp-content/linklings_snippets/wp_program_view_all_%s.txt?v=%s" % (BASE, d, ver)))
    for p in BULK_PAGES:
        jobs.append((os.path.join(raw, "page_%s.html" % p), "%s/%s/" % (BASE, p)))
    fails = run_pool(jobs, 2, "bulk")
    # venue map (Mapplic): JSON + one SVG per floor
    m = re.search(r'data-json="([^"]+)"', read(os.path.join(raw, "page_map.html")))
    if m:
        mp = os.path.join(raw, "mapdata.json")
        cached(mp, m.group(1))
        os.makedirs(os.path.join(raw, "map"), exist_ok=True)
        for layer in json.load(open(mp))["layers"]:
            cached(os.path.join(raw, "map", layer["id"] + ".svg"), layer["file"])
    return fails


def discover(raw):
    """Collect session ids, (session, presentation) pairs and person ids from the bulk pages."""
    sessions, pres, people = set(), set(), set()
    names = ["day_%s.html" % d for d in DAYS] + ["page_%s.html" % p for p in BULK_PAGES]
    for sub in ("sess", "pres"):
        d = os.path.join(raw, sub)
        if os.path.isdir(d):
            names += [os.path.join(sub, f) for f in os.listdir(d) if f.endswith(".html")]
    for n in names:
        p = os.path.join(raw, n)
        if not os.path.exists(p):
            continue
        s = read(p)
        for a, b in re.findall(r'psid="(sess\d+)"\s+ssid="([^"]+)"', s):
            sessions.add(a)
            if b != "none":
                pres.add((a, b))
        for b, a in re.findall(r'[?&](?:amp;)?id=([A-Za-z0-9_]+)&(?:amp;)?sess=(sess\d+)', s):
            sessions.add(a)
            pres.add((a, b))
        sessions.update(re.findall(r'[?&](?:amp;)?sess=(sess\d+)', s))
        people.update(re.findall(r'[?&](?:amp;)?uid=(\d+)', s))
    # job postings are listed as "presentations" of the career fair; skip them
    pres = {(a, b) for a, b in pres if not b.startswith("job")}
    return sessions, pres, people


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--raw", required=True, help="cache directory for downloaded pages")
    ap.add_argument("--delay", type=float, default=1.2, help="seconds to wait between requests (default 1.2)")
    ap.add_argument("--limit", type=int, default=0, help="fetch at most N new pages per stage (0 = no limit)")
    ap.add_argument("--only", choices=["bulk", "sessions", "presentations", "people", "photos"],
                    help="run a single stage")
    a = ap.parse_args()
    global DELAY
    DELAY = a.delay
    raw = a.raw
    for sub in ("sess", "pres", "person", "photo", "poster", "map"):
        os.makedirs(os.path.join(raw, sub), exist_ok=True)
    fails = 0
    stage = a.only

    def todo(jobs):
        """Drop jobs already answered; apply --limit to the rest."""
        rest = [(p, u) for p, u in jobs if not (os.path.exists(p) and os.path.getsize(p) >= 200) and not os.path.exists(p + ".404")]
        return rest[:a.limit] if a.limit else rest

    try:
        if stage in (None, "bulk"):
            fails += fetch_bulk(raw)

        if stage in (None, "sessions"):
            sessions, _, _ = discover(raw)
            jobs = [(os.path.join(raw, "sess", s + ".html"), "%s/?post_type=page&p=17&sess=%s" % (BASE, s))
                    for s in sorted(sessions)]
            fails += run_pool(todo(jobs), 1, "sessions")

        if stage in (None, "presentations"):
            _, pres, _ = discover(raw)  # session pages may list extra presentations
            # papers and award talks first: their pages carry the link to the published paper
            rank = lambda p: (0 if re.match(r"(pap|gb|gbv|awd|inv)\d", p) else 1 if re.match(r"(pan|bof|tut|drs|exforum)\d", p) else 2, p)
            jobs = [(os.path.join(raw, "pres", "%s--%s.html" % (s, p)),
                     "%s/?post_type=page&p=16&id=%s&sess=%s" % (BASE, p, s))
                    for s, p in sorted(pres, key=lambda sp: rank(sp[1])) if not p.startswith(("brea",))]
            fails += run_pool(todo(jobs), 1, "presentations")

        if stage in (None, "people"):
            _, _, people = discover(raw)
            # most visible contributors first: count how often each id appears in the search page
            sp = os.path.join(raw, "page_search-program.html")
            seen = {}
            if os.path.exists(sp):
                for u in re.findall(r'[?&](?:amp;)?uid=(\d+)', read(sp)):
                    seen[u] = seen.get(u, 0) + 1
            order = sorted(people, key=lambda u: (-seen.get(u, 0), u))
            jobs = [(os.path.join(raw, "person", u + ".html"), "%s/?post_type=page&p=15&uid=%s" % (BASE, u))
                    for u in order if len(u) <= 8]   # long ids are placeholders without a profile page
            fails += run_pool(todo(jobs), 1, "people")

        if stage in (None, "photos"):
            pics, posters = set(), set()
            for sub in ("person", "pres"):
                d = os.path.join(raw, sub)
                for f in os.listdir(d):
                    if f.endswith(".html"):
                        t = read(os.path.join(d, f))
                        pics.update(re.findall(r'presenter_pics/(wp_presenter_img_\d+\.\w+)', t))
                        posters.update(re.findall(r'representative_images/([\w.-]+\.\w+)', t))
            t = read(os.path.join(raw, "page_posters.html"))
            pics.update(re.findall(r'presenter_pics/(wp_presenter_img_\d+\.\w+)', t))
            posters.update(re.findall(r'representative_images/([\w.-]+\.\w+)', t))
            jobs = [(os.path.join(raw, "photo", p),
                     "%s/wp-content/linklings_snippets/presenter_pics/%s" % (BASE, p)) for p in sorted(pics)]
            jobs += [(os.path.join(raw, "poster", p),
                      "%s/wp-content/linklings_snippets/representative_images/%s" % (BASE, p)) for p in sorted(posters)]
            fails += run_pool(todo(jobs), 1, "images")
    except Blocked as e:
        print("stopped: %s. Wait, then run the same command again; finished pages are cached." % e)
        sys.exit(2)

    print("done, failures: %d" % fails)
    sys.exit(2 if fails else 0)


if __name__ == "__main__":
    main()
