#!/usr/bin/env node
import { McpServer, type ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { type ZodRawShape, z } from "zod";
import { BridgeClient } from "./bridgeClient.js";

const bridge = new BridgeClient();

const server = new McpServer({
	name: "openscreen-mcp-server",
	version: "0.1.0",
});

/**
 * Helper: register a tool whose job is to forward a single command to the
 * OpenScreen automation bridge and return the JSON result as text.
 *
 * `mapArgs` converts the validated tool input into the bridge command args.
 */
function bridgeTool(opts: {
	name: string;
	title: string;
	description: string;
	inputSchema?: ZodRawShape;
	command: string;
	mapArgs?: (args: Record<string, unknown>) => Record<string, unknown>;
	timeoutMs?: number;
}): void {
	const handler = async (args: Record<string, unknown>) => {
		const commandArgs = opts.mapArgs ? opts.mapArgs(args) : args;
		const res = await bridge.command(opts.command, commandArgs, opts.timeoutMs);
		if (!res.ok) {
			return {
				isError: true,
				content: [{ type: "text" as const, text: res.error ?? "Unknown bridge error." }],
			};
		}
		return {
			content: [
				{
					type: "text" as const,
					text: JSON.stringify(res.result ?? { ok: true }, null, 2),
				},
			],
		};
	};

	server.registerTool(
		opts.name,
		{
			title: opts.title,
			description: opts.description,
			inputSchema: opts.inputSchema ?? {},
		},
		handler as unknown as ToolCallback<ZodRawShape>,
	);
}

/* ------------------------------------------------------------------ */
/* Connectivity                                                        */
/* ------------------------------------------------------------------ */

server.registerTool(
	"openscreen_health",
	{
		title: "Check OpenScreen connection",
		description:
			"Verify the MCP server can reach the OpenScreen automation bridge. Call this first if other tools fail — it reports whether the app is running with automation enabled.",
		inputSchema: {},
	},
	async () => {
		const res = await bridge.health();
		return {
			isError: !res.ok,
			content: [{ type: "text" as const, text: JSON.stringify(res, null, 2) }],
		};
	},
);

/* ------------------------------------------------------------------ */
/* App / recording control (handled by the HUD + main process)        */
/* ------------------------------------------------------------------ */

bridgeTool({
	name: "openscreen_get_platform",
	title: "Get platform",
	description: "Return the OS platform OpenScreen is running on (darwin, win32, linux).",
	command: "get_platform",
});

bridgeTool({
	name: "openscreen_list_sources",
	title: "List capture sources",
	description:
		"List available screens and windows that can be recorded. Returns id, name, and display_id for each (thumbnails are omitted to keep the response small).",
	command: "list_sources",
});

bridgeTool({
	name: "openscreen_select_source",
	title: "Select capture source",
	description:
		"Choose which screen or window to record next, by its source id (from openscreen_list_sources).",
	inputSchema: { sourceId: z.string().describe("The source id from openscreen_list_sources.") },
	command: "select_source",
});

bridgeTool({
	name: "openscreen_open_source_selector",
	title: "Open source selector",
	description: "Open OpenScreen's source-picker window so a screen/window can be chosen.",
	command: "open_source_selector",
});

bridgeTool({
	name: "openscreen_set_capture_options",
	title: "Set capture options",
	description:
		"Toggle capture inputs before recording: microphone, system audio, and webcam. Only the provided fields change. Has no effect while a recording is in progress.",
	inputSchema: {
		microphone: z.boolean().optional().describe("Enable/disable microphone capture."),
		systemAudio: z.boolean().optional().describe("Enable/disable system audio capture."),
		webcam: z.boolean().optional().describe("Enable/disable webcam capture."),
	},
	command: "set_capture_options",
});

bridgeTool({
	name: "openscreen_start_recording",
	title: "Start recording",
	description:
		"Start a screen recording with the currently selected source and capture options. Requires the HUD/launch window to be open. Use openscreen_select_source first if needed.",
	command: "start_recording",
});

bridgeTool({
	name: "openscreen_stop_recording",
	title: "Stop recording",
	description:
		"Stop the in-progress recording and finalize the video. OpenScreen then switches to the editor with the new recording loaded.",
	command: "stop_recording",
});

bridgeTool({
	name: "openscreen_pause_recording",
	title: "Pause/resume recording",
	description: "Toggle pause state of the in-progress recording.",
	command: "pause_recording",
});

bridgeTool({
	name: "openscreen_cancel_recording",
	title: "Cancel recording",
	description: "Cancel and discard the in-progress recording without saving.",
	command: "cancel_recording",
});

bridgeTool({
	name: "openscreen_recording_status",
	title: "Get recording status",
	description: "Report whether a recording is active, whether it is paused, and elapsed seconds.",
	command: "recording_status",
});

bridgeTool({
	name: "openscreen_switch_to_editor",
	title: "Switch to editor",
	description: "Bring up the OpenScreen video editor window.",
	command: "switch_to_editor",
});

bridgeTool({
	name: "openscreen_switch_to_hud",
	title: "Switch to HUD",
	description: "Return to the OpenScreen recording HUD/launch window.",
	command: "switch_to_hud",
});

bridgeTool({
	name: "openscreen_start_new_recording",
	title: "Start new recording session",
	description: "Reset OpenScreen to begin a brand-new recording session.",
	command: "start_new_recording",
});

bridgeTool({
	name: "openscreen_get_current_video_path",
	title: "Get current video path",
	description: "Return the file path of the recording currently loaded in the editor, if any.",
	command: "get_current_video_path",
});

bridgeTool({
	name: "openscreen_get_current_recording_session",
	title: "Get current recording session",
	description: "Return metadata about the recording session currently loaded, if any.",
	command: "get_current_recording_session",
});

bridgeTool({
	name: "openscreen_reveal_in_folder",
	title: "Reveal file in folder",
	description: "Reveal a file (e.g. an exported video) in the OS file manager.",
	inputSchema: { path: z.string().describe("Absolute path to the file to reveal.") },
	command: "reveal_in_folder",
});

bridgeTool({
	name: "openscreen_load_project",
	title: "Load project",
	description: "Open OpenScreen's load-project dialog to open a saved .openscreen project.",
	command: "load_project",
});

/* ------------------------------------------------------------------ */
/* Editor / timeline (handled by the editor renderer)                 */
/* ------------------------------------------------------------------ */

bridgeTool({
	name: "openscreen_get_editor_state",
	title: "Get editor state",
	description:
		"Return a summary of the editor: video path, duration, playhead, play state, current wallpaper/background, and counts of zoom/trim/speed/annotation regions. Requires the editor window to be open.",
	command: "get_editor_state",
});

bridgeTool({
	name: "openscreen_add_zoom",
	title: "Add zoom region",
	description:
		"Add a zoom region to the timeline over a time span (milliseconds), optionally focused on a normalized point (0..1). This is the same effect as an auto-zoom suggestion.",
	inputSchema: {
		startMs: z.number().min(0).describe("Zoom start time in milliseconds."),
		endMs: z.number().min(0).describe("Zoom end time in milliseconds."),
		focusX: z
			.number()
			.min(0)
			.max(1)
			.optional()
			.describe("Horizontal focus point, 0 (left) to 1 (right). Default 0.5."),
		focusY: z
			.number()
			.min(0)
			.max(1)
			.optional()
			.describe("Vertical focus point, 0 (top) to 1 (bottom). Default 0.5."),
	},
	command: "add_zoom",
});

bridgeTool({
	name: "openscreen_add_text_annotation",
	title: "Add text annotation",
	description:
		"Add a text annotation region over a time span (milliseconds). It is created with placeholder text and selected so the user can edit it in the editor.",
	inputSchema: {
		startMs: z.number().min(0).describe("Annotation start time in milliseconds."),
		endMs: z.number().min(0).describe("Annotation end time in milliseconds."),
	},
	command: "add_text_annotation",
});

bridgeTool({
	name: "openscreen_set_background",
	title: "Set background",
	description:
		"Set the editor background/wallpaper. Pass a wallpaper identifier, CSS color, or gradient string as used by OpenScreen's background picker.",
	inputSchema: {
		wallpaper: z.string().describe("Wallpaper identifier / color / gradient string."),
	},
	command: "set_background",
});

bridgeTool({
	name: "openscreen_undo",
	title: "Undo editor change",
	description: "Undo the last editor change (zoom/trim/annotation/background, etc.).",
	command: "undo",
});

bridgeTool({
	name: "openscreen_redo",
	title: "Redo editor change",
	description: "Redo the last undone editor change.",
	command: "redo",
});

bridgeTool({
	name: "openscreen_export",
	title: "Export video",
	description:
		"Begin exporting the current edit. NOTE: OpenScreen prompts the user for a save location, so this starts the export flow rather than writing a file silently. Format defaults to mp4.",
	inputSchema: {
		format: z.enum(["mp4", "gif"]).optional().describe("Export format. Default mp4."),
	},
	command: "export_video",
	timeoutMs: 30_000,
});

async function main(): Promise<void> {
	const transport = new StdioServerTransport();
	await server.connect(transport);
	// stderr is safe for logging — stdout is reserved for the JSON-RPC stream.
	console.error("openscreen-mcp-server running on stdio");
}

main().catch((error) => {
	console.error("Fatal error starting openscreen-mcp-server:", error);
	process.exit(1);
});
