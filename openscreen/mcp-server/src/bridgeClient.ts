import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Connection details for the OpenScreen automation bridge (a loopback HTTP
 * server that runs inside the Electron main process when the app is launched
 * with OPENSCREEN_AUTOMATION=1).
 *
 * Resolution order:
 *   1. Explicit env vars OPENSCREEN_AUTOMATION_PORT / OPENSCREEN_AUTOMATION_TOKEN.
 *   2. A JSON config file the app writes on startup, located via
 *      OPENSCREEN_AUTOMATION_CONFIG or the default per-OS userData path.
 */
export interface BridgeConnection {
	port: number;
	token: string;
}

interface BridgeConfigFile {
	port?: number;
	token?: string;
}

const DEFAULT_PORT = 8769;

function candidateConfigPaths(): string[] {
	const explicit = process.env.OPENSCREEN_AUTOMATION_CONFIG;
	if (explicit) {
		return [explicit];
	}

	const home = homedir();
	const fileName = "automation.json";
	// Electron derives userData from the app name; OpenScreen ships as "openscreen".
	const appNames = ["openscreen", "OpenScreen"];
	const roots: string[] = [];

	if (process.platform === "darwin") {
		for (const name of appNames) {
			roots.push(join(home, "Library", "Application Support", name));
		}
	} else if (process.platform === "win32") {
		const appData = process.env.APPDATA ?? join(home, "AppData", "Roaming");
		for (const name of appNames) {
			roots.push(join(appData, name));
		}
	} else {
		const xdg = process.env.XDG_CONFIG_HOME ?? join(home, ".config");
		for (const name of appNames) {
			roots.push(join(xdg, name));
		}
	}

	return roots.map((root) => join(root, fileName));
}

function readConfigFile(): BridgeConfigFile | null {
	for (const path of candidateConfigPaths()) {
		try {
			const raw = readFileSync(path, "utf8");
			return JSON.parse(raw) as BridgeConfigFile;
		} catch {
			// Try the next candidate.
		}
	}
	return null;
}

export function resolveBridgeConnection(): BridgeConnection {
	const envPort = process.env.OPENSCREEN_AUTOMATION_PORT;
	const envToken = process.env.OPENSCREEN_AUTOMATION_TOKEN;

	let port = envPort ? Number.parseInt(envPort, 10) : Number.NaN;
	let token = envToken ?? "";

	if (!token || Number.isNaN(port)) {
		const fromFile = readConfigFile();
		if (fromFile) {
			if (Number.isNaN(port) && typeof fromFile.port === "number") {
				port = fromFile.port;
			}
			if (!token && typeof fromFile.token === "string") {
				token = fromFile.token;
			}
		}
	}

	if (Number.isNaN(port)) {
		port = DEFAULT_PORT;
	}

	return { port, token };
}

export interface BridgeResult<T = unknown> {
	ok: boolean;
	result?: T;
	error?: string;
}

export class BridgeClient {
	private connection: BridgeConnection;

	constructor(connection: BridgeConnection = resolveBridgeConnection()) {
		this.connection = connection;
	}

	/** Re-read connection details (token/port may have changed if the app restarted). */
	refresh(): void {
		this.connection = resolveBridgeConnection();
	}

	private baseUrl(): string {
		return `http://127.0.0.1:${this.connection.port}`;
	}

	async health(): Promise<BridgeResult> {
		try {
			const res = await fetch(`${this.baseUrl()}/health`, { method: "GET" });
			const body = (await res.json()) as BridgeResult;
			return body;
		} catch (error) {
			return {
				ok: false,
				error: `Cannot reach OpenScreen automation bridge at ${this.baseUrl()}. Is the app running with OPENSCREEN_AUTOMATION=1? (${
					error instanceof Error ? error.message : String(error)
				})`,
			};
		}
	}

	/**
	 * Send a command to the bridge. Returns a normalized result object; never
	 * throws for protocol-level failures so tool handlers can surface a clean
	 * message to the agent.
	 */
	async command<T = unknown>(
		command: string,
		args: Record<string, unknown> = {},
		timeoutMs = 180_000,
	): Promise<BridgeResult<T>> {
		if (!this.connection.token) {
			return {
				ok: false,
				error:
					"No automation token found. Launch OpenScreen with OPENSCREEN_AUTOMATION=1, or set OPENSCREEN_AUTOMATION_TOKEN / OPENSCREEN_AUTOMATION_PORT.",
			};
		}

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const res = await fetch(`${this.baseUrl()}/command`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					authorization: `Bearer ${this.connection.token}`,
				},
				body: JSON.stringify({ command, args }),
				signal: controller.signal,
			});

			if (res.status === 401) {
				return {
					ok: false,
					error:
						"Automation bridge rejected the token (401). Restart the MCP server after relaunching OpenScreen so it picks up the current token.",
				};
			}

			const body = (await res.json()) as BridgeResult<T>;
			return body;
		} catch (error) {
			if (error instanceof Error && error.name === "AbortError") {
				return { ok: false, error: `Command "${command}" timed out after ${timeoutMs}ms.` };
			}
			return {
				ok: false,
				error: `Failed to reach the automation bridge: ${
					error instanceof Error ? error.message : String(error)
				}. Is OpenScreen running with OPENSCREEN_AUTOMATION=1?`,
			};
		} finally {
			clearTimeout(timer);
		}
	}
}
