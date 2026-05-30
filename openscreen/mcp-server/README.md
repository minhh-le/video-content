# OpenScreen MCP Server

An [MCP](https://modelcontextprotocol.io) server that lets an AI agent (Claude
Desktop, Cursor, etc.) drive OpenScreen: list capture sources, start/stop
recordings, and make timeline edits (zoom, annotations, background) in the
editor.

## How it works

Three layers, because the recording HUD and the editor live in different
renderer windows and editing/export logic is **not** reachable over plain IPC
handlers:

```
AI agent ──stdio──> MCP server ──HTTP(127.0.0.1)──> Electron main bridge ──IPC──> renderer command bus
                    (this dir)    bearer token         (electron/automation)        (src/automation)
```

1. **MCP server** (`mcp-server/`) — a standalone Node process the agent spawns.
   Each tool forwards one command to the bridge and returns the JSON result.
2. **Automation bridge** (`electron/automation/bridge.ts`) — a loopback HTTP
   server started only when the app runs with `OPENSCREEN_AUTOMATION=1`. It
   dispatches each command to renderer windows one at a time (focused first); a
   window with no handler replies `unhandled` so the next window gets a turn.
   This guarantees every command runs exactly once even though all windows
   receive it.
3. **Renderer command bus** (`src/automation/`) — registers the actual
   handlers. Global actions (sources, window switching) are available
   everywhere; recording actions live in the launch/HUD window; editor actions
   live in the editor window.

Security: loopback-only, bearer-token gated. On startup the app writes the
chosen port + token to `<userData>/automation.json` (mode `0600`). Intended for
local, single-user automation only.

## Setup

### 1. Build the MCP server

```bash
cd mcp-server
npm install
npm run build
```

This produces `mcp-server/dist/index.js`.

### 2. Launch OpenScreen with automation enabled

From the repo root:

```bash
OPENSCREEN_AUTOMATION=1 npm run dev
```

(or set the same env var when launching the packaged app). On startup you'll see
`[automation-bridge] listening on http://127.0.0.1:8769` and a line reporting
where `automation.json` was written.

### 3. Point your MCP client at the server

For **Claude Desktop**, edit `claude_desktop_config.json`:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "openscreen": {
      "command": "node",
      "args": ["/absolute/path/to/openscreen/mcp-server/dist/index.js"]
    }
  }
}
```

Restart Claude Desktop. The MCP server finds the bridge automatically by reading
`automation.json`. To override discovery, set `OPENSCREEN_AUTOMATION_PORT` and
`OPENSCREEN_AUTOMATION_TOKEN` (or `OPENSCREEN_AUTOMATION_CONFIG` to point at a
specific config file) in the server's `env` block.

Verify the connection from the agent by calling **`openscreen_health`** first.

## Tools

### Connectivity
- `openscreen_health` — verify the server can reach the bridge. Call this first.
- `openscreen_get_platform` — OS platform (darwin/win32/linux).

### Recording (needs the HUD/launch window open)
- `openscreen_list_sources` — screens/windows available to record.
- `openscreen_select_source` `{ sourceId }`
- `openscreen_open_source_selector`
- `openscreen_set_capture_options` `{ microphone?, systemAudio?, webcam? }`
- `openscreen_start_recording`
- `openscreen_stop_recording`
- `openscreen_pause_recording`
- `openscreen_cancel_recording`
- `openscreen_recording_status`
- `openscreen_start_new_recording`

### Window / project
- `openscreen_switch_to_editor`
- `openscreen_switch_to_hud`
- `openscreen_get_current_video_path`
- `openscreen_get_current_recording_session`
- `openscreen_reveal_in_folder` `{ path }`
- `openscreen_load_project`

### Editor (needs the editor window open)
- `openscreen_get_editor_state` — video path, duration, playhead, play state,
  wallpaper, region counts.
- `openscreen_add_zoom` `{ startMs, endMs, focusX?, focusY? }`
- `openscreen_add_text_annotation` `{ startMs, endMs }`
- `openscreen_set_background` `{ wallpaper }`
- `openscreen_undo`
- `openscreen_redo`
- `openscreen_export` `{ format? }` — mp4 (default) or gif.

## Known limitations

- **Export prompts for a save location.** `openscreen_export` starts the export
  flow; OpenScreen asks the user where to save rather than writing silently.
- **Window context matters.** Editor commands require the editor window;
  recording commands require the HUD. If a command returns "No open window
  handled…", switch to the right window first
  (`openscreen_switch_to_editor` / `openscreen_switch_to_hud`).
- **Live recording/export can't run headless.** Screen capture needs a real
  display and the OS capture permissions.
- **Token rotates per launch.** If the app restarts, restart the MCP server (or
  it will re-read `automation.json` on the next command) so it picks up the new
  token. A stale token surfaces as a 401 with a "restart the MCP server" hint.
- **Bulk telemetry-driven auto-zoom is future work.** `add_zoom` adds one region
  at a time; it does not yet analyze the recording to place zooms automatically.

## Development

```bash
npm run typecheck   # tsc --noEmit
npm run dev         # tsc --watch
npm start           # run the built server over stdio
```
