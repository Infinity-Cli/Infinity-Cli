import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { type Server, createServer } from "node:http";
import { getDataDir, getLogDir, getPidFile, getPortFile } from "./paths.js";
import { findFreePort, reservePort } from "./port.js";

/**
 * The Node.js daemon server.
 * Starts an HTTP control API on the chosen port.
 * - GET /health returns { status: "ok" }
 *
 * This is the minimal server spawned by `daemon start`.
 */

export interface DaemonServerOptions {
	/** Port to listen on. Default: auto-find from port.ts */
	port?: number;
	/** Host to bind to. Default: 127.0.0.1 */
	host?: string;
}

export async function startDaemonServer(options: DaemonServerOptions = {}): Promise<{
	server: Server;
	port: number;
}> {
	const dataDir = getDataDir();
	if (!existsSync(dataDir)) {
		mkdirSync(dataDir, { recursive: true });
	}
	const logDir = getLogDir();
	if (!existsSync(logDir)) {
		mkdirSync(logDir, { recursive: true });
	}

	// Find a free port
	const port = options.port ?? (await findFreePort());

	// Persist the port
	await reservePort(port);
	writeFileSync(getPortFile(), String(port), "utf-8");

	const host = options.host ?? "127.0.0.1";

	const server = createServer((req, res) => {
		// Parse the URL
		const url = new URL(req.url ?? "/", `http://${req.headers.host ?? host}`);

		if (url.pathname === "/health" && req.method === "GET") {
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ status: "ok" }));
			return;
		}

		// Default: 404
		res.writeHead(404, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ error: "not found" }));
	});

	return new Promise((resolve, reject) => {
		server.once("error", reject);

		server.listen(port, host, () => {
			// Write PID file
			writeFileSync(getPidFile(), String(process.pid), "utf-8");

			resolve({ server, port });
		});
	});
}

/**
 * Stop the daemon server by reading the PID file and killing the process.
 */
export function stopDaemonServer(): void {
	const pidFile = getPidFile();
	if (!existsSync(pidFile)) {
		// Already stopped
		return;
	}

	const pidStr = readFileSync(pidFile, "utf-8").trim();
	if (!pidStr) {
		return;
	}

	const pid = Number(pidStr);
	if (!Number.isFinite(pid)) {
		return;
	}

	try {
		process.kill(pid, "SIGTERM");
	} catch {
		// Process already dead — that's fine
	}

	// Clean up files
	try {
		if (existsSync(pidFile)) {
			unlinkSync(pidFile);
		}
	} catch {
		// ignore
	}
	try {
		const portFile = getPortFile();
		if (existsSync(portFile)) {
			unlinkSync(portFile);
		}
	} catch {
		// ignore
	}
}
