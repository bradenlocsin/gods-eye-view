# Setup notes

How this machine is set up for the fork, and how to start it again.

## Start everything

```sh
cd ~/globe/gods-eye-view
npm run dev            # http://localhost:4173, leave it running
```

Then, in a second terminal, start Claude Code from `~/globe`. The
`gods-eye-view` MCP server is registered for your user and reads the running
app, so start the app first.

To stop the app: `Ctrl+C` in its terminal (or `lsof -ti tcp:4173 | xargs kill`).

## What is installed

| Thing | Version / location | Notes |
| --- | --- | --- |
| Node.js | 26.12.1 (Homebrew) | The project needs 24 or 26, not 25. Pinned in `.nvmrc`. No nvm or fnm installed. |
| GitHub CLI | `gh` 2.104.0 (Homebrew), logged in as `bradenlocsin` | Also the git credential helper (`gh auth setup-git`). |
| The fork | `~/globe/gods-eye-view` | `origin` = github.com/bradenlocsin/gods-eye-view, `upstream` = bilawalsidhu/gods-eye-view. |
| World Monitor source | `~/globe/worldmonitor` | Reference only (AGPL). Never copy code from it. Not running, not registered. Safe to delete. |
| Git identity | set for this repository only | `bradenlocsin` with the GitHub no-reply address, so your email is not in commits. |

## Keys

Keys live in `~/globe/gods-eye-view/.env`. It is gitignored (`.gitignore`
covers `.env` and `.env.*`) and readable only by you. Never commit it.

| Variable | For | Where to manage it |
| --- | --- | --- |
| `CESIUM_ION_TOKEN` | Photorealistic 3D globe | https://ion.cesium.com/tokens (restricted to `http://localhost:4173`; visible in the browser by design) |
| `AISSTREAM_API_KEY` | Live ships | https://aisstream.io |
| `FIRMS_MAP_KEY` | NASA active fires | https://firms.modaps.eosdis.nasa.gov/api/map_key/ |

These three keys were pasted into a Claude Code chat to set this up. They are
free, but if you want to be careful, regenerate them on those pages and paste
the new values into `.env`. Restart `npm run dev` after any change to `.env`.

`npm run doctor` shows which providers are configured. Nothing here costs
money. Google Maps, OpenAI and Gemini keys are deliberately not set.

## MCP servers

| Client | Server | State |
| --- | --- | --- |
| Claude Code (user scope) | `gods-eye-view` | Registered. Check with `claude mcp list`. |
| Claude Desktop | `gods-eye-view` | Added to `~/Library/Application Support/Claude/claude_desktop_config.json` (backup beside it, `.bak-2026-11-16`). Quit and reopen Claude Desktop to load it. |
| Either | World Monitor | Not registered. To add later: `claude mcp add --transport http worldmonitor https://worldmonitor.app/mcp`, then `/mcp` to sign in (free account: 5 calls a day). |

Things to know when asking Claude about the globe:

- Place names ("Strait of Hormuz") do not resolve, because place lookup is
  off by default. Claude can pass coordinates instead. To turn lookup on, set
  `NOMINATIM_URL` in `.env` to a search endpoint you are allowed to use.
- After changing the app's code, run `npm run build:panel` so the in-chat
  globe in Claude Desktop matches.
- Try: "Which maritime chokepoints are disrupted right now? Show them on the
  globe." (uses `get_chokepoints`).

## Everyday git

```sh
git switch -c feat/<name>          # start a feature
git pull upstream main             # bring in upstream's changes (see ROADMAP.md, Gotchas, on share tokens)
git push origin main               # publish to your fork
```

Checks before merging a feature (all listed in `ROADMAP.md`):

```sh
npm run format:check && npm run check:boundaries && npm run i18n && npm test && npm run build
```

Two camera tests (`cameraGoldens`, `cameraPort`) fail on this Mac on an
untouched upstream checkout as well; they are not caused by the fork.

## Where to read next

- `ROADMAP.md`: what is built, what is next, and how to add a layer.
- `docs/CURRENT-STATE.md`: how every layer behaves at runtime.
- `docs/MCP_SETUP.md` and `docs/TOOLS.md`: the MCP server and its tools.
