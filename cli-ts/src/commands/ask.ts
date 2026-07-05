import chalk from "chalk";
import { Command } from "commander";
import ora from "ora";
import { readConfig } from "../config.js";
import { MemoryManager } from "../memory/index.js";
import { createProvider, resolveProvider } from "../providers/factory.js";

export const askCommand = new Command("ask")
	.description("Ask the assistant a question")
	.argument("<prompt>", "the prompt to send")
	.option("--dry-run", "print model/provider info without calling an LLM", false)
	.option("--provider <provider>", "override the default provider")
	.option("--model <model>", "override the default model")
	.option("--session <session>", "session id to store conversation under", "default")
	.action(
		async (
			prompt: string,
			options: { dryRun: boolean; provider?: string; model?: string; session: string },
		) => {
			const config = readConfig();
			const memory = new MemoryManager();
			let session = memory.getSession(options.session);
			if (!session) {
				session = memory.createSession(options.session);
			}
			memory.addMessage(session.id, "user", prompt);

			let providerId = options.provider;
			let providerConfig: Record<string, unknown> = {};

			if (providerId) {
				if (providerId !== "ollama") {
					const apiKey = config.apiKeys[providerId];
					if (!apiKey) {
						console.error(chalk.red(`Error: API key not set for provider '${providerId}'`));
						console.error(chalk.yellow(`Run: infinity config set apiKey.${providerId} <your-key>`));
						process.exit(1);
					}
					providerConfig.apiKey = apiKey;
				}
			} else {
				const resolved = resolveProvider(config);
				providerId = resolved.id;
				providerConfig = resolved.config as Record<string, unknown>;
			}

			if (options.model) {
				providerConfig.model = options.model;
			}

			if (options.dryRun) {
				console.log(chalk.blue("Dry run enabled"));
				console.log(`Provider: ${providerId}`);
				console.log(`Model: ${options.model ?? config.model}`);
				console.log(`Prompt: ${prompt}`);
				console.log(
					`Config path: ${process.env.INFINITY_CONFIG_PATH ?? "~/.infinity/config.json"}`,
				);
				return;
			}

			const spinner = ora("Thinking...").start();
			try {
				const provider = createProvider(providerId, providerConfig);
				const response = await provider.chat([{ role: "user", content: prompt }], {
					model: options.model ?? config.model,
				});
				memory.addMessage(session.id, "assistant", response);
				spinner.succeed("Response received");
				console.log(chalk.green(response));
			} catch (error) {
				spinner.fail("Failed to get response");
				if (error instanceof Error) {
					console.error(chalk.red(error.message));
				}
				process.exit(1);
			}
		},
	);
