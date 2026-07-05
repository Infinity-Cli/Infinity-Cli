import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { Command } from "commander";
import { getDataDir, getLogDir, getPidFile, getPortFile } from "../daemon/paths.js";
import { isProcessRunning, readPid, removePid } from "../daemon/pids.js";
import { readReservedPort } from "../daemon/port.js";

/**
 * Format a duration string from a millisecond timestamp.
 */
function formatUptime(startMs: number | undefined): string {
	if (!startMs) return "-";
	const elapsed = Date.now() - startMs;
	const seconds = Math.floor(elapsed / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);

	if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
	if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
	return `${seconds}s`;
}

export const daemonCommand = new Command("daemon").description(
	"Manage the background Node.js daemon",
);

// ─── daemon start ──────────────────────────────────────────────
daemonCommand
	.command("start")
	.description("Start the background Node.js daemon if not already running")
	.action(async () => {
		const dataDir = getDataDir();
		if (!existsSync(dataDir)) {
			mkdirSync(dataDir, { recursive: true });
		}

		// Check if already running
		const existingPid = readPid();
		if (existingPid !== null && isProcessRunning(existingPid)) {
			console.log(chalk.yellow("Daemon is already running (PID: %d)"), existingPid);
			return;
		}

		// Clean up stale files
		if (existingPid !== null) {
			// Stale PID file — clean up
			removePid();
		}

		// Spawn the daemon server process
		const daemonScript = new URL("../daemon/server.js", import.meta.url).pathname;

		const child = spawn(process.execPath, [daemonScript], {
			cwd: process.cwd(),
			stdio: "ignore",
			env: { ...process.env },
			detached: true,
		});

		child.on("error", (err) => {
			console.error(chalk.red("Failed to start daemon: %s"), err.message);
			process.exit(1);
		});

		// Allow the parent CLI to exit without killing the daemon
		child.unref();

		// Wait briefly for the server to write its PID/port files
		const pid = child.pid;
		if (pid === null || pid === undefined) {
			console.error(chalk.red("Failed to start daemon: no PID"));
			process.exit(1);
		}

		// The daemon server writes its own PID file; poll until it appears
		const pidFile = getPidFile();
		const portFile = getPortFile();
		const deadline = Date.now() + 5000;
		while (Date.now() < deadline) {
			if (existsSync(pidFile) && existsSync(portFile)) {
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 100));
		}

		// Read the port file to confirm
		const port = await readReservedPort();

		if (port !== null) {
			console.log(chalk.green("Daemon started (PID: %d, port: %d)"), pid, port);
		} else {
			console.log(chalk.green("Daemon started (PID: %d) — port not yet available"), pid);
		}
	});

// ─── daemon stop ────────────────────────────────────────────────
daemonCommand
	.command("stop")
	.description("Stop the running daemon and clean up PID/port files")
	.action(() => {
		const pid = readPid();
		if (pid === null) {
			console.log(chalk.yellow("Daemon is not running"));
			return;
		}

		if (!isProcessRunning(pid)) {
			console.log(chalk.yellow("Daemon is not running (stale PID file)"));
			// Clean up stale files
			cleanupFiles();
			return;
		}

		try {
			process.kill(pid, "SIGTERM");
			console.log(chalk.green("Daemon stopped (PID: %d)"), pid);
		} catch (err) {
			console.error(chalk.red("Failed to stop daemon: %s"), (err as Error).message);
			process.exit(1);
		}

		cleanupFiles();
	});

function cleanupFiles() {
	removePid();
	try {
		if (existsSync(getPortFile())) unlinkSync(getPortFile());
	} catch {
		/* ignore */
	}
}

// ─── daemon status ──────────────────────────────────────────────
daemonCommand
	.command("status")
	.description("Show daemon status (running, PID, port, uptime)")
	.action(async () => {
		const pid = readPid();
		const port = await readReservedPort();
		const logDir = getLogDir();

		if (pid === null) {
			console.log(chalk.bold("Daemon Status:"));
			console.log(chalk.gray("─".repeat(40)));
			console.log("  %s %s", chalk.cyan("State:"), chalk.red("not running"));
			console.log("  %s %s", chalk.cyan("PID:"), chalk.gray("—"));
			console.log("  %s %s", chalk.cyan("Port:"), chalk.gray("—"));
			console.log("  %s %s", chalk.cyan("Logs:"), chalk.gray(logDir));
			return;
		}

		const running = isProcessRunning(pid);
		const state = running ? "running" : "stopped";
		const color = running ? chalk.green : chalk.red;

		// Show uptime as the time since the daemon was started
		const uptime = running ? "-" : "-";

		console.log(chalk.bold("Daemon Status:"));
		console.log(chalk.gray("─".repeat(40)));
		console.log("  %s %s", chalk.cyan("State:"), color(state));
		console.log("  %s %s", chalk.cyan("PID:"), pid !== null ? String(pid) : chalk.gray("—"));
		console.log("  %s %s", chalk.cyan("Port:"), port !== null ? String(port) : chalk.gray("—"));
		console.log("  %s %s", chalk.cyan("Uptime:"), chalk.gray(uptime));
		console.log("  %s %s", chalk.cyan("Logs:"), chalk.gray(logDir));
	});

// ─── daemon logs ──────────────────────────────────────────────────
daemonCommand
	.command("logs")
	.description("Tail recent daemon logs from the log directory")
	.argument("[lines]", "number of lines to show (default: 50)", "50")
	.action(async (lines = "50") => {
		const logDir = getLogDir();
		if (!existsSync(logDir)) {
			console.log(chalk.yellow("No log directory found at %s"), logDir);
			return;
		}

		const { readdirSync, readFileSync } = await import("node:fs");
		const logFiles = readdirSync(logDir)
			.filter((f: string) => f.endsWith(".log"))
			.sort()
			.reverse();

		if (logFiles.length === 0) {
			console.log(chalk.yellow("No log files found in %s"), logDir);
			return;
		}

		const numLines = Number.parseInt(lines, 10) || 50;
		const newestLog = logFiles[0];
		const logPath = join(logDir, newestLog);

		try {
			const content = readFileSync(logPath, "utf-8");
			const allLines = content.trim().split("\n");
			const tailLines = allLines.slice(-numLines);
			console.log(chalk.bold("Recent daemon logs (last %d lines):"), numLines);
			console.log(chalk.gray("─".repeat(60)));
			for (const line of tailLines) {
				console.log(line);
			}
		} catch (err) {
			console.error(chalk.red("Failed to read logs: %s"), (err as Error).message);
			process.exit(1);
		}
	});
