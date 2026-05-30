/**
 * Renderer-side automation command bus.
 *
 * The Electron main process forwards automation commands (originating from the
 * MCP server) on the `automation:command` channel. This module maintains a
 * registry of handlers and replies on `automation:result`.
 *
 * Each BrowserWindow has its own renderer context and therefore its own
 * registry. Main dispatches a command to windows one at a time; a window that
 * has no handler for a command replies `{ unhandled: true }` so main moves on
 * to the next window. This keeps every command running exactly once.
 */

export type AutomationHandler = (args: Record<string, unknown>) => Promise<unknown> | unknown;

const registry = new Map<string, AutomationHandler>();
let initialized = false;

function ensureInitialized(): void {
	if (initialized) return;
	const api = window.electronAPI;
	if (!api?.onAutomationCommand || !api?.sendAutomationResult) {
		// Preload not present (e.g. unit tests) — nothing to wire.
		return;
	}
	initialized = true;

	api.onAutomationCommand(async ({ id, command, args }) => {
		const handler = registry.get(command);
		if (!handler) {
			api.sendAutomationResult({ id, unhandled: true });
			return;
		}
		try {
			const result = await handler(args ?? {});
			api.sendAutomationResult({ id, ok: true, result });
		} catch (error) {
			api.sendAutomationResult({
				id,
				ok: false,
				error: error instanceof Error ? error.message : String(error),
			});
		}
	});
}

/**
 * Initialize the bus listener. Safe to call multiple times and in any window;
 * call it once near app startup so every window can answer automation commands.
 */
export function initAutomationBus(): void {
	ensureInitialized();
}

/**
 * Register a set of automation actions. Returns a disposer that removes exactly
 * the handlers it added (so a remounting component can't clobber another's).
 */
export function registerAutomationActions(actions: Record<string, AutomationHandler>): () => void {
	ensureInitialized();
	const entries = Object.entries(actions);
	for (const [name, handler] of entries) {
		registry.set(name, handler);
	}
	return () => {
		for (const [name, handler] of entries) {
			if (registry.get(name) === handler) {
				registry.delete(name);
			}
		}
	};
}

/** Test/introspection helper: list currently registered command names. */
export function registeredAutomationCommands(): string[] {
	return [...registry.keys()];
}
