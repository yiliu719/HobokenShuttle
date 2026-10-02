#!/usr/bin/env python3
"""Validate data/schedules.json (version 3). Stdlib only; exits non-zero on any problem."""
import json, re, sys
from pathlib import Path

PATH = Path(__file__).resolve().parent.parent / "data" / "schedules.json"
TIME = re.compile(r"([01]\d|2[0-3]):[0-5]\d")
DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
VERSION = 3

def minutes(t):
    return int(t[:2]) * 60 + int(t[3:])

def derived_estimates(building, key, loop):
    """Posted times (per direction) that produce an estimated return, mirroring js/logic.js:
    every posted departure returns at +loop, except the last from_path departure of the date."""
    def merged(direction):
        return sorted({d["time"] for s in building.get("services", []) if s.get("direction") == direction
                       and key in s.get("days", []) for d in s.get("departures", [])
                       if isinstance(d.get("time"), str) and TIME.fullmatch(d["time"])})
    to_path, from_path = merged("to_path"), merged("from_path")
    sources = [("to_path", t) for t in to_path] + [("from_path", t) for t in from_path[:-1]]
    return [(d, t, minutes(t) + loop) for d, t in sources]

def validate(data):
    errors = []
    if data.get("version") != VERSION:
        errors.append("version is %r, expected %d" % (data.get("version"), VERSION))
    for old in ("vehicles", "rideMinutes"):
        if old in data:
            errors.append("top-level %r is not allowed (it is per building)" % old)
    for b in data.get("buildings", []):
        bid = b.get("id", "?")
        vehicles = b.get("vehicles")
        if not isinstance(vehicles, dict):  # may be empty: buildings that post no vehicle names use {} and null vehicles
            errors.append("%s: missing 'vehicles' map" % bid)
            vehicles = {}
        if not isinstance(b.get("rideMinutes"), int):
            errors.append("%s: missing or non-integer 'rideMinutes'" % bid)
        loop = b.get("loopMinutes")
        if not isinstance(loop, int) or isinstance(loop, bool) or not 1 <= loop <= 60:
            errors.append("%s: 'loopMinutes' must be an integer from 1 to 60, got %r" % (bid, loop))
        else:
            for key in DAYS:
                for direction, t, est in derived_estimates(b, key, loop):
                    if est > 23 * 60 + 59:
                        errors.append("%s %s: estimated return for posted %s %s would pass 23:59 (%02d:%02d)"
                                      % (bid, key, direction, t, est // 60, est % 60))
        for i, svc in enumerate(b.get("services", [])):
            where = "%s service #%d (%s from %s)" % (bid, i, svc.get("direction"), svc.get("from"))
            times = []
            for dep in svc.get("departures", []):
                t, v = dep.get("time"), dep.get("vehicle")
                if not isinstance(t, str) or not TIME.fullmatch(t):
                    errors.append("%s: bad time %r" % (where, t))
                else:
                    times.append(t)
                if v is not None and v not in vehicles:
                    errors.append("%s: vehicle %r at %s is not in %s's vehicles %s" % (where, v, t, bid, sorted(vehicles)))
            if times != sorted(times):
                bad = next(y for x, y in zip(times, times[1:]) if y < x)
                errors.append("%s: departures not sorted (%s comes after a later time)" % (where, bad))
    return errors

def main():
    data = json.loads(PATH.read_text())
    errors = validate(data)
    for e in errors:
        print("ERROR: " + e, file=sys.stderr)
    if errors:
        sys.exit("%d problem(s) in %s" % (len(errors), PATH))
    for b in data["buildings"]:
        n = sum(len(s["departures"]) for s in b["services"])
        nulls = sum(d["vehicle"] is None for s in b["services"] for d in s["departures"])
        print("%-12s ok: %d services, %d departures, %d null vehicle, rideMinutes=%d, loopMinutes=%d, vehicles=%s"
              % (b["id"], len(b["services"]), n, nulls, b["rideMinutes"], b["loopMinutes"], sorted(b["vehicles"])))
    print("schedules.json valid (version %d)" % data["version"])

if __name__ == "__main__":
    main()
