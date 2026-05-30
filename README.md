# video-content

Working repo for video-tooling experiments. The headline piece is an **MCP
integration for [OpenScreen](https://github.com/siddharthvaddem/openscreen)**
that lets an AI agent (Claude Desktop, Cursor, etc.) drive the screen recorder:
list sources, start/stop recordings, and make timeline edits in the editor.

## What's in here

| Path | What it is |
| --- | --- |
| `openscreen/` | Clone of OpenScreen (Electron screen recorder) **+ the MCP integration built here** |
| `openscreen/mcp-server/` | Standalone MCP server (25 tools) — the process an agent spawns |
| `openscreen/electron/automation/` | Loopback HTTP bridge in the Electron main process |
| `openscreen/src/automation/` | Renderer command bus + handlers (global / recording / editor) |
| `claude-tts-hook/` | Claude Code text-to-speech hook (separate utility) |

## OpenScreen MCP server (built this session)

### Why it's three layers

OpenScreen's recording HUD and editor live in **different renderer windows**, and
the editing/export logic is **not reachable over plain Electron IPC**. So the
integration adds a command layer rather than calling existing IPC:

```
AI agent ──stdio──> MCP server ──HTTP(127.0.0.1)──> Electron main bridge ──IPC──> renderer command bus
                    (mcp-server/)   bearer token       (electron/automation)       (src/automation)
```

1. **MCP server** (`mcp-server/`) — standalone Node process the agent spawns;
   each tool forwards one command to the bridge and returns the JSON result.
2. **Automation bridge** (`electron/automation/bridge.ts`) — loopback HTTP server
   started only when the app runs with `OPENSCREEN_AUTOMATION=1`. Dispatches each
   command to renderer windows one at a time (focused first) so every command
   runs exactly once.
3. **Renderer command bus** (`src/automation/`) — registers the real handlers.
   Global actions everywhere; recording actions in the HUD window; editor actions
   in the editor window.

Security: loopback-only, bearer-token gated. On startup the app writes the port +
token to `<userData>/automation.json` (mode `0600`). Local single-user use only.

### The 25 tools

- **Connectivity** — `openscreen_health` (call first), `openscreen_get_platform`
- **Recording** (HUD window) — `list_sources`, `select_source`,
  `open_source_selector`, `set_capture_options`, `start_recording`,
  `stop_recording`, `pause_recording`, `cancel_recording`, `recording_status`,
  `start_new_recording`
- **Window / project** — `switch_to_editor`, `switch_to_hud`,
  `get_current_video_path`, `get_current_recording_session`, `reveal_in_folder`,
  `load_project`
- **Editor** (editor window) — `get_editor_state`, `add_zoom`,
  `add_text_annotation`, `set_background`, `undo`, `redo`, `export`

(All tool names are prefixed `openscreen_`.) Full schemas, the Claude Desktop
config snippet, and setup steps live in
[`openscreen/mcp-server/README.md`](openscreen/mcp-server/README.md).

### Quick start

```bash
# 1. build the server
cd openscreen/mcp-server && npm install && npm run build

# 2. launch OpenScreen with automation enabled (from openscreen/)
OPENSCREEN_AUTOMATION=1 npm run dev

# 3. point Claude Desktop at openscreen/mcp-server/dist/index.js, then call
#    openscreen_health to verify the connection
```

## Verification status

- **Builds clean** — MCP server `tsc` (rc=0); app `tsc --noEmit` (rc=0); Biome
  clean on all changed files.
- **MCP server smoke test (live, over stdio)** — real JSON-RPC handshake:
  `initialize` ok, `tools/list` returned all 25 tools, and `openscreen_health`
  failed *gracefully* (not a crash) when the bridge was down.
- **Bridge client ↔ HTTP test** — drove the real `BridgeClient` against a mock
  loopback bridge: health round-trips, command args echo back, wrong token → 401
  path, empty token → short-circuit guard. All passed.

### Honest gaps (not yet verified / not built)

- **Live recording & export are untested end-to-end** — they need a real display
  and OS capture permissions, so they couldn't run in a headless sandbox. The
  HTTP/JSON-RPC plumbing is proven; the recording/editor handlers are only
  type-checked.
- **Export prompts for a save location** — `openscreen_export` starts the flow;
  silent/unattended export would need a deeper change to the renderer export path.
- **No telemetry-driven auto-zoom** — `add_zoom` places one region at a time; it
  does not analyze the recording to auto-place zooms.
