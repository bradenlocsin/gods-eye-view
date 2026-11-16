# Roadmap: a finance + geopolitics intelligence globe

This fork of [God's Eye View](https://github.com/bilawalsidhu/gods-eye-view)
(MIT) adds a markets-and-geopolitics desk on top of the upstream globe: the
goal is to open it each morning and see **what happened, where, and what it
moves**: a tanker is hit near Hormuz → oil moves → here is what is exposed.

Status: **approved 2026-11-16. Feature 1 (chokepoint monitor) is built**: see
[What is built](#what-is-built). Next is feature 2 (markets strip).
New layers follow [How to add a new layer](#how-to-add-a-new-layer).

## Ground rules

- **MIT only.** No code is copied from World Monitor (AGPL-3.0) or
  Shadowbroker. Their choice of public data sources and their published
  scoring ideas are studied; every implementation here is written from
  scratch.
- **World Monitor is optional, later.** It is not installed or registered.
  Its hosted MCP server (`https://worldmonitor.app/mcp`) allows a free
  account 5 calls a day; self-hosting is free but needs Docker and its own
  data pipeline. Upstream's GDELT News layer covers the need for now. To add
  it later: `claude mcp add --transport http worldmonitor https://worldmonitor.app/mcp`.
- **Free only.** Every source below is keyless or has a free key. Anything
  that could bill (LLM APIs, Google Maps, paid tiers) is called out and is
  opt-in.
- **Markets and geopolitics, not people.** No custom work on ALPR, Shodan or
  similar layers.
- **Public data, honestly labelled.** A late or estimated number says so in
  the UI. Upstream's rule applies: never present public-data inference as
  authoritative intelligence.

## How the layer system works

One layer is five small pieces, each with one job. Data flows left to right:

```
upstream API ──▶ server proxy ──▶ source ──▶ layer ──▶ globe + panel
                 /api/<name>      (browser)   (browser)
```

| Piece | Where | Job |
| --- | --- | --- |
| **Server proxy** | `server/providers/<name>.js` | A Vite plugin that mounts `/api/<name>` on the dev and preview servers. It calls the upstream, validates and caps the response, caches it, and serves a small, already-clean JSON document. Keys live here and never reach the browser. All proxies are listed in `server/providers/local.js`. |
| **Source** | `src/layers/<name>/source.js` | A factory such as `createUsgsEarthquakeSource({ fetchImpl })` returning `{ getSnapshot({ signal }) }`. It requests the same-origin `/api/...` path and validates every record again. It takes `fetchImpl` as an argument so the MCP tools can reuse it outside the browser. |
| **Records / model** | `src/layers/<name>/records.js`, `model.js` | Pure functions: normalise rows, pick colours, build labels. No network, no drawing, so they are easy to unit-test. |
| **Layer** | `src/layers/<name>/index.js` | A factory returning the layer object: `id`, `name`, `updateInterval`, and `init / enable / disable / update / destroy / getStats`. `update()` asks the source for a snapshot and draws it. It draws through the **renderer contract** (`drawOf(viewer).shapes(...)`), never through Cesium directly. Two ratchet tests enforce that. |
| **App wiring** | `src/app/layers/<name>.js`, `src/app/constructCatalog.js`, `src/app/sourceComposition.js` | Hands the layer its application services (overlay labels, selection context) and adds it to the catalog the app boots. |

Then a set of **registries** each need one line so the layer is a first-class
citizen. A layer is only "done" when all of them know about it:

| Registry | File | What it gives the layer |
| --- | --- | --- |
| Panel group | `src/ui/layerPanel.js` (`PANEL_GROUPS`) | Its toggle row in DATA LAYERS |
| Display name | `src/ui/layerNames.js` | A translatable name |
| Share-link token | `src/data/layerState.js` + `src/data/layerStateTokenReservations.json` | Survives in a copied link (`npm run layer-token:next`) |
| Credit | `src/data/dataCredits.js` + `DATA_SOURCES.md` | Attribution popover, licence record |
| Voice / chat | `src/voice/layerManifest.js` | "turn on chokepoints" |
| Standalone sources | `src/standalone/layerSources.js` | The default source instance |
| Boundaries and format | `scripts/package-boundaries.json`, `scripts/format-scope.json` | `npm run check:boundaries` and `npm run format:check` pass |
| Translations | `src/i18n/` | `npm run i18n` passes |

The reference commit for "everything a new layer touches" is upstream's
shipwrecks layer: `git show --stat dcd0f2ccc`.

Other things worth knowing:

- **UI is Vue 3 + Pinia.** A panel is a Vue component in `src/ui/views/`
  rendering a Pinia store in `src/ui/stores/`; the layer publishes plain
  objects to the store. No hand-built DOM.
- **MCP tools** (`src/tools/`) reuse the same sources. A tool is
  `defineTool({ name, inputSchema, requires, run })` and answers
  `{ summary, data }`. This is how Claude reads the globe's data, so each
  feature below also ships a tool.
- **The Data Library** (`src/library/entries/*.json`) adds a simple dataset or
  tile layer with one JSON manifest and no JavaScript. Use it for static
  point/polygon datasets; use a real layer when there is logic, a panel or a
  derived number.
- **Gates.** `npm test`, `npm run build`, `npm run format:check`,
  `npm run check:boundaries`, `npm run i18n`, `npm run layer-token:check`.
- **Staying mergeable with upstream.** Custom code lives in its own folders
  (`src/layers/<name>/`, `server/providers/<name>.js`). The registries above
  are the only shared files touched, one line each, which keeps
  `git pull upstream main` conflicts small.

## What upstream already has (do not rebuild)

- **A News layer** (Events ▸ News): the last 24 h of conflict reports read
  from GDELT 2.0 with no key, with hotspots, severity, categories and a
  right-rail panel. This covers most of the "GDELT events layer" and
  "conflict layer" ideas already.
- **Live vessels** (AISStream key), flights, military aircraft, submarine
  cables, military installations, fires, quakes, cyclones.
- **A regional brief** and `situation_brief` MCP tool (weather, quakes, fires,
  aircraft, ships around a point).

What it has none of: markets, chokepoints, commodities, exposure, country
risk, or any news tool on the MCP surface.

## Ranked features

Effort is working hours for a Claude Code session including tests and docs.

| # | Feature | What it shows | Free source | Hours | Why it matters for markets |
| --- | --- | --- | --- | --- | --- |
| 1 | **Chokepoint monitor** (layer + panel + MCP tool) | The world's 28 maritime chokepoints on the globe, each coloured by how far ship transits are from normal. Panel: transits per day, 7-day average against a 90-day baseline, tanker / container / bulk mix, a sparkline, and what flows through (share of world oil, LNG, grain, containers). With an AISStream key, a live "ships in the strait now" count. | [IMF PortWatch](https://portwatch.imf.org/) daily chokepoint transits (keyless ArcGIS service, verified working, about a week behind) + existing AIS layer for live counts + a small hand-written table of what each strait carries | 6–10 | Chokepoints are where geopolitics becomes a price. Hormuz, Bab el-Mandeb and Suez disruptions move crude, LNG, freight rates and insurers within hours. A transit count far below baseline is a hard, checkable number. |
| 2 | **Markets strip + panel** | A compact strip: Brent, WTI, natural gas, gold, copper, wheat, S&P 500, Nasdaq, VIX, DXY, US 10-year, EUR/USD, USD/JPY, BTC, ETH, each with day change and a sparkline. Panel with the full list. | Yahoo Finance chart endpoint (keyless but unofficial, verified working), [Frankfurter](https://frankfurter.dev/) for ECB FX rates (keyless), [CoinGecko](https://www.coingecko.com/en/api) for crypto (keyless), optional free [FRED](https://fred.stlouisfed.org/docs/api/api_key.html) key for official rates and yields. **Each provider sits behind one quote-source adapter** (`getQuotes(symbols) → [{ symbol, price, change, series }]`), so the unofficial Yahoo endpoint can be swapped for another provider in one file when it breaks | 5–8 | The other half of every "event → market" sentence. Without prices on the same screen the globe is only a news map. |
| 3 | **Event → exposure view** | Click a chokepoint, hotspot or country and a card answers "who is exposed?": commodities, the futures and sector ETFs that track them, importing and exporting countries, and the relevant live quote from feature 2. | A hand-authored `exposure.json` (chokepoint / region → commodities → instruments → countries), built from public EIA, UNCTAD and IEA summaries; joins features 1 and 2 and the existing News hotspots | 6–10 | This is the thesis of the project and the part a recruiter remembers. It is mostly a curated dataset plus a card, so it is cheap once 1 and 2 exist. |
| 4 | **Daily world brief** | One page each morning: overnight market moves, chokepoints off baseline, top conflict hotspots, and what links them. | Features 1–3 through MCP tools, plus a new `get_news_hotspots` tool over the existing News source. Written by Claude Code on a schedule, so no LLM API bill. | 4–6 | The daily habit. Also a ready-made writing sample of market commentary. |
| 5 | **Country risk score** (own design) | A choropleth and ranked list, 0–100, with the components shown: conflict intensity (GDELT event counts per capita, 30-day trend), chokepoint dependence, currency stress (30-day FX move), and World Bank governance indicators as the slow baseline. | GDELT (existing reader), feature 1, Frankfurter, [World Bank API](https://datahelpdesk.worldbank.org/knowledgebase/articles/889392) (keyless) | 10–14 | Sovereign and EM risk in one number, with a transparent method to defend in an interview. Deliberately last among the big ones: a score is only as credible as the layers under it. |
| 6 | **News tool + regional summaries** | `get_news_hotspots` / `get_news_feed` on the MCP surface so Claude can summarise any region on request. In-app AI summaries stay off unless an LLM key is added. | Existing News source | 2–4 | Makes the existing layer useful from chat. In-app summaries would need a paid LLM key, so they are opt-in. |
| 7 | **Conflict data upgrade** | Fatality-coded conflict events beside the GDELT reports. | [UCDP GED](https://ucdp.uu.se/apidocs/) (free, but now needs an access token requested by email) or [ACLED](https://acleddata.com/) (free account, restrictive redistribution terms) | 6–8 | Better data, but upstream's News layer already covers the visible need. Do it when the risk score wants a stronger conflict input. |
| 8 | **Energy infrastructure** (Data Library entries) | Refineries, LNG terminals, pipelines, major ports as toggles. | Provider-hosted open datasets (candidates: EIA atlas layers, public domain; licence to be checked per entry) | 1–2 each | Cheap context for features 1 and 3: what a strike near a given point could actually hit. |
| 9 | **Prediction-market odds** | Market-implied probabilities for geopolitical questions next to the relevant region. | Polymarket public API (keyless; not yet verified here) | 3–5 | A second, priced opinion beside the news. Nice-to-have. |

Recommended order: **1 → 2 → 3 → 6 → 4 → 8 → 5 → 7 → 9.**

## Recommended first feature: the chokepoint monitor

- **Wow factor.** Five to ten glowing markers on the photorealistic globe at
  the straits everyone has heard of, coloured by disruption. PortWatch's
  latest rows show the Strait of Hormuz at 3 transits a day while Malacca
  runs 231: that contrast is the screenshot.
- **Real market use.** It is a number checked before the open, and it leads
  straight into "what is exposed".
- **Clean pattern.** It exercises every piece exactly once and nothing
  exotic: a keyless server proxy with caching and stale fallback, a source,
  a pure model (baseline and deviation maths, easy to test), a globe layer,
  a panel, a toggle, a share token, a credit and an MCP tool. Markets
  (feature 2) is mostly a panel and would not establish the globe-layer
  pattern; the risk score depends on other layers existing first.
- **Honest limits, stated in the UI.** PortWatch is about a week behind and
  is an AIS-derived estimate. The panel shows the data date, and the live
  AIS count (when a key is present) covers "right now".

Scope for the first build: all 28 PortWatch chokepoints as markers with the
major ones labelled; panel list sorted by deviation from baseline; detail
card with mix, sparkline and the commodity table for the eight major straits
(Hormuz, Bab el-Mandeb, Suez, Malacca, Panama, Bosporus, Taiwan Strait, Cape
of Good Hope); `get_chokepoints` MCP tool; error and stale states; unit tests
for the model and proxy.

## What is built

### Chokepoint monitor (2026-11-16)

Markets ▸ **Chokepoints** in DATA LAYERS, the `/api/chokepoints` proxy and
the `get_chokepoints` MCP tool. Runtime details are in
`docs/CURRENT-STATE.md` under "Chokepoints".

**Is the Hormuz number real?** Checked before building on it:

- PortWatch's own 2019–2024 yearly counts put Hormuz at **89 ships a day**
  (about 54 of them tankers). The daily table agreed: 69 to 93 a day for
  every year from 2019 to mid-2024.
- For 1–8 November 2026 the daily table gave **2 to 6 a day**, about 96%
  below that average.
- The same days read normal elsewhere (Malacca 231 against 196, Taiwan
  Strait 237 against 242), so it is not a short or partial data day. The
  related straits moved the way a real closure would move them: Bab
  el-Mandeb 24 against 53, Suez 43 against 54, and the Cape of Good Hope
  detour **up** to 77 against 59.
- What the count covers: cargo ships and tankers (container, dry bulk,
  general cargo, ro-ro, tanker), estimated from AIS signals. No naval,
  fishing or passenger vessels, and a ship that switches its transponder
  off is not counted.

So it reads as a real disruption, not an artifact. What the check changed in
the design: a strait shut for months looks "normal" against its own last 90
days, so **status is measured against the 2019–2024 average** and the 90-day
figure is shown beside it as the trend. `model.test.mjs` pins this.

**Known limits**

- PortWatch's daily table stopped answering public requests ("Token
  Required") partway through the build session, after answering earlier the
  same day. IMF's own public charts read the same table, so this is expected
  to be temporary, but until it answers again the layer shows the 2019–2024
  averages with grey markers and says so. The proxy retries every 15 minutes
  and keeps the last good counts on disk for 21 days. The coloured state was
  checked in a browser against a test fixture, not live data.
- Counts are about a week behind. The planned live "ships in the strait now"
  count from AIS is **not built**: the free AIS feed has thin coverage in the
  Gulf and Red Sea, so a low live count there would look like a disruption
  when it is only missing receivers. It needs a coverage check first.
- `flows.js` (what each strait carries) is hand-written from EIA and UNCTAD
  summaries and is shown in English in every language.
- The translations of the 28 UI strings were written by Claude, not reviewed
  by native speakers.

## How to add a new layer

The chokepoint monitor is the worked example. Copy it file by file. The
commits are the template: `git log --oneline --grep chokepoints`.

### 1. Decide what kind of thing it is

| The data is | Do this |
| --- | --- |
| A static set of points or polygons at a stable public URL | A Data Library entry: one JSON file, no code. See `docs/DATA-LIBRARY.md`. |
| Anything with a derived number, a card, a key or a cache | A layer, as below. |

### 2. Files to create

Replace `chokepoints` with the new layer's id (lowercase, dashes).

| File | Copy from | What goes in it |
| --- | --- | --- |
| `src/layers/<id>/records.js` | `src/layers/chokepoints/records.js` | Upstream URLs and the validators. Pure: no `fetch`, no i18n, no drawing. Validate every field; drop bad rows rather than trusting them. |
| `src/layers/<id>/model.js` | `…/chokepoints/model.js` | The maths (status, colour, size, ordering). Pure. This is where the unit tests earn their keep. |
| `src/layers/<id>/cards.js` | `…/chokepoints/cards.js` | Card text. The only file besides `index.js` that imports `t()` from `src/i18n/index.js`. |
| `src/layers/<id>/source.js` | `…/chokepoints/source.js` | `create<Name>Source({ fetchImpl })` returning `{ getSnapshot({ signal }) }`. Fetches the same-origin `/api/<id>` path only. |
| `src/layers/<id>/index.js` | `…/chokepoints/index.js` | `create<Name>Layer({ source, overlayHost, picking, pointer, openExternal })` returning the layer object. |
| `server/providers/<id>.js` | `server/providers/chokepoints.js` | The proxy: a Vite plugin mounting `/api/<id>` in both `configureServer` and `configurePreviewServer`. |
| `src/app/layers/<id>.js` | `src/app/layers/chokepoints.js` | Hands the layer the app's overlay, picking and pointer services. |
| `src/tools/queries/<topic>.js` | `src/tools/queries/markets.js` | Optional MCP tool. Add to `markets.js` if it is a markets tool. |
| `*.test.mjs` beside each | the chokepoints tests; proxy test in `src/data/<id>Proxy.test.mjs` | See step 5. |

### 3. Registries to edit (one line each)

Search each file for `chokepoints` and add the new id next to it.

1. `server/providers/local.js`: import the proxy and add it to the array.
2. `src/app/constructCatalog.js`: import and add `createApplication<Name>({ source: sources['<id>'] })`.
3. `src/app/sourceComposition.js`: `'<id>': contract(['<id>'], ['getSnapshot'])`.
4. `src/standalone/layerSources.js`: import the source factory and add `'<id>': create<Name>Source()`.
5. `src/ui/layerNames.js`: `'<id>': msg('Display name')`.
6. `src/ui/layerPanel.js`: add the id to a group in `PANEL_GROUPS` (finance layers go in `Markets`).
7. `src/data/layerState.js` and `src/data/layerStateTokenReservations.json`: run `npm run layer-token:next -- <id>` and add the token it prints to **both** (the registry is alphabetical by id).
8. `src/data/dataCredits.js`: the attribution, and a row in `DATA_SOURCES.md` with the licence.
9. `src/voice/layerManifest.js`: add to `VOICE_OFF_LAYERS` with a reason (or write a full voice entry).
10. `src/data/spriteOrder.js`: only if the layer draws icons; put it where it should stack (`flights` must stay last).
11. `src/tools/index.js` (import **and** one entry in `coreTools`), `src/tools/services.js`, `src/tools/surfaces.js`: only if it has a tool.
12. `scripts/package-boundaries.json`: add every new `src/` file. Run `npm run check:boundaries`; it names one missing file and package at a time, so repeat until it prints nothing but `Checked …` lines.
13. `scripts/format-scope.json`: add the new `*.test.mjs` files (runtime files are found automatically).
14. `docs/CURRENT-STATE.md`: a table row and a short section.

### 4. Translations

Every string in `t()`, `tn()` or `msg()` must exist in **all 13** catalogs in
`src/i18n/locales/`, or `npm test` fails. So keep UI text short and reuse
strings.

- `npm run i18n` lists what is missing; `npm run i18n -- --missing de` prints
  the missing entries for one language as JSON to fill in.
- Plural strings (`tn`) need the forms that language uses (Arabic has six).
  The `--missing` output shows the keys.
- Text that is data, not interface (a feed's own words, the `flows.js`
  table), is left unwrapped and shown as written.
- No `t()` at module top level: keep English in `msg()` and call `t()` when
  rendering.

### 5. Tests and gates

Write, at minimum: a model test (the maths, including the empty and
too-short cases), a records test (bad rows are dropped), and a proxy test
using a fake `fetchImpl` and a fake clock (cache hit, upstream down, stale
serving, bad method and path).

Then bump the pinned counts a new layer always changes. Each failure message
names the number to change:

- `src/app/constructCatalog.test.mjs` (two) and `src/app/sourceComposition.test.mjs`: catalog layer count, +1.
- `src/data/layerState.test.mjs`: registered-layer count +1, the "next token" value, and add the new id to the `delete beforeNews.…` lines.
- `src/data/layerStateTokenLedger.test.mjs`: reservation count +1, the expected ledger object, the `beforeLastDigitRows` filter, a strip block for the new id in `writeCodecFixture`, and the "future" / "retired-layer" tokens (use the next free one).

All of these must pass before merging:

```sh
npm run format && npm run format:check
npm run check:boundaries
npm run i18n
npm run layer-token:check -- --base-ref upstream/main
npm test
npm run build
```

### 6. See it in the app

`npm run dev`, open http://localhost:4173, DATA LAYERS ▸ the group ▸ the
layer. Check four states: loaded, upstream down on first load, upstream down
after a good load (stale), and layer off. `curl localhost:4173/api/<id>`
shows what the proxy serves.

### Gotchas

- **Two camera tests fail on this Mac before any change**
  (`cameraGoldens.test.mjs`, `cameraPort.test.mjs`). They fail on an
  untouched upstream checkout too. Ignore those two; anything else is yours.
- **Run single test files with the Vue loader**:
  `node --import=./build/registerVue.js --test <file>`. Plain `node --test`
  fails on `.vue` imports for some files.
- **Never import Cesium in a layer.** Draw through `drawOf(viewer)` and read
  clicks through `inputFor(viewer)`. Two ratchet tests fail otherwise.
- **The proxy never trusts the client.** It fetches fixed upstream URLs only,
  caps the response size, and returns no upstream error text.
- **ArcGIS answers errors with HTTP 200.** Check the body for `error`
  (`arcgisError` in `records.js`). PortWatch also refuses `resultOffset`
  paging: select by date instead.
- **Design for the feed being down.** Keep the last good answer, serve it
  marked stale, and make the layer row say what is missing. PortWatch went
  down during this very build.
- **Compare against a long-run normal, not only a recent window**, or a
  long disruption will read as normal.
- **Share tokens and upstream merges.** Tokens are handed out in order
  (`03` is chokepoints). When upstream adds a layer it will take the same
  next token. After `git pull upstream main`, keep upstream's token, rerun
  `npm run layer-token:next -- <id>` for this fork's layers, and update the
  two token files and the pinned tests. Old share links to the fork's layer
  stop working; that is acceptable here.
- **Changelog fragments** (`changelog.d/`) are named by upstream pull-request
  number. This fork records features in this file instead; add a fragment
  only when sending a change upstream.
- **Keys.** A source that needs a key gets it from `process.env` in the
  proxy only, plus an entry in `.env.example`. Never in `src/`.
- **MIT only.** Do not open World Monitor's or Shadowbroker's source while
  writing a layer. Work from the provider's own API documentation.

## Portfolio plan

**README (top of the fork).** One sentence, one GIF, then the story:

1. Title and a line such as *"A live globe that connects world events to
   markets."*
2. A 10–15 s GIF: globe spins to Hormuz, the chokepoint turns red, the card
   opens with transits against baseline and the Brent quote.
3. "What I built" in four bullets, each linking to its code and naming the
   data source. Clear credit that the globe engine is upstream's MIT project
   and exactly which parts are mine.
4. An architecture diagram of the five-piece layer pipeline above.
5. "Method notes": how the baseline, deviation and (later) the risk score
   are computed, with their limits. Finance readers look for this.
6. Run it in three commands; which keys are optional.

**Screenshots and GIFs** (`docs/media/`): chokepoint overview from orbit;
Hormuz close-up with card; markets strip; exposure card; the morning brief.

**Demo script (90 seconds).** "Here is the world this morning. Three
chokepoints are off baseline. Click Hormuz: tanker transits are down, this is
what flows through it, these are the instruments and countries exposed, and
here is Brent today. Now I ask Claude, through the MCP server, why, and it
flies the globe there and answers from the same data."

**For finance readers:** the method notes, the exposure table with sources,
and an archive of the daily briefs as writing samples.
**For tech readers:** the clean layer pattern, tests and gates passing, small
commits, the MCP tools, and the discipline of keeping an MIT fork clean of
AGPL code.

**Repo hygiene:** feature branches, small conventional commits, `.env` never
committed, upstream kept as a remote and merged regularly.
