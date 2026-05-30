import { useEffect, useRef } from "react";
import { type AutomationHandler, registerAutomationActions } from "./automationBus";

/**
 * Register a set of automation command handlers for the lifetime of the calling
 * component. Handlers are wrapped so they always call through to the latest
 * closure, which means callers can pass freshly-created functions on every
 * render without re-registering (and without going stale).
 *
 * @param actions   Map of command name -> handler.
 * @param enabled   When false, nothing is registered (e.g. before the editor
 *                  is ready). Defaults to true.
 */
export function useAutomationActions(
	actions: Record<string, AutomationHandler>,
	enabled = true,
): void {
	const latest = useRef(actions);
	latest.current = actions;

	// The set of command *names* is what determines registration identity.
	const names = Object.keys(actions).sort().join(",");

	useEffect(() => {
		if (!enabled) return;
		const commandNames = names ? names.split(",") : [];
		const wrapped: Record<string, AutomationHandler> = {};
		for (const name of commandNames) {
			wrapped[name] = (args) => {
				const handler = latest.current[name];
				if (!handler) {
					throw new Error(`Automation handler "${name}" is no longer available.`);
				}
				return handler(args);
			};
		}
		const dispose = registerAutomationActions(wrapped);
		return dispose;
	}, [names, enabled]);
}
