#!/usr/bin/env python3
"""Build data/path.json (Hoboken PATH departures/arrivals) from panynj.gov schedule pages.

The pages are Adobe Experience Manager sites; each page's .model.json contains the
timetables as HTML <table> strings. Stdlib only. Exits non-zero if the structure changed.
"""
import html, json, re, statistics, sys, time, urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://www.panynj.gov/content/path/en/"
PAGES = {"weekday": "schedules-maps/weekday-schedules.model.json",
         "weekend": "schedules-maps/weekend-schedules.model.json"}
UA = "hoboken-shuttle/1.0 (+https://github.com/yiliu719/hoboken-shuttle)"
OUT = Path(__file__).resolve().parent.parent / "data" / "path.json"
CHANGES_URL = "https://www.panynj.gov/path/en/planned-service-changes.html"

# table label (parens stripped) -> (kind, other end, route label). Direct routes first so
# they win de-duplication against the late-night via-Hoboken trains.
TABLES = {
    "Hoboken - 33 Street": ("dep", "33rd St"),
    "Hoboken - World Trade Center": ("dep", "World Trade Center"),
    "Journal Square - 33 Street via Hoboken": ("dep", "33rd St"),
    "33 Street - Hoboken": ("arr", "33rd St"),
    "World Trade Center - Hoboken": ("arr", "World Trade Center"),
    "33 Street - Journal Square via Hoboken": ("arr", "33rd St"),  # Hoboken *departure* time
}
# Row counts seen on 2026-10-02, in TABLES order; a >30% drop is treated as a parse failure.
EXPECTED = {"weekday": [94, 96, 14, 95, 96, 16],
            "saturday": [69, 34, 29, 67, 34, 32], "sunday": [69, 34, 29, 67, 34, 32]}
NOTES = [
    "Times are calendar-day HH:MM (00:00-23:59) under each table's own day type; "
    "after-midnight trains are in the table of the day they run on.",
    "Lookups near midnight must also check the next day's table (e.g. Sunday 23:50 -> Monday's weekday table).",
    "Arrivals for 'via Hoboken' late-night trains from 33rd St use the Hoboken departure time (approximation).",
    "Holidays listed in 'holidays' run the Sunday schedule (maintained by hand).",
]

def die(msg):
    sys.exit("ERROR: " + msg)

def clean(s):
    return html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s))).strip()

def fetch(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60) as r:
            return json.load(r)
    except Exception as e:
        die("could not fetch %s: %s" % (url, e))

def walk(node):
    """Yield components under node in page order (uses :itemsOrder; never :children)."""
    yield node
    for k in node.get(":itemsOrder", []):
        yield from walk(node[":items"][k])

def parse_table(markup):
    rows = [[clean(c) for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", r, re.S)]
            for r in re.findall(r"<tr[^>]*>(.*?)</tr>", markup, re.S)]
    rows = [r for r in rows if r]
    return rows[0], rows[1:]

def to_24h(cell):
    m = re.fullmatch(r"(\d{1,2}):(\d\d) ([AP])M", cell)
    if not m:
        die("unparseable time cell %r" % cell)
    return "%02d:%s" % (int(m[1]) % 12 + (12 if m[3] == "P" else 0), m[2])

def extract(model):
    """Return ({day: {label: (rows)}}, effective date or None) from one page model."""
    root = model[":items"]["root"]
    days, effective = {}, None
    for comp in walk(root):
        m = re.search(r"Effective\s+(\w+ \d{1,2}, \d{4})", clean(comp.get("text", "")) if comp.get("text") else "")
        if m and not effective:
            effective = datetime.strptime(m[1], "%B %d, %Y").date().isoformat()
        if not comp.get(":type", "").endswith("AccordionList"):
            continue
        title = clean(comp.get("title", "")).lower()
        day = "saturday" if title.startswith("saturday") else "sunday" if title.startswith("sunday") else "weekday"
        for acc in walk(comp):
            if not acc.get(":type", "").endswith("Accordion"):
                continue
            label = clean(acc["accordionLabel"]).replace("(", "").replace(")", "")
            markup = [c["text"] for c in walk(acc) if "<table" in (c.get("text") or "")]
            if label in TABLES and markup:
                days.setdefault(day, {})[label] = parse_table(markup[0])
    return days, effective

def build_day(day, tables):
    deps, arrs, seen = [], [], set()
    for (label, (kind, other)), expected in zip(TABLES.items(), EXPECTED[day]):
        if label not in tables:
            die("%s: table %r not found" % (day, label))
        header, rows = tables[label]
        if len(rows) < expected * 0.7:
            die("%s / %s: %d rows, expected about %d" % (day, label, len(rows), expected))
        col = next((i for i, h in enumerate(header) if "Hoboken" in h), None)
        if col is None or any(len(r) != len(header) for r in rows):
            die("%s / %s: unexpected table layout %s" % (day, label, header))
        for r in rows:
            if r[col] == "---":
                continue
            t = to_24h(r[col])
            if (kind, t, other) in seen:
                continue
            seen.add((kind, t, other))
            (deps if kind == "dep" else arrs).append(
                {"time": t, "to" if kind == "dep" else "from": other, "route": label})
    key = lambda e: e["time"]
    return {"departures": sorted(deps, key=key), "arrivals": sorted(arrs, key=key)}

def fmt(o, ind=0):
    """Compact JSON: one entry per line for lists, one key per line for objects."""
    pad, pad2 = "  " * ind, "  " * (ind + 1)
    if isinstance(o, dict):
        return "{\n" + ",\n".join('%s%s: %s' % (pad2, json.dumps(k), fmt(v, ind + 1)) for k, v in o.items()) + "\n" + pad + "}"
    if isinstance(o, list) and o:
        return "[\n" + ",\n".join(pad2 + json.dumps(x, separators=(",", ":")) for x in o) + "\n" + pad + "]"
    return json.dumps(o)

def mins(t):
    return int(t[:2]) * 60 + int(t[3:])

def summarize(service_days):
    warn = []
    for day, d in service_days.items():
        for kind, field in (("departures", "to"), ("arrivals", "from")):
            for other in ("33rd St", "World Trade Center"):
                ts = [e["time"] for e in d[kind] if e[field] == other]
                gaps = [mins(b) - mins(a) for a, b in zip(ts, ts[1:]) if "06:00" <= a and b <= "22:00"]
                night = sum(t < "05:00" for t in ts)
                print("%-8s %-10s %-18s n=%3d first=%s last=%s 00:00-04:59=%d" %
                      (day, kind, other, len(ts), ts[0] if ts else "-", ts[-1] if ts else "-", night))
                if not ts:
                    warn.append("%s %s %s: zero trains" % (day, kind, other))
                if gaps and max(gaps) > 60:
                    warn.append("%s %s %s: daytime gap of %d min" % (day, kind, other, max(gaps)))
                if day == "weekday" and kind == "departures":
                    peak = [mins(b) - mins(a) for a, b in zip(ts, ts[1:])
                            if ("07:00" <= a and b <= "10:00") or ("16:00" <= a and b <= "19:00")]
                    print("         weekday peak headway to %s: median %s min" % (other, statistics.median(peak) if peak else "n/a"))
    print("\nFlags:" if warn else "\nNo flags.")
    for w in warn:
        print("  - " + w)

def main():
    service_days, sources = {}, []
    for i, (name, path) in enumerate(PAGES.items()):
        if i:
            time.sleep(2)
        model = fetch(BASE + path)
        days, effective = extract(model)
        for day, tables in days.items():
            service_days[day] = build_day(day, tables)
        sources.append({"url": BASE + path, "effectiveDate": effective, "modelDate": model.get("date")})
    missing = [d for d in EXPECTED if d not in service_days]
    if missing:
        die("no tables for: " + ", ".join(missing))
    try:  # holidays are maintained by hand; keep them across re-runs
        holidays = json.loads(OUT.read_text()).get("holidays", [])
    except (OSError, ValueError):
        holidays = []
    out = {"generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "sources": sources, "serviceChangesUrl": CHANGES_URL, "station": "Hoboken",
           "timeNote": "HH:MM calendar-day time, 00:00-23:59",
           "lastDirectWTC": {d: max((e["time"] for e in sd["departures"] if e["to"] == "World Trade Center"), default=None)
                             for d, sd in service_days.items()},
           "notes": NOTES,
           "serviceDays": {d: service_days[d] for d in ("weekday", "saturday", "sunday")},
           "holidays": holidays, "exceptions": []}
    OUT.write_text(fmt(out) + "\n")
    print("wrote %s (%d bytes)\n" % (OUT, OUT.stat().st_size))
    summarize(out["serviceDays"])

if __name__ == "__main__":
    main()
