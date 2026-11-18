#!/usr/bin/env python3
"""Download author lists of past SC conference papers from OpenAlex.

Usage:
    python3 -I scraper/fetch_openalex.py --out data/raw/openalex [--from-year 2010] [--to-year 2025]

OpenAlex (https://openalex.org) is an open index of scholarly works. The SC
proceedings are source S4363608557. This script pages through every SC paper
in the year range (about 14 requests) and caches each page as JSON. The app
uses the result to show how often an SC26 contributor has published at SC
before. Exit codes: 0 success, 1 error.
"""
import argparse
import gzip
import json
import os
import sys
import time
import urllib.parse
import urllib.request

SOURCE = "S4363608557"
UA = "sc26-atlas-personal-app/1.0"


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=90) as r:
        data = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            data = gzip.decompress(data)
    return json.loads(data)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True, help="cache directory")
    ap.add_argument("--from-year", type=int, default=2010)
    ap.add_argument("--to-year", type=int, default=2025)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    page, total, count = 1, 0, None
    while True:
        fn = os.path.join(a.out, "page_%02d.json" % page)
        if os.path.exists(fn):
            d = json.load(open(fn))
        else:
            url = "https://api.openalex.org/works?" + urllib.parse.urlencode({
                "filter": "primary_location.source.id:%s,publication_year:%d-%d" % (SOURCE, a.from_year, a.to_year),
                "per-page": 200, "page": page, "sort": "publication_year:desc",
                "select": "id,display_name,publication_year,cited_by_count,doi,authorships"})
            try:
                d = get(url)
            except Exception as e:
                print("request for page %d failed: %s" % (page, e), file=sys.stderr)
                return 1
            with open(fn, "w") as f:
                json.dump(d, f)
            time.sleep(1.5)
        count = d["meta"].get("count", count)
        n = len(d["results"])
        total += n
        print("page %d: %d works (total %d of %s)" % (page, n, total, count))
        if n < 200 or (count and total >= count):
            break
        page += 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
