import { useAutomationActions } from "./useAutomationActions";

/**
 * Imperative surface the video editor exposes to the automation bus. The editor
 * component builds this object from its existing callbacks/state and passes it
 * here; this hook handles argument parsing and registration.
 */
export interface EditorAutomationApi {
	/** Snapshot summary of the editor for the agent to reason about. */
	getState: () => Record<string, unknown>;
	/** Add a zoom region over [startMs, endMs] focused at (focusX, focusY) in 0..1. */
	addZoom: (startMs: number, endMs: number, focusX: number, focusY: number) => void;
	/** Add a placeholder text annotation over [startMs, endMs]. */
	addTextAnnotation: (startMs: number, endMs: number) => void;
	/** Set the editor background/wallpaper. */
	setBackground: (wallpaper: string) => void;
	/** Undo the last editor change. */
	undo: () => void;
	/** Redo the last undone editor change. */
	redo: () => void;
	/** Begin the export flow (prompts the user for a save location). */
	exportVideo: (format: "mp4" | "gif") => void;
}

function num(value: unknown, name: string): number {
	const n = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(n)) {
		throw new Error(`Expected numeric "${name}".`);
	}
	return n;
}

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

/**
 * Register editor-only automation commands. Only active while the editor is
 * mounted; other windows reply "unhandled" so the bridge routes editor commands
 * here automatically.
 */
export function useEditorAutomation(api: EditorAutomationApi, enabled = true): void {
	useAutomationActions(
		{
			get_editor_state: () => api.getState(),

			add_zoom: (args) => {
				const startMs = num(args.startMs, "startMs");
				const endMs = num(args.endMs, "endMs");
				if (endMs <= startMs) {
					throw new Error("add_zoom requires endMs > startMs.");
				}
				const focusX = args.focusX === undefined ? 0.5 : clamp01(num(args.focusX, "focusX"));
				const focusY = args.focusY === undefined ? 0.5 : clamp01(num(args.focusY, "focusY"));
				api.addZoom(startMs, endMs, focusX, focusY);
				return { ok: true, startMs, endMs, focusX, focusY };
			},

			add_text_annotation: (args) => {
				const startMs = num(args.startMs, "startMs");
				const endMs = num(args.endMs, "endMs");
				if (endMs <= startMs) {
					throw new Error("add_text_annotation requires endMs > startMs.");
				}
				api.addTextAnnotation(startMs, endMs);
				return { ok: true, startMs, endMs };
			},

			set_background: (args) => {
				const wallpaper = String(args.wallpaper ?? "");
				if (!wallpaper) {
					throw new Error("set_background requires a 'wallpaper' value.");
				}
				api.setBackground(wallpaper);
				return { ok: true, wallpaper };
			},

			undo: () => {
				api.undo();
				return { ok: true };
			},

			redo: () => {
				api.redo();
				return { ok: true };
			},

			export_video: (args) => {
				const format = args.format === "gif" ? "gif" : "mp4";
				api.exportVideo(format);
				return {
					ok: true,
					started: true,
					format,
					note: "Export started. OpenScreen will prompt for a save location; progress is shown in the app.",
				};
			},
		},
		enabled,
	);
}
