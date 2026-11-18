#!/usr/bin/env python3
"""Build the walking-route network the SC26 Atlas venue map uses.

Usage:
    python3 -I scraper/build_routes.py [--map data/raw/mapdata.json]
                                       [--core app/web/www/data/core.json]
                                       [--out app/web/www/data/routes.json] [--dry-run]

Examples:
    python3 -I scraper/build_routes.py                # rebuild app/web/www/data/routes.json
    python3 -I scraper/build_routes.py --dry-run      # run every check, write nothing

The venue map export (Mapplic) holds about 2,100 "routes": polylines in floor plan
units (800 x 1000) that together form the walkable path network of each floor.
Polylines meet where they share a vertex. A polyline with an "endpoint" is the
short spur from one location (a room) to the nearest corridor.

This script turns them into one small graph per floor:
  1. vertices are polyline points, rounded to 0.1 plan units; edges join neighbors
  2. every program room of core.json gets a vertex: the room end of its spur (for a
     large hall that is a door), or the nearest vertex when it has no spur
  3. dead ends that lead to no program room are removed (booth spurs, escalator
     stubs), and so are vertices in the middle of a straight run
  4. every pair of rooms on a floor is routed (Dijkstra) to prove the result works

Output, app/web/www/data/routes.json:
    {"v": 1, "scale": 10, "layers": {"<layerId>": {
        "n": [x0, y0, x1, y1, ...],     vertex coordinates, plan units x 10
        "e": [a0, b0, a1, b1, ...],     edges as vertex index pairs
        "r": {"<roomId>": vertex}}}}    program room -> its vertex

Only routes between two rooms on the same floor are supported. Where a floor's
network is split (West Building level 1 has two wings with no level-1 link) the
app falls back to a straight dashed line for pairs in different parts.

Options:
    --map PATH    Mapplic export with "routes" (default data/raw/mapdata.json)
    --core PATH   app data bundle with rooms and layers (default app/web/www/data/core.json)
    --out PATH    file to write (default app/web/www/data/routes.json)
    --dry-run, -n run every check, then stop before writing
    -h, --help    show this text

Exit codes: 0 success, 1 error (nothing written), 2 a check in step 3 or 4 failed
(the file is still written unless --dry-run was given).
"""
import argparse
import heapq
import json
import math
import os
import sys

SCALE = 10              # stored coordinates are plan units x SCALE
SNAP_LIMIT = 60.0       # a room farther than this from every vertex gets no route (plan units)
SPUR_TOLERANCE = 2.0    # a spur that starts farther than this from its room's pin is reported
HELP_WORDS = {"-h", "--help", "-help", "help", "-?", "--usage"}


def ok(msg):
    print("  ✓ " + msg)


def bad(msg):
    print("  ✗ " + msg, file=sys.stderr)


def die(headline, *detail):
    print("error: " + headline, file=sys.stderr)
    for line in detail:
        print("  " + line, file=sys.stderr)
    print("  Nothing was written.", file=sys.stderr)
    sys.exit(1)


def load_json(path, what, fix):
    if not os.path.isfile(path):
        die("%s not found: %s" % (what, path), fix)
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError) as e:
        die("could not read %s: %s" % (what, path), str(e), fix)


def parse_points(text):
    out = []
    for pair in text.split():
        x, y = pair.split(",")
        out.append((float(x), float(y)))
    return out


class Graph:
    """Undirected graph with vertices at rounded plan coordinates."""

    def __init__(self):
        self.index = {}      # (x, y) -> vertex id
        self.xy = []         # vertex id -> (x, y)
        self.adj = []        # vertex id -> set of neighbor ids

    def vertex(self, p):
        key = (round(p[0] * SCALE) / SCALE, round(p[1] * SCALE) / SCALE)
        v = self.index.get(key)
        if v is None:
            v = len(self.xy)
            self.index[key] = v
            self.xy.append(key)
            self.adj.append(set())
        return v

    def edge(self, a, b):
        if a != b:
            self.adj[a].add(b)
            self.adj[b].add(a)

    def dist(self, a, b):
        return math.dist(self.xy[a], self.xy[b])

    def nearest(self, p):
        best, best_d = None, float("inf")
        for v, q in enumerate(self.xy):
            d = math.dist(p, q)
            if d < best_d:
                best, best_d = v, d
        return best, best_d

    def edge_count(self):
        return sum(len(n) for n in self.adj) // 2


def build_layer(routes, rooms, width, height):
    """Graph of one floor plus the vertex of each program room. Returns (graph, room_vertex, notes)."""
    g = Graph()
    spur_ends = {}
    for r in routes:
        pts = parse_points(r["points"])
        ids = [g.vertex(p) for p in pts]
        for a, b in zip(ids, ids[1:]):
            g.edge(a, b)
        if r.get("endpoint") and not r.get("connect"):
            spur_ends[r["endpoint"]] = (ids[0], ids[-1])
    room_vertex, notes = {}, []
    for room in rooms:
        at = (room["x"] * width, room["y"] * height)
        ends = spur_ends.get(room["id"])
        if ends:
            # the room end of a spur is the end nearer to the room; for a large hall that is its door
            v = min(ends, key=lambda e: math.dist(g.xy[e], at))
            room_vertex[room["id"]] = v
            d = math.dist(g.xy[v], at)
            if d > SPUR_TOLERANCE:
                notes.append("%s: its spur starts at a door %.0f units from the room's pin" % (room["n"], d))
            continue
        v, d = g.nearest(at)
        if v is None or d > SNAP_LIMIT:
            notes.append("%s: no path vertex within %d units, it gets no route" % (room["n"], SNAP_LIMIT))
            continue
        room_vertex[room["id"]] = v
        notes.append("%s: no spur of its own, snapped to the nearest vertex %.1f units away" % (room["n"], d))
    return g, room_vertex, notes


def simplify(g, keep):
    """Drop dead ends that reach no kept vertex and vertices inside straight runs. Returns (xy, edges, old->new)."""
    adj = [set(n) for n in g.adj]
    alive = [True] * len(adj)
    stack = [v for v in range(len(adj)) if len(adj[v]) <= 1 and v not in keep]
    while stack:
        v = stack.pop()
        if not alive[v] or v in keep or len(adj[v]) > 1:
            continue
        alive[v] = False
        for n in adj[v]:
            adj[n].discard(v)
            if len(adj[n]) <= 1 and n not in keep:
                stack.append(n)
        adj[v] = set()
    for v in range(len(adj)):
        if not alive[v] or v in keep or len(adj[v]) != 2:
            continue
        a, b = adj[v]
        (ax, ay), (vx, vy), (bx, by) = g.xy[a], g.xy[v], g.xy[b]
        cross = (vx - ax) * (by - ay) - (vy - ay) * (bx - ax)
        along = (vx - ax) * (bx - vx) + (vy - ay) * (by - vy)
        if abs(cross) <= 0.05 * max(1.0, math.dist((ax, ay), (bx, by))) and along >= 0 and b not in adj[a]:
            alive[v] = False
            adj[a].discard(v)
            adj[b].discard(v)
            adj[a].add(b)
            adj[b].add(a)
            adj[v] = set()
    remap, xy = {}, []
    for v in range(len(adj)):
        if alive[v] and (adj[v] or v in keep):
            remap[v] = len(xy)
            xy.append(g.xy[v])
    edges = sorted({(min(remap[a], remap[b]), max(remap[a], remap[b])) for a in remap for b in adj[a]})
    return xy, edges, remap


def shortest(xy, nbrs, src):
    """Dijkstra from one vertex: distance to every vertex (inf when unreachable)."""
    dist = [float("inf")] * len(xy)
    dist[src] = 0.0
    heap = [(0.0, src)]
    while heap:
        d, v = heapq.heappop(heap)
        if d > dist[v]:
            continue
        for n in nbrs[v]:
            nd = d + math.dist(xy[v], xy[n])
            if nd < dist[n]:
                dist[n] = nd
                heapq.heappush(heap, (nd, n))
    return dist


def verify_layer(layer_id, packed, rooms, width, height):
    """Route every pair of rooms from the packed data. Returns (reachable pairs, all pairs, groups, problems)."""
    xy = [(packed["n"][i] / SCALE, packed["n"][i + 1] / SCALE) for i in range(0, len(packed["n"]), 2)]
    nbrs = [[] for _ in xy]
    for i in range(0, len(packed["e"]), 2):
        a, b = packed["e"][i], packed["e"][i + 1]
        nbrs[a].append(b)
        nbrs[b].append(a)
    problems = []
    have = [r for r in rooms if r["id"] in packed["r"]]
    reach = total = 0
    group_of, groups = {}, []
    for i, a in enumerate(have):
        dist = shortest(xy, nbrs, packed["r"][a["id"]])
        if a["id"] not in group_of:
            group_of[a["id"]] = len(groups)
            groups.append([a["n"]])
        for b in have[i + 1:]:
            total += 1
            d = dist[packed["r"][b["id"]]]
            if d == float("inf"):
                continue
            reach += 1
            if b["id"] not in group_of:
                group_of[b["id"]] = group_of[a["id"]]
                groups[group_of[a["id"]]].append(b["n"])
            straight = math.dist((a["x"] * width, a["y"] * height), (b["x"] * width, b["y"] * height))
            if d + 2 * SNAP_LIMIT < straight:
                problems.append("%s: path %s -> %s is shorter (%.0f) than the straight line (%.0f)" % (layer_id, a["n"], b["n"], d, straight))
    for x, y in xy:
        if not (-1 <= x <= width + 1 and -1 <= y <= height + 1):
            problems.append("%s: vertex %.1f,%.1f lies outside the %dx%d plan" % (layer_id, x, y, width, height))
            break
    return reach, total, groups, problems


def main():
    if any(a in HELP_WORDS for a in sys.argv[1:]):
        print(__doc__.strip())
        return 0
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter, add_help=False)
    ap.add_argument("--map", default=os.path.join(here, "data", "raw", "mapdata.json"))
    ap.add_argument("--core", default=os.path.join(here, "app", "web", "www", "data", "core.json"))
    ap.add_argument("--out", default=os.path.join(here, "app", "web", "www", "data", "routes.json"))
    ap.add_argument("--dry-run", "-n", action="store_true")
    try:
        a, extra = ap.parse_known_args()
    except SystemExit:
        die("bad arguments", "Run with --help to see the options.")
    if extra:
        print(__doc__.strip().split("\n\n")[1], file=sys.stderr)
        die("unknown argument: " + " ".join(extra), "Run with --help to see the options.")

    print("1. Read inputs")
    mapdata = load_json(a.map, "map export", "It is cached by scraper/fetch.py as data/raw/mapdata.json; pass its path with --map.")
    core = load_json(a.core, "app data bundle", "Build it first with scraper/analyze.py, or pass its path with --core.")
    routes = mapdata.get("routes") if isinstance(mapdata, dict) else None
    if not routes:
        die("the map export has no \"routes\" list: " + a.map)
    rooms, layers = core.get("rooms") or [], core.get("layers") or []
    if not rooms or not layers:
        die("the app data bundle has no rooms or layers: " + a.core)
    ok("%d route polylines, %d program rooms, %d floor plans" % (len(routes), len(rooms), len(layers)))

    print("2. Build one graph per floor")
    out = {"v": 1, "scale": SCALE, "layers": {}}
    per_layer = {}
    for layer in layers:
        lid = layer["id"]
        lrooms = [r for r in rooms if r.get("l") == lid]
        lroutes = [r for r in routes if r.get("layer") == lid and r.get("element") == "polyline" and r.get("points")]
        if not lrooms:
            continue
        if not lroutes:
            bad("%s: %d rooms but no route polylines, no routes on this floor" % (lid, len(lrooms)))
            continue
        try:
            g, room_vertex, notes = build_layer(lroutes, lrooms, layer["w"], layer["h"])
        except (ValueError, KeyError) as e:
            die("could not read the route polylines of floor " + lid, repr(e))
        xy, edges, remap = simplify(g, set(room_vertex.values()))
        packed = {
            "n": [int(round(c * SCALE)) for p in xy for c in p],
            "e": [v for e in edges for v in e],
            "r": {rid: remap[v] for rid, v in sorted(room_vertex.items())},
        }
        out["layers"][lid] = packed
        per_layer[lid] = (layer, lrooms)
        ok("%s: %d polylines -> %d vertices, %d edges (from %d and %d); %d of %d rooms attached" % (
            lid, len(lroutes), len(xy), len(edges), len(g.xy), g.edge_count(), len(room_vertex), len(lrooms)))
        for n in notes:
            print("      note: " + n)

    print("3. Check: route every pair of rooms on each floor")
    text = json.dumps(out, separators=(",", ":"), sort_keys=True)
    packed_back = json.loads(text)
    failed = 0
    for lid, (layer, lrooms) in per_layer.items():
        reach, total, groups, problems = verify_layer(lid, packed_back["layers"][lid], lrooms, layer["w"], layer["h"])
        for p in problems:
            failed += 1
            bad(p)
        missing = len(lrooms) - len(packed_back["layers"][lid]["r"])
        if missing:
            failed += 1
            bad("%s: %d rooms have no vertex" % (lid, missing))
        line = "%s: %d of %d room pairs have a path" % (lid, reach, total)
        if len(groups) > 1:
            line += "; the floor is split into %d separate parts (%s). Pairs across parts get the straight dashed line." % (
                len(groups), ", ".join("%d rooms around %s" % (len(grp), grp[0]) for grp in groups))
        if not problems and not missing:
            ok(line)
        else:
            bad(line)

    print("4. Write")
    if a.dry_run:
        print("  dry run: %d bytes for %d floors would go to %s" % (len(text), len(out["layers"]), a.out))
        print("  Nothing was written.")
        return 2 if failed else 0
    try:
        os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
        with open(a.out, "w", encoding="utf-8") as f:
            f.write(text)
    except OSError as e:
        die("could not write " + a.out, str(e), "Check that the folder exists and is writable.")
    size = os.path.getsize(a.out)
    with open(a.out, encoding="utf-8") as f:
        same = json.load(f) == out
    if same:
        ok("wrote %s (%d bytes, %d floors)" % (a.out, size, len(out["layers"])))
    else:
        failed += 1
        bad("the file on disk does not match what was built: " + a.out)
    if failed:
        print("Finished with %d failed check(s). The file was written; read the lines marked ✗ above." % failed, file=sys.stderr)
        return 2
    print("Done. The map view loads data/routes.json on its own; check it with: node app/web/tests/test_map.mjs")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\ninterrupted. Nothing more was written.", file=sys.stderr)
        sys.exit(130)
