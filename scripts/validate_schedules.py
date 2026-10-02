#!/usr/bin/env python3
"""Validate data/schedules.json (version 2). Stdlib only; exits non-zero on any problem."""
import json, re, sys
from pathlib import Path

PATH = Path(__file__).resolve().parent.parent / "data" / "schedules.json"
TIME = re.compile(r"([01]\d|2[0-3]):[0-5]\d")

def validate(data):
    errors = []
    if data.get("version") != 2:
        errors.append("version is %r, expected 2" % data.get("version"))
    for old in ("vehicles", "rideMinutes"):
        if old in data:
            errors.append("top-level %r is not allowed in v2 (it is per building)" % old)
    for b in data.get("buildings", []):
        bid = b.get("id", "?")
        vehicles = b.get("vehicles")
        if not isinstance(vehicles, dict) or not vehicles:
            errors.append("%s: missing or empty 'vehicles'" % bid)
            vehicles = {}
        if not isinstance(b.get("rideMinutes"), int):
            errors.append("%s: missing or non-integer 'rideMinutes'" % bid)
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
        print("%-12s ok: %d services, %d departures, %d null vehicle, rideMinutes=%d, vehicles=%s"
              % (b["id"], len(b["services"]), n, nulls, b["rideMinutes"], sorted(b["vehicles"])))
    print("schedules.json valid (version %d)" % data["version"])

if __name__ == "__main__":
    main()
