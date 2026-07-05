import { readFile, writeFile } from "node:fs/promises";
import { type Server, createServer } from "node:net";
import { getPortFile } from "./paths.js";

/**
 * Default port for the daemon. Chosen to be unlikely to collide with
 * common application ports (e.g., 3000, 5000, 8000, 8080, 9000).
 */
export const DEFAULT_PORT = 17381;

/**
 * Try to bind a TCP server on the given port, then immediately close it.
 * Returns true if the port is unavailable (EADDRINUSE / EACCES).
 */
export async function isPortInUse(port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const server: Server = createServer();
		server.once("error", (err: NodeJS.ErrnoException) => {
			// Port is definitely in use if we get EADDRINUSE or EACCES
			if (err.code === "EADDRINUSE" || err.code === "EACCES") {
				resolve(true);
			} else {
				// For other errors we treat it as "in use" to be safe
				resolve(true);
			}
		});
		server.once("listening", () => {
			server.close();
			resolve(false);
		});
		server.listen(port, "127.0.0.1");
	});
}

/**
 * Find the first free port starting from `startPort` (defaults to DEFAULT_PORT),
 * scanning up to `startPort + maxAttempts` (defaults to 100).
 * Resolves with the first available port, or rejects if all ports in range are in use.
 */
export async function findFreePort(
	startPort: number = DEFAULT_PORT,
	maxAttempts = 100,
): Promise<number> {
	const maxPort = startPort + maxAttempts;
	for (let port = startPort; port < maxPort; port++) {
		const inUse = await isPortInUse(port);
		if (!inUse) {
			return port;
		}
	}
	throw new Error(
		`No free port found in range ${startPort}..${maxPort - 1} (${maxAttempts} ports scanned)`,
	);
}

/**
 * Persist the chosen daemon port to a file on disk.
 */
export async function reservePort(port: number, filePath: string = getPortFile()): Promise<void> {
	await writeFile(filePath, String(port), "utf-8");
}

/**
 * Read the previously-reserved port from a file on disk.
 * Returns the port number if found, or `null` if the file does not exist or is empty.
 */
export async function readReservedPort(filePath: string = getPortFile()): Promise<number | null> {
	try {
		const content = await readFile(filePath, "utf-8");
		const trimmed = content.trim();
		if (trimmed.length === 0) return null;
		const port = Number(trimmed);
		return Number.isFinite(port) && Number.isInteger(port) && port > 0 && port < 65536
			? port
			: null;
	} catch {
		// File does not exist or cannot be read
		return null;
	}
}
