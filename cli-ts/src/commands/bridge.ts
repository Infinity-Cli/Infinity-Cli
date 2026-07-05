import chalk from "chalk";
import { Command } from "commander";
import { BridgeError, createBridgeClient } from "../bridge/index.js";
import { readConfig } from "../config.js";
import { MemoryManager } from "../memory/index.js";

function createClientFromConfig(configPath?: string) {
	const config = readConfig(configPath);
	return createBridgeClient(config.serverUrl);
}

function handleError(error: unknown) {
	if (error instanceof BridgeError) {
		console.error(chalk.red(`Bridge error (${error.status}): ${error.message}`));
		if (error.responseText) {
			console.error(chalk.gray(error.responseText));
		}
	} else if (error instanceof Error) {
		console.error(chalk.red(`Error: ${error.message}`));
	} else {
		console.error(chalk.red("An unknown error occurred"));
	}
	process.exit(1);
}

export const bridgeCommand = new Command("bridge")
	.description("Talk to the Infinity Python server")
	.option("-c, --config <path>", "path to a custom config file");

bridgeCommand
	.command("health")
	.description("Check if the Python server is reachable")
	.action(async (_opts, command) => {
		const parent = command.parent as Command | undefined;
		const configPath = parent?.opts().config as string | undefined;
		try {
			const client = createClientFromConfig(configPath);
			const result = await client.health();
			console.log(chalk.green(`Server status: ${result.status}`));
		} catch (error) {
			handleError(error);
		}
	});

bridgeCommand
	.command("run <goal>")
	.description("Run an autonomous coding goal via the Python server")
	.option("--max-agents <number>", "maximum number of agents", "10")
	.option("--timeout <number>", "timeout in seconds", "3600")
	.option("--enable-sync", "enable sync", false)
	.option("--sync-base-url <url>", "sync base URL")
	.option("--session <session>", "session id to record task under", "default")
	.action(async (goal: string, opts, command) => {
		const parent = command.parent as Command | undefined;
		const configPath = parent?.opts().config as string | undefined;
		const memory = new MemoryManager();
		let session = memory.getSession(opts.session);
		if (!session) {
			session = memory.createSession(opts.session);
		}
		const task = memory.createTask(session.id, goal);
		try {
			const client = createClientFromConfig(configPath);
			memory.updateTask(task.id, { status: "running" });
			const result = await client.run(goal, {
				maxAgents: Number(opts.maxAgents),
				timeout: Number(opts.timeout),
				enableSync: opts.enableSync,
				syncBaseUrl: opts.syncBaseUrl,
			});
			console.log(chalk.bold(`Goal: ${result.goal}`));
			console.log(`Success: ${result.success}`);
			console.log(`Completed agents: ${result.completed.length}`);
			for (const agent of result.completed) {
				console.log(chalk.green(`  ✓ ${agent}`));
			}
			console.log(`Failed agents: ${result.failed.length}`);
			for (const agent of result.failed) {
				console.log(chalk.red(`  ✗ ${agent}`));
			}
			memory.updateTask(task.id, { status: result.success ? "completed" : "failed" });
			memory.addLog(
				session.id,
				result.success ? "info" : "error",
				`Run completed: ${result.success ? "success" : "failure"}`,
			);
		} catch (error) {
			memory.updateTask(task.id, { status: "failed" });
			memory.addLog(
				session.id,
				"error",
				`Run failed: ${error instanceof Error ? error.message : String(error)}`,
			);
			handleError(error);
		}
	});

bridgeCommand
	.command("ask <prompt>")
	.description("Ask a question via the Python server")
	.option("--provider <provider>", "provider to use")
	.option("--model <model>", "model to use")
	.action(async (prompt: string, opts, command) => {
		const parent = command.parent as Command | undefined;
		const configPath = parent?.opts().config as string | undefined;
		try {
			const client = createClientFromConfig(configPath);
			const response = await client.ask(prompt, {
				provider: opts.provider,
				model: opts.model,
			});
			console.log(response);
		} catch (error) {
			handleError(error);
		}
	});
