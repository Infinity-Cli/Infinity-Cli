import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { stdin as stdinInput, stdout as stdoutOutput } from "node:process";
import { createInterface } from "node:readline/promises";
import { Command } from "commander";
import { readConfig } from "../config.js";
import { MemoryManager } from "../memory/manager.js";
import { createBridgeExecutor } from "../orchestrator/bridge-executor.js";
import { Planner } from "../orchestrator/planner.js";
import { Scheduler } from "../orchestrator/scheduler.js";
import type { Plan, Task } from "../orchestrator/types.js";
import { StreamingUI } from "../ui/streaming.js";

export const runCommand = new Command("run")
	.description("Run an autonomous coding task")
	.argument("[goal...]", "the coding task goal")
	.option("--repo <path>", "repository path (default: current directory)", ".")
	.option("--plan", "print plan and exit without executing")
	.option("--yes", "auto-confirm execution without prompting")
	.option("--max-agents <number>", "maximum concurrent agents (default: 3)", "3")
	.option("--dry-run", "plan, schedule, and simulate execution without calling runtime")
	.option("--session <id>", 'session ID (default: "default")', "default")
	.option("--output <format>", "output format (pretty, markdown, json)", "pretty")
	.allowExcessArguments(false)
	.action(async (goalParts: string[], options) => {
		const goal = goalParts.length > 0 ? goalParts.join(" ") : undefined;
		const outputFormat = ["pretty", "markdown", "json"].includes(options.output)
			? (options.output as "pretty" | "markdown" | "json")
			: "pretty";
		// Markdown mode is used for previews; treat it as a dry-run so it does
		// not require a running Python bridge.
		const isDryRun = options.dryRun || outputFormat === "markdown";
		const ui = new StreamingUI(outputFormat);
		const isAutoConfirm = options.yes;

		try {
			await ui.start("Initializing...");

			// 1. Read config
			const config = readConfig();

			// 2. Resolve repo path
			const repoPath = resolve(options.repo ?? ".");

			// 3. Create MemoryManager
			const memory = new MemoryManager();

			// 4. Ensure session exists
			const sessionId = options.session;
			let session = memory.getSession(sessionId);
			if (!session) {
				const title = goal ? goal.slice(0, 100) : "Untitled session";
				session = memory.createSession(title);
			}

			// 5. Add user message
			if (goal) {
				memory.addMessage(sessionId, "user", goal);
			}

			// 6. Validate goal
			if (!goal) {
				await ui.fail("Goal is required");
				// eslint-disable-next-line no-console
				console.error("Error: Goal argument is required");
				process.exit(1);
			}

			// 7. Generate plan
			await ui.update("Generating plan...");
			const planner = new Planner({ maxRetries: 2 });
			const plan = await planner.plan(goal);
			ui.log("info", `Plan generated with ${plan.tasks.length} tasks`);
			await ui.succeed("Plan generated");

			// 8. If --plan, print and exit
			if (options.plan) {
				if (outputFormat === "markdown") {
					ui.log("info", `Goal: ${goal}`);
					ui.log("info", `Tasks: ${plan.tasks.length}`);
					for (const task of plan.tasks) {
						ui.log("info", `${task.role} - ${task.description}`);
					}
					ui.renderSummary({
						goal,
						completed: 0,
						failed: 0,
						skipped: 0,
						total: plan.tasks.length,
					});
					console.log(ui.getOutput());
				} else {
					console.log();
					// eslint-disable-next-line no-console
					console.log("Execution Plan");
					// eslint-disable-next-line no-console
					console.log("=".repeat(60));
					// eslint-disable-next-line no-console
					console.log(`Goal: ${goal}`);
					// eslint-disable-next-line no-console
					console.log(`Tasks: ${plan.tasks.length}`);
					console.log();

					for (let i = 0; i < plan.tasks.length; i++) {
						const task = plan.tasks[i];
						const deps =
							task.dependencies.length > 0 ? ` (depends on: ${task.dependencies.join(", ")})` : "";
						// eslint-disable-next-line no-console
						console.log(
							`${(i + 1).toString().padStart(2)}. ${task.role} - ${task.description}${deps}`,
						);
						// eslint-disable-next-line no-console
						console.log(`    ID: ${task.id}`);
					}
					console.log();
				}
				return;
			}

			// 9. Confirm execution
			const maxAgents = Number.parseInt(options.maxAgents, 10);

			if (!isAutoConfirm && !isDryRun && stdinInput.isTTY) {
				const rl = createInterface({ input: stdinInput, output: stdoutOutput });
				const answer = await rl.question(`Execute plan with ${plan.tasks.length} tasks? (y/N) `);
				rl.close();

				if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
					ui.log("warn", "Aborted");
					return;
				}
			}

			// 10. Create scheduler and execute
			const checkpointDir = join(homedir(), ".infinity", "checkpoints");

			let completedCount = 0;
			let failedCount = 0;
			let skippedCount = 0;

			const scheduler = new Scheduler(plan, {
				concurrency: maxAgents,
				checkpointDir,
				onTaskUpdate: (task: Task, event: string) => {
					if (event === "started") {
						memory.addLog(sessionId, "info", `Task started: ${task.role} - ${task.description}`);
						ui.log("info", `Task started: ${task.role} - ${task.description}`);
					} else if (event === "completed") {
						memory.addLog(sessionId, "info", `Task completed: ${task.role} - ${task.description}`);
						ui.log("info", `Task completed: ${task.role} - ${task.description}`);
						completedCount++;
					} else if (event === "failed") {
						memory.addLog(sessionId, "error", `Task failed: ${task.role} - ${task.description}`);
						ui.log("error", `Task failed: ${task.role} - ${task.description}`);
						failedCount++;
					} else if (event === "skipped") {
						memory.addLog(sessionId, "warn", `Task skipped: ${task.role} - ${task.description}`);
						ui.log("warn", `Task skipped: ${task.role} - ${task.description}`);
						skippedCount++;
					}
					ui.progress(completedCount, failedCount, skippedCount, plan.tasks.length);
				},
				executor: isDryRun
					? async (task: Task) => {
							ui.log("info", `Would execute: ${task.role} - ${task.description}`);
						}
					: createBridgeExecutor({
							baseUrl: config.serverUrl,
							maxAgents,
							timeout: 600,
							ui,
						}),
			});

			await ui.update(isDryRun ? "Running dry-run simulation..." : "Executing plan...");
			const finalPlan = await scheduler.run();
			await ui.succeed(isDryRun ? "Dry-run completed" : "Execution completed");

			// 11. Create tasks in memory for tracking
			for (const task of finalPlan.tasks) {
				memory.createTask(sessionId, task.description);
			}

			// 12. Print summary
			ui.renderSummary({
				goal,
				completed: completedCount,
				failed: failedCount,
				skipped: skippedCount,
				total: finalPlan.tasks.length,
			});

			const output = ui.getOutput();
			if (output) {
				console.log(output);
			}

			return;
		} catch (error) {
			await ui.fail("Execution failed");
			if (error instanceof Error) {
				// eslint-disable-next-line no-console
				console.error(`Error: ${error.message}`);
			} else {
				// eslint-disable-next-line no-console
				console.error("An unknown error occurred");
			}
			process.exit(1);
		}
	});
