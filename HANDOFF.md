# Handoff (2026-11-16)

Read `ROADMAP.md` (what is built, how to add a layer) and `SETUP_NOTES.md`
(how to start everything) first. This file is only the state of play.

## State

- Branch: `feat/chokepoint-monitor`, 7 commits ahead of `main`, working tree
  clean. **Not merged, not pushed.** `main` is 2 commits ahead of
  `origin/main` (Node pin, roadmap), also not pushed.
- `.env` holds the three keys and is gitignored. No key is in any commit.

## Done

- Phase 1: fork `bradenlocsin/gods-eye-view` (`origin`), `upstream` remote,
  Node 26 pinned, keys in `.env`, app runs at http://localhost:4173.
- Phase 2: `gods-eye-view` MCP server registered in Claude Code and Claude
  Desktop. World Monitor unregistered by the user's choice (optional later).
- Phase 3: `ROADMAP.md`, approved.
- Phase 4, chokepoint monitor: layer (Markets ▸ Chokepoints), `/api/chokepoints`
  proxy, `get_chokepoints` MCP tool, 24 unit tests, translations in 13
  languages, docs, and the "How to add a new layer" guide in `ROADMAP.md`.

## In progress when the session stopped

The final gate run (format, boundaries, i18n, token check, `npm test`,
build) was started and not read. The previous full `npm test`, run before the
last docs-only commits, had exactly 2 failures, both pre-existing on upstream
(`cameraGoldens.test.mjs`, `cameraPort.test.mjs`).

## Exact next step

```sh
cd ~/globe/gods-eye-view
npm run format:check && npm run check:boundaries && npm run i18n \
  && npm run layer-token:check -- --base-ref upstream/main && npm run build
npm test        # expect only the 2 camera failures
git switch main && git merge --no-ff feat/chokepoint-monitor
git push origin main
npm run build:panel   # so Claude Desktop's in-chat globe has the new layer
```

Then start roadmap feature 2 (markets strip), with every quote provider
behind one swappable adapter, as the user asked.

## Open issues

1. **PortWatch daily feed is down.** `Daily_Chokepoints_Data` answered early
   in the session, then began returning "Token Required" and left PortWatch's
   public catalogue. The layer therefore shows grey markers and 2019–2024
   averages. Check `curl localhost:4173/api/chokepoints` for
   `daily.available: true`. IMF's public charts use the same table, so it
   should return; if it has not after a few days, find another transit-count
   source and plug it in through the proxy's `loaders` option.
2. **Coloured state never seen with live data.** It was verified in headless
   Chrome with a test fixture injected into the browser only. Re-check by eye
   once the feed is back.
3. **Hormuz check: done, real.** About 2–6 transits a day on 1–8 Nov 2026
   against a 2019–2024 average of 89; other straits normal the same days and
   the Cape detour up. Details in `ROADMAP.md`, "What is built". Not yet
   re-confirmed for dates after 8 Nov because of issue 1.
4. **FIRMS: nothing to change.** Upstream already dropped `VIIRS_SNPP_NRT`;
   the proxy requests `VIIRS_NOAA20_NRT`, `VIIRS_NOAA21_NRT` and `MODIS_NRT`.
   Confirmed with the user's key: about 94,000 detections, and fires draw on
   the globe.
5. **Live AIS "ships in the strait now" count: not built**, on purpose (thin
   AIS coverage in the Gulf would look like a disruption).
6. MCP place names do not resolve (place lookup is off by default); use
   coordinates.

## Decisions the next session needs

- Status compares the 7-day mean with the **2019–2024 average**, not the last
  90 days; the 90-day figure is only the trend. Do not "simplify" this.
- Share-link token for chokepoints is `03`, taken in order as the checker
  requires. Upstream will take `03` for its own next layer: on that merge,
  renumber this fork's layer (see ROADMAP Gotchas).
- New `Markets` group in `PANEL_GROUPS`; future finance layers go there.
- `flows.js` text is reference data, left in English, not translated.
- No `changelog.d/` fragment (those are keyed by upstream PR number).
- MIT only: never copy from `~/globe/worldmonitor` (AGPL).
- Free only: ask before anything that can bill.
