# Hoboken Shuttle

**Live: [hoboken-shuttle.pages.dev](https://hoboken-shuttle.pages.dev)**

When's the next shuttle to PATH, and which train will I make? A simple mobile site for residents of Cast Iron Lofts and Soho Lofts in Jersey City, NJ.

## Features

- Next shuttle to PATH, with the trains you can still catch
- Next shuttle home, based on when your train arrives
- Full schedule for each building

Times marked **≈** are estimated from each shuttle's loop, since the posted schedules only list one direction.

## Feedback

Found a wrong time, or want your building added? Use the "Add your building / Report a wrong time" link at the bottom of the site.

## For developers

Plain HTML, CSS, and JavaScript, hosted on Cloudflare Pages.

- Shuttle schedules: edit `data/schedules.json`, then run `python3 scripts/validate_schedules.py`
- PATH train times: run `python3 scripts/build_path.py` to refresh `data/path.json`
- Tests: open `tests.html` in a browser

---

Independent resident project, not affiliated with PATH or building management. All times are estimates.
