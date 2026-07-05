import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import chalk from "chalk";
import { showSplash } from "./ui/logo.js";

/**
 * Launch the interactive mode after the daemon is ready.
 *
 * Shows the splash animation, then enters a read-eval-print loop
 * where the user can type tasks or `exit`/`quit` to leave.
 */
export async function launchInteractive(): Promise<void> {
	await showSplash();

	// Clear any residual output from the splash
	stdout.write("\n");

	if (!stdin.isTTY) {
		// Non-interactive — just print a message and return
		console.log(chalk.cyan("Infinity CLI — ready for piped input"));
		return;
	}

	const rl = createInterface({
		input: stdin,
		output: stdout,
		terminal: true,
		prompt: chalk.green("infinity> "),
	});

	rl.prompt();

	for await (const line of rl) {
		const trimmed = line.trim();

		if (trimmed === "") {
			rl.prompt();
			continue;
		}

		const lower = trimmed.toLowerCase();

		if (lower === "exit" || lower === "quit" || lower === "q") {
			console.log(chalk.yellow("Goodbye!"));
			rl.close();
			break;
		}

		if (lower.startsWith("run ")) {
			const task = trimmed.slice(4).trim();
			if (task) {
				// Future: delegate to the run command's action logic
				console.log(chalk.cyan("Running: %s"), task);
			} else {
				console.log(chalk.yellow("Usage: run <task> — describe what to do"));
			}
		} else {
			console.log(chalk.cyan("Running: %s"), trimmed);
		}

		rl.prompt();
	}
}

/**
 * Shorthand for running a single ad-hoc task from the command line.
 * Used when `infinity run <task>` is invoked directly.
 *
 * @param task - The task description
 */
export async function runTask(task: string): Promise<void> {
	await showSplash(1000); // shorter splash for direct invocations
	console.log(chalk.cyan("Running: %s"), task);
}
