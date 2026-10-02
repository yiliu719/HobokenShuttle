# Hoboken Shuttle

**When's the next shuttle, and will it get me to my train?** A lightweight, mobile-first web app for residents of Cast Iron Lofts and Soho Lofts in Hoboken, NJ, connecting each building's private shuttle schedule with PATH train times at Hoboken Terminal.

> **Status:** data layer complete; UI in progress. Live site link coming soon.

<!-- Add a screenshot once the UI ships: ![Hoboken Shuttle on mobile](docs/screenshot.png) -->

---

## The problem

Both buildings run free shuttles to the Hoboken PATH station, but their schedules live on printed sheets in the lobby and a PDF passed around by email. Every bus has a different timetable by day of the week, and none of them tell you the thing riders actually care about: *if I take this shuttle, which train do I catch?* Coming home is the same problem in reverse: *my train gets in at 6:24, how long will I wait?*

## What it does

- **To PATH:** shows your next shuttle, when it reaches the station, and which trains to 33rd St and World Trade Center you can still make.
- **Home from PATH:** pick your arriving train and see which shuttle you'll catch, your wait, and when you'll be home.
- **Full schedule:** each building's complete timetable by day type, with past departures dimmed.

Built for one-handed use on the way out the door: the answer is on screen without tapping anything, and it can be added to your phone's home screen like an app.

## Product decisions

| Decision | Why |
|---|---|
| **Static site, not Streamlit or a backend** | Riders check this on a phone in a lobby. It needs to load instantly, cost $0, and never cold-start. |
| **Mobile-first, centered column on desktop** | Nearly all use is on a phone. A separate desktop layout waits until analytics show demand. |
| **PATH times from PATH's own website, not GTFS** | The public GTFS feed for PATH had expired (service dates ended June 2026). PATH's schedule pages are current (effective May 18, 2026) and load from structured JSON, so a small script can pull them directly. |
| **Live shuttle tracking is out of scope** | The GPS feed belongs to the shuttle operator. Integrating it needs a data-sharing agreement, not code. Revisit once usage gives leverage to ask. |
| **No routing advice** | After the last direct Hoboken→WTC train, the app says so and links to PATH's trip planner instead of guessing at transfers. |
| **Data quality is enforced, not hoped for** | Schedules are edited by hand, so a validator blocks bad data, and the PATH script refuses to overwrite good data if PATH's page structure changes. |

## How it works

```
data/
  schedules.json    shuttle timetables, per building (hand-maintained)
  path.json         Hoboken PATH departures and arrivals (generated)
scripts/
  build_path.py         fetches and parses PATH schedules → path.json
  validate_schedules.py checks schedules.json before it ships
```

Plain HTML/CSS/JS, hosted on Cloudflare Pages. Python scripts use the standard library only.

## Data

### Shuttle schedules (`data/schedules.json`, version 2)

Transcribed from each building's posted schedules. Everything is scoped per building: each building has its own `vehicles`, `rideMinutes` (estimated ride to the station, currently 10), `services` (direction, days, departures), and `notices` (e.g. Soho's on-call Sunday service).

- Vehicle IDs are building-scoped: Cast Iron's `bus1` and Soho's `bus1` are different vehicles. Always resolve a departure's vehicle through its own building.
- `vehicle` may be `null` when the posted schedule doesn't say (e.g. Cast Iron's Thu/Fri late runs).

After any edit:

```bash
python3 scripts/validate_schedules.py
```

### PATH train times (`data/path.json`)

```bash
python3 scripts/build_path.py
```

Fetches PATH's weekday and weekend schedule data from panynj.gov (two requests, rate-limited, honest User-Agent), extracts Hoboken service to and from 33rd St and WTC (including late-night trains via Hoboken), and prints a sanity summary. Re-run when PATH announces a schedule change.

- Exits without touching the file if a table is missing or row counts drop more than 30%.
- `holidays` (dates on the Sunday schedule) is hand-maintained and preserved across runs.
- Times are calendar-day `HH:MM`. Lookups near midnight must also check the next day's table.
- `lastDirectWTC` gives the last direct Hoboken→WTC departure per day type. After it, the UI shows "No direct WTC trains after `<time>` — check PATH for options" with a link to the [PATH trip planner](https://www.panynj.gov/path/en/trip-planner.html).

## Roadmap

- [x] Shuttle schedule data + validator
- [x] PATH timetable pipeline
- [ ] Mobile UI (To PATH, Home from PATH, Full schedule)
- [ ] Deploy to Cloudflare Pages, add-to-home-screen support
- [ ] Live PATH arrival times
- [ ] More buildings

## Disclaimer

An independent resident project, not affiliated with PATH, the Port Authority of NY & NJ, or building management. All times are estimates; traffic and weather affect shuttle service. Check posted schedules when in doubt.
