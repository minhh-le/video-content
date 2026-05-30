import { randomBytes, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";

/**
 * OpenScreen automation bridge.
 *
 * When the app is launched with OPENSCREEN_AUTOMATION=1, this starts a tiny
 * HTTP server bound to 127.0.0.1 that an external MCP server can POST commands
 * to. Each command is forwarded to the renderer windows (which hold the real
 * recording/editor logic) over the `automation:command` IPC channel; the
 * renderer replies on `automation:result`.
 *
 * Security model: loopback-only + a bearer token. The token (and chosen port)
 * are written to <userData>/automation.json so a locally-running MCP server can
 * read them. This is intended for local, single-user automation only.
 */

const DEFAULT_PORT = 8769;
const RESULT_CHANNEL = "automation:result";
const COMMAND_CHANNEL = "automation:command";

interface RendererResult {
	id: string;
	ok?: boolean;
	result?: unknown;
	error?: string;
	unhandled?: boolean;
}

interface BridgeHandle {
	close: () => void;
	port: number;
	token: string;
}

let activeServer: Server | null = null;

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json",
		"content-length": Buffer.byteLength(payload),
	});
	res.end(payload);
}

/**
 * Send one command to a single window and await its result (handled, or
 * explicitly unhandled, or timeout).
 */
function sendToWindow(
	window: BrowserWindow,
	command: string,
	args: Record<string, unknown>,
	timeoutMs: number,
): Promise<RendererResult> {
	return new Promise((resolve) => {
		if (window.isDestroyed()) {
			resolve({ id: "", unhandled: true });
			return;
		}
		const id = randomUUID();
		let done = false;

		const finish = (value: RendererResult) => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			ipcMain.removeListener(RESULT_CHANNEL, onResult);
			resolve(value);
		};

		const onResult = (_event: unknown, payload: RendererResult) => {
			if (!payload || payload.id !== id) return;
			finish(payload);
		};

		const timer = setTimeout(() => finish({ id, unhandled: true }), timeoutMs);

		ipcMain.on(RESULT_CHANNEL, onResult);
		try {
			window.webContents.send(COMMAND_CHANNEL, { id, command, args });
		} catch {
			finish({ id, unhandled: true });
		}
	});
}

/**
 * Dispatch a command to renderer windows in priority order. The first window
 * that has a handler for the command wins; windows without a handler reply
 * `unhandled` so we move on. This guarantees each command runs exactly once,
 * even though every window receives it.
 */
async function dispatch(
	command: string,
	args: Record<string, unknown>,
	timeoutMs: number,
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
	const all = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed());
	if (all.length === 0) {
		return { ok: false, error: "No OpenScreen window is open." };
	}

	// Prefer the focused window, then the rest (editor windows tend to hold the
	// richer command set, but focus is the best signal for "where the user is").
	const focused = BrowserWindow.getFocusedWindow();
	const ordered =
		focused && !focused.isDestroyed() ? [focused, ...all.filter((w) => w !== focused)] : all;

	for (const window of ordered) {
		const result = await sendToWindow(window, command, args, timeoutMs);
		if (result.unhandled) {
			continue;
		}
		return result.ok
			? { ok: true, result: result.result }
			: { ok: false, error: result.error ?? "Command failed." };
	}

	return {
		ok: false,
		error: `No open window handled the command "${command}". (Editor commands need the editor window; recording commands need the HUD.)`,
	};
}

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		req.on("data", (chunk: Buffer) => {
			size += chunk.length;
			// Cap body size to avoid unbounded memory use from a stray client.
			if (size > 1_000_000) {
				reject(new Error("Request body too large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});
}

export function startAutomationBridge(): BridgeHandle | null {
	if (process.env.OPENSCREEN_AUTOMATION !== "1") {
		return null;
	}
	if (activeServer) {
		// Already running.
		return null;
	}

	const port = process.env.OPENSCREEN_AUTOMATION_PORT
		? Number.parseInt(process.env.OPENSCREEN_AUTOMATION_PORT, 10) || DEFAULT_PORT
		: DEFAULT_PORT;
	const token = process.env.OPENSCREEN_AUTOMATION_TOKEN || randomBytes(24).toString("hex");

	const server = createServer((req, res) => {
		void (async () => {
			try {
				if (req.method === "GET" && req.url === "/health") {
					jsonResponse(res, 200, { ok: true, name: "openscreen-automation-bridge", port });
					return;
				}

				if (req.method !== "POST" || req.url !== "/command") {
					jsonResponse(res, 404, { ok: false, error: "Not found" });
					return;
				}

				const authHeader = req.headers.authorization ?? "";
				const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
				if (provided !== token) {
					jsonResponse(res, 401, { ok: false, error: "Unauthorized" });
					return;
				}

				const raw = await readBody(req);
				let parsed: { command?: string; args?: Record<string, unknown> };
				try {
					parsed = raw ? JSON.parse(raw) : {};
				} catch {
					jsonResponse(res, 400, { ok: false, error: "Invalid JSON body" });
					return;
				}

				const command = parsed.command;
				if (!command || typeof command !== "string") {
					jsonResponse(res, 400, { ok: false, error: "Missing 'command'" });
					return;
				}

				const args = (parsed.args ?? {}) as Record<string, unknown>;
				const result = await dispatch(command, args, 180_000);
				jsonResponse(res, 200, result);
			} catch (error) {
				jsonResponse(res, 500, {
					ok: false,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		})();
	});

	server.on("error", (error) => {
		console.error("[automation-bridge] server error:", error);
	});

	server.listen(port, "127.0.0.1", () => {
		console.log(`[automation-bridge] listening on http://127.0.0.1:${port}`);
		try {
			const configPath = join(app.getPath("userData"), "automation.json");
			writeFileSync(configPath, JSON.stringify({ port, token }, null, 2), { mode: 0o600 });
			console.log(`[automation-bridge] wrote connection info to ${configPath}`);
		} catch (error) {
			console.error("[automation-bridge] failed to write automation.json:", error);
		}
	});

	activeServer = server;

	return {
		port,
		token,
		close: () => {
			server.close();
			activeServer = null;
		},
	};
}
