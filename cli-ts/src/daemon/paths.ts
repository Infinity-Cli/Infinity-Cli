import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const isWindows = process.platform === "win32";

/**
 * Returns the data directory for daemon state files.
 * - Windows: %LOCALAPPDATA%\infinity-cli
 * - Linux/macOS: ~/.local/share/infinity-cli
 */
export function getDataDir(): string {
	if (isWindows) {
		const localAppData = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
		return join(localAppData, "infinity-cli");
	}
	return join(homedir(), ".local", "share", "infinity-cli");
}

/**
 * Returns the log directory under the data directory.
 */
export function getLogDir(): string {
	return join(getDataDir(), "logs");
}

/**
 * Returns the full path to the PID file.
 */
export function getPidFile(): string {
	return join(getDataDir(), "infinity.pid");
}

/**
 * Returns the full path to the port file (stores the port the server is listening on).
 */
export function getPortFile(): string {
	return join(getDataDir(), "infinity.port");
}

/**
 * Returns the path for inter-process communication.
 * - Unix: a Unix domain socket under the data directory
 * - Windows: a named pipe path
 */
export function getSocketPath(): string {
	if (isWindows) {
		return "\\\\.\\pipe\\infinity-cli";
	}
	return join(getDataDir(), "infinity-cli.sock");
}
