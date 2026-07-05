import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { getPidFile } from "./paths.js";

/**
 * Read the daemon PID file and return the PID if valid.
 */
export function readPid(): number | null {
	const pidFile = getPidFile();
	if (!existsSync(pidFile)) return null;
	const content = readFileSync(pidFile, "utf-8").trim();
	if (!content) return null;
	const pid = Number(content);
	return Number.isFinite(pid) && pid > 0 ? pid : null;
}

/**
 * Write the daemon PID file.
 */
export function writePid(pid: number): void {
	writeFileSync(getPidFile(), String(pid), "utf-8");
}

/**
 * Remove the daemon PID file if it exists.
 */
export function removePid(): void {
	try {
		if (existsSync(getPidFile())) unlinkSync(getPidFile());
	} catch {
		// ignore
	}
}

/**
 * Check if a given PID is currently running.
 */
export function isProcessRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
