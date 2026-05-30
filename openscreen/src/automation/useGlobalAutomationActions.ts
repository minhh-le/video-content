import { useAutomationActions } from "./useAutomationActions";

/**
 * Automation actions that any window can service because they only call through
 * to the main process via `window.electronAPI`. Registered once at the app root
 * so they are available regardless of which window the agent is driving.
 */
export function useGlobalAutomationActions(): void {
	useAutomationActions({
		get_platform: async () => {
			const platform = await window.electronAPI.getPlatform();
			return { platform };
		},

		list_sources: async () => {
			const sources = await window.electronAPI.getSources({
				types: ["screen", "window"],
			});
			// Strip thumbnails / icons — they are large base64 data URLs.
			return {
				sources: sources.map((s) => ({
					id: s.id,
					name: s.name,
					display_id: s.display_id,
				})),
			};
		},

		select_source: async (args) => {
			const sourceId = String(args.sourceId ?? "");
			if (!sourceId) {
				throw new Error("select_source requires a 'sourceId'.");
			}
			const sources = await window.electronAPI.getSources({
				types: ["screen", "window"],
			});
			const match = sources.find((s) => s.id === sourceId);
			if (!match) {
				throw new Error(`No capture source found with id "${sourceId}".`);
			}
			const selected = await window.electronAPI.selectSource(match);
			return {
				selected: selected ? { id: selected.id, name: selected.name } : null,
			};
		},

		open_source_selector: async () => {
			return await window.electronAPI.openSourceSelector();
		},

		switch_to_editor: async () => {
			await window.electronAPI.switchToEditor();
			return { ok: true };
		},

		switch_to_hud: async () => {
			await window.electronAPI.switchToHud();
			return { ok: true };
		},

		start_new_recording: async () => {
			return await window.electronAPI.startNewRecording();
		},

		get_current_video_path: async () => {
			return await window.electronAPI.getCurrentVideoPath();
		},

		get_current_recording_session: async () => {
			return await window.electronAPI.getCurrentRecordingSession();
		},

		reveal_in_folder: async (args) => {
			const filePath = String(args.path ?? "");
			if (!filePath) {
				throw new Error("reveal_in_folder requires a 'path'.");
			}
			return await window.electronAPI.revealInFolder(filePath);
		},

		load_project: async () => {
			return await window.electronAPI.loadProjectFile();
		},
	});
}
