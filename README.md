# Hoboken Shuttle

**When's the next shuttle, and will it get me to my train?** A lightweight, mobile-first web app for residents of Cast Iron Lofts and Soho Lofts in Hoboken, NJ, connecting each building's private shuttle schedule with PATH train times at Hoboken Terminal.

> **Status:** data layer and UI complete; not yet deployed. Live site link coming soon.

<!-- Add a screenshot once the UI ships: ![Hoboken Shuttle on mobile](docs/screenshot.png) -->

---

## The problem

Both buildings run free shuttles to the Hoboken PATH station, but their schedules live on printed sheets in the lobby and a PDF passed around by email. Every bus has a different timetable by day of the week, and none of them tell you the thing riders actually care about: *if I take this shuttle, which train do I catch?* Coming home is the same problem in reverse: *my train gets in at 6:24, how long will I wait?*

## What it does

- **To PATH:** shows your next shuttle (posted, or estimated and marked ≈), when it reaches the station, and which trains to 33rd St and World Trade Center you can still make.
- **Home from PATH:** pick your arriving train and see which shuttle you'll catch, your wait, and when you'll be home.
- **Long gaps:** when the next departure (posted or estimated) is more than `GAP_THRESHOLD_MIN` away, or on a later day, the hero leads with the gap and shows no countdown: "No shuttle to PATH until ≈ 5:40 PM", or "No more shuttles to PATH today" / "No more shuttles from PATH tonight" followed by "Next: Tomorrow ≈ 6:10 AM". On a day with no service the headline names the day ("No shuttle from PATH on Sunday"). `heroFrame()` in `js/logic.js` decides this.
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
| **Estimate unposted return trips** | Shuttles run continuous loops, but each posted sheet lists only one end: morning sheets list departures from the building, evening sheets list departures from PATH. Without estimates the app wrongly showed no service (for example, no shuttle to PATH on a Saturday afternoon, or none from PATH at 9 AM). The app now derives the return trip of every posted run, `loopMinutes` later, and marks it with **≈** and a lighter style everywhere it appears. Assumption: the last evening run from PATH does not return to PATH. Estimates are computed in code and never written to `schedules.json`. |
| **Data quality is enforced, not hoped for** | Schedules are edited by hand, so a validator blocks bad data, and the PATH script refuses to overwrite good data if PATH's page structure changes. |

## How it works

```
index.html, styles.css, app.js   the app (state, rendering, routing)
js/time.js                       New York clock, ?now= parsing, date math
js/logic.js                      pure schedule logic (next shuttle, connections, tabs)
tests.html                       in-browser logic tests (open it while serving the repo)
data/
  schedules.json    shuttle timetables, per building (hand-maintained)
  path.json         Hoboken PATH departures and arrivals (generated)
scripts/
  build_path.py         fetches and parses PATH schedules → path.json
  validate_schedules.py checks schedules.json before it ships
```

Run locally (the app uses `fetch`, so it needs a server, not `file://`):

```bash
python3 -m http.server 8080   # then open http://localhost:8080
```

Add `?now=2026-10-09T18:12` (New York time) to freeze the clock for testing, and `&mode=to` or `&mode=home` to force a screen. Open `/tests.html` to run the logic tests; it shows a pass/fail summary.

Tunable constants live at the top of `js/logic.js`: `PLATFORM_BUFFER_MIN` (2), `HOME_WALK_MIN` (3), `TIGHT_MAX_MIN` (3), `GAP_THRESHOLD_MIN` (60).

Plain HTML/CSS/JS, hosted on Cloudflare Pages. Python scripts use the standard library only.

## Data

### Shuttle schedules (`data/schedules.json`, version 3)

Transcribed from each building's posted schedules. Everything is scoped per building: each building has its own `vehicles`, `rideMinutes` (ride from one end to the other, currently 10), `loopMinutes` (see below, currently 10), `services` (direction, days, departures), and `notices` (e.g. Soho's on-call Sunday service).

- Vehicle IDs are building-scoped: Cast Iron's `bus1` and Soho's `bus1` are different vehicles. Always resolve a departure's vehicle through its own building.
- `vehicle` may be `null` when the posted schedule doesn't say (e.g. Cast Iron's Thu/Fri late runs). Show no vehicle chip in that case; its estimated returns are also `null`.
- `loopMinutes` (integer 1–60): minutes from a departure at one end to the same vehicle's departure from the other end. It is separate from `rideMinutes` so the two can be tuned independently.

**Estimated return trips** (`js/logic.js`, `departuresForKey`). The JSON holds only posted departures. For each date the app derives the rest:

1. Every posted departure gets an estimated departure in the opposite direction at `time + loopMinutes`, same vehicle (`null` stays `null`), same date. Posted `to_path` → estimated `from_path`; posted `from_path` → estimated `to_path`.
2. Exception: the last posted `from_path` departure of each date (the last evening run, computed after merging services) has no estimated return to PATH. Cast Iron Mon uses 21:00, Fri 23:00; Soho Mon–Wed uses 20:50.
3. Morning runs keep their estimated returns from PATH, including the last one.
4. If an estimate lands on a posted departure at the same time and direction, only the posted one is kept.
5. Every departure object carries `estimated: true|false`. The UI shows estimates with a **≈** prefix and a lighter style, and hides them in the full schedule unless "Include estimated trips" is on.

The validator fails if any derived estimated time would pass 23:59.

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
- [x] Mobile UI (To PATH, Home from PATH, Full schedule)
- [ ] Deploy to Cloudflare Pages, add-to-home-screen support
- [ ] Live PATH arrival times
- [ ] More buildings

## Disclaimer

An independent resident project, not affiliated with PATH, the Port Authority of NY & NJ, or building management. All times are estimates; traffic and weather affect shuttle service. Check posted schedules when in doubt.

Found a wrong time or want your building added? Use the Feedback link in the app.
