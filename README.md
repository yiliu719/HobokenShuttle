# Hoboken Shuttle

## Shuttle schedules (`data/schedules.json`, version 2)

Top level: `version` (2), `updated`, `disclaimer`, `buildings[]`. Each building has `id`, `name`, `source`,
`rideMinutes`, `vehicles` (`{id: {"label": ...}}`), `notices[]` (`{days, text}`) and `services[]`.
A service is `{direction: "to_path"|"from_path", from, days: [mon..sat], departures: [{time: "HH:MM", vehicle}]}`.

- **Everything is per building.** `vehicles` and `rideMinutes` live on the building, and vehicle IDs are scoped to it:
  Cast Iron's `bus1` and Soho's `bus1` are different vehicles that share a label. Never look a vehicle up globally;
  resolve `departure.vehicle` in the `vehicles` map of the building that owns the departure.
- **`vehicle` may be `null`** (e.g. Cast Iron's Thu/Fri late runs from PATH). Show no vehicle tag in that case.
- Check edits with `python3 scripts/validate_schedules.py` (non-zero exit on any problem).
- Services only list Mon–Sat; Sunday service, where any, is described in `notices` (e.g. Soho's on-call Sunday).

## Updating PATH train times (`data/path.json`)

```bash
python3 scripts/build_path.py
```

Python 3.8+, standard library only. The script fetches two files from panynj.gov
(the weekday and weekend schedule pages' `.model.json`, 2 s apart, with an honest
User-Agent), parses the Hoboken tables, rewrites `data/path.json` and prints a
summary (counts, first/last trains, peak headways, flags).

- Re-run whenever PATH announces a schedule change; check `sources[].effectiveDate`/`modelDate` in the output.
- It exits non-zero without touching the file if a table is missing or a row count drops
  more than 30% below the `EXPECTED` constants in the script. If PATH legitimately changes
  service, update `EXPECTED` after reviewing the new numbers.
- `holidays` (dates that run the Sunday schedule) is maintained by hand and preserved across runs.
- Times are calendar-day `HH:MM`; lookups near midnight must also check the next day's table.

## UI notes

- **After the last direct WTC train.** `lastDirectWTC` in `data/path.json` gives the last Hoboken→World Trade Center
  departure per day type (computed by the script, so it follows schedule changes). On the To PATH screen, once the
  selected time is past that value, show: "No direct WTC trains after <time> — check PATH for options", linking to
  PATH's official trip planner: https://www.panynj.gov/path/en/trip-planner.html. No routing advice from us.
- **Midnight.** Times are calendar-day; when looking up trains near midnight, also check the next day's table.
