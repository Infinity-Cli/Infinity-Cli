import chalk from "chalk";
import { Command } from "commander";
import ora from "ora";
import { AskEngineError, askOnce } from "../ask-engine.js";

export const askCommand = new Command("ask")
	.description("Ask the assistant a question")
	.argument("<prompt...>", "the prompt to send")
	.option("--dry-run", "print model/provider info without calling an LLM", false)
	.option("--provider <provider>", "override the default provider")
	.option("--model <model>", "override the default model")
	.option("--session <session>", "session id to store conversation under", "default")
	.allowExcessArguments(false)
	.action(
		async (
			promptParts: string[],
			options: { dryRun: boolean; provider?: string; model?: string; session: string },
		) => {
			const prompt = promptParts.join(" ");
			if (options.dryRun) {
				const result = await askOnce(prompt, options);
				console.log(chalk.blue("Dry run enabled"));
				console.log(`Provider: ${result.providerId}`);
				console.log(`Model: ${result.model}`);
				console.log(`Prompt: ${prompt}`);
				console.log(
					`Config path: ${process.env.INFINITY_CONFIG_PATH ?? "~/.infinity/config.json"}`,
				);
				return;
			}

			const spinner = ora("Thinking...").start();
			try {
				const result = await askOnce(prompt, options);
				spinner.succeed("Response received");
				console.log(chalk.green(result.response));
			} catch (error) {
				spinner.fail("Failed to get response");
				if (error instanceof AskEngineError && error.code === "API_KEY_MISSING") {
					console.error(chalk.red(`Error: ${error.message}`));
					if (error.providerId) {
						console.error(
							chalk.yellow(`Run: infinity config set apiKey.${error.providerId} <your-key>`),
						);
					}
				} else if (error instanceof Error) {
					console.error(chalk.red(error.message));
				}
				process.exitCode = 1;
				return;
			}
		},
	);
