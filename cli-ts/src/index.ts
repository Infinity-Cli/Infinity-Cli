#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import chalk from "chalk";
import { Command } from "commander";
import dotenv from "dotenv";
import { askCommand } from "./commands/ask.js";
import { bridgeCommand } from "./commands/bridge.js";
import { configCommand } from "./commands/config.js";
import { daemonCommand } from "./commands/daemon.js";
import { historyCommand } from "./commands/history.js";
import { indexCommand } from "./commands/index.js";
import { onboardCommand } from "./commands/onboard.js";
import { runCommand } from "./commands/run.js";
import { searchCommand } from "./commands/search.js";
import { summarizeCommand } from "./commands/summarize.js";
import { updateCommand } from "./commands/update.js";
import { getDataDir } from "./daemon/paths.js";
import { isProcessRunning, readPid, writePid } from "./daemon/pids.js";
import { readReservedPort } from "./daemon/port.js";
import { launchInteractive } from "./launcher.js";

dotenv.config();

const program = new Command();

program
	.name("infinity")
	.description("Autonomous coding CLI")
	.version("0.1.0")
	.option("-c, --config <path>", "path to a custom config file")
	.addCommand(askCommand)
	.addCommand(bridgeCommand)
	.addCommand(configCommand)
	.addCommand(historyCommand)
	.addCommand(indexCommand)
	.addCommand(runCommand)
	.addCommand(searchCommand)
	.addCommand(daemonCommand)
	.addCommand(summarizeCommand)
	.addCommand(onboardCommand)
	.addCommand(updateCommand);

program.action(async () => {
	try {
		await ensureDaemonRunning();
		await launchInteractive();
	} catch (err) {
		console.error(chalk.red("Failed to start daemon: %s"), (err as Error).message);
		program.outputHelp();
		process.exitCode = 1;
	}
});

await program.parseAsync();

/**
 * Ensure the background daemon is running.
 * If it is already running, print its status. Otherwise, spawn it and wait
 * briefly for it to become ready.
 */
async function ensureDaemonRunning(): Promise<void> {
	const dataDir = getDataDir();
	if (!existsSync(dataDir)) {
		mkdirSync(dataDir, { recursive: true });
	}

	const existingPid = readPid();
	if (existingPid !== null && isProcessRunning(existingPid)) {
		const port = await readReservedPort();
		if (port !== null) {
			console.log(chalk.green("Daemon is already running (PID: %d, port: %d)"), existingPid, port);
		} else {
			console.log(chalk.green("Daemon is already running (PID: %d)"), existingPid);
		}
		return;
	}

	const runningTs = import.meta.url.endsWith(".ts");
	const daemonScript = new URL(
		runningTs ? "./daemon/server.ts" : "./daemon/server.js",
		import.meta.url,
	).pathname;
	const isWindows = process.platform === "win32";

	const child = spawn(process.execPath, [daemonScript], {
		cwd: process.cwd(),
		stdio: ["ignore", "ignore", "ignore"],
		env: { ...process.env },
		detached: !isWindows,
	});

	if (!isWindows && child.pid) {
		child.unref();
	}

	const pid = child.pid;
	if (pid === null || pid === undefined) {
		throw new Error("no PID returned from spawned daemon");
	}

	// Write PID optimistically; the daemon will overwrite it with its own PID.
	writePid(pid);

	const started = await waitForDaemonReady(pid, 5000);
	if (!started) {
		throw new Error("daemon did not become ready within 5 seconds");
	}

	const port = await readReservedPort();
	if (port !== null) {
		console.log(chalk.green("Daemon started (PID: %d, port: %d)"), pid, port);
	} else {
		console.log(chalk.green("Daemon started (PID: %d)"), pid);
	}
}

/**
 * Poll until the daemon process is running and has written its port file.
 * Resolves true if ready, false if the timeout expires first.
 */
async function waitForDaemonReady(pid: number, timeoutMs: number): Promise<boolean> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (isProcessRunning(pid)) {
			const port = await readReservedPort();
			if (port !== null) {
				return true;
			}
		}
		await sleep(100);
	}
	return false;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
