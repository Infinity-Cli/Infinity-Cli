import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline";
import { createInterface } from "node:readline/promises";
import chalk from "chalk";
import { Command } from "commander";
import { getDefaultConfigPath, readConfig, writeConfig } from "../config.js";
import type { Config } from "../config.js";
import { PROVIDER_DEFAULT_MODELS, classifyProvider } from "../providers/key-classifier.js";
import type { ProviderId } from "../providers/key-classifier.js";

const INTERACTIVE_PROVIDERS: ProviderId[] = [
	"openai",
	"anthropic",
	"gemini",
	"groq",
	"openrouter",
	"ollama",
];

/**
 * Prompt the user to select a provider from a numbered list.
 * Returns the selected provider id.
 */
export async function promptForProvider(): Promise<ProviderId> {
	if (!input.isTTY) {
		console.error(
			chalk.red(
				"Error: not running in an interactive terminal. " +
					"Please run this command in a terminal where you can select a provider.",
			),
		);
		process.exit(1);
	}

	const lines = INTERACTIVE_PROVIDERS.map((p, i) => `  ${i + 1}. ${p}`).join("\n");

	const rl = createInterface({ input, output });
	const answer = await rl.question(chalk.cyan(`Select provider:\n${lines}\n> `));
	rl.close();

	const choice = answer.trim();
	const index = Number.parseInt(choice, 10) - 1;

	if (Number.isNaN(index) || index < 0 || index >= INTERACTIVE_PROVIDERS.length) {
		console.error(chalk.red(`Invalid provider selection: "${choice}"`));
		process.exit(1);
	}

	return INTERACTIVE_PROVIDERS[index];
}

/**
 * Prompt the user to paste an API key, returning the trimmed input.
 * Echo is replaced with '*' characters on TTYs.
 */
export async function promptForKey(): Promise<string> {
	if (!input.isTTY) {
		console.error(
			chalk.red(
				"Error: not running in an interactive terminal. " +
					"Please run this command in a terminal where you can paste your API key.",
			),
		);
		process.exit(1);
	}

	const promptText = chalk.cyan("Paste your API key: ");
	const rl = createInterface({ input, output });
	const key = await rl.question(promptText);
	rl.close();

	if (key.length > 0) {
		readline.moveCursor(output, 0, -1);
		readline.clearLine(output, 0);
		output.write(`${promptText}${"*".repeat(key.length)}\n`);
	}

	return key.trim();
}

/**
 * Validate an API key by making a provider-specific smoke HTTP request.
 * Uses the global fetch API with a 10-second timeout.
 * Returns true if the response is 2xx, false otherwise (including network
 * errors). Does not throw; failures are logged as warnings.
 */
export async function validateApiKey(provider: ProviderId, key: string): Promise<boolean> {
	const endpoints: Record<string, { url: string; headers: Record<string, string> }> = {
		openai: {
			url: "https://api.openai.com/v1/models",
			headers: { Authorization: `Bearer ${key}` },
		},
		anthropic: {
			url: "https://api.anthropic.com/v1/models",
			headers: { "x-api-key": key },
		},
		gemini: {
			url: `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
			headers: {},
		},
		groq: {
			url: "https://api.groq.com/openai/v1/models",
			headers: { Authorization: `Bearer ${key}` },
		},
		openrouter: {
			url: "https://openrouter.ai/api/v1/models",
			headers: { Authorization: `Bearer ${key}` },
		},
	};

	const spec = endpoints[provider];
	if (!spec) {
		console.warn(
			chalk.yellow(`Warning: no validation endpoint for provider "${provider}". Skipping.`),
		);
		return false;
	}

	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), 10_000);

	try {
		const response = await fetch(spec.url, {
			method: "GET",
			headers: spec.headers,
			signal: controller.signal,
		});
		clearTimeout(timeoutId);
		return response.status >= 200 && response.status < 300;
	} catch {
		clearTimeout(timeoutId);
		console.warn(
			chalk.yellow(
				`Warning: could not reach ${provider} for validation (network issue). Continuing anyway.`,
			),
		);
		return false;
	}
}

/**
 * Apply the onboarding configuration: set provider, model, and store the API key.
 * Reads the existing config, updates the relevant fields, and writes it back.
 * Returns the path where the config was written.
 */
export async function applyOnboardingConfig(
	provider: ProviderId,
	model: string,
	key: string,
	configPath?: string,
): Promise<string> {
	const config: Config = readConfig(configPath);
	config.provider = provider;
	config.defaultProvider = provider;
	config.model = model;
	config.apiKeys[provider] = key;
	writeConfig(config, configPath);
	return configPath ?? getDefaultConfigPath();
}

export const onboardCommand = new Command("onboard")
	.description("Onboard by pasting an API key; auto-detect provider, validate, and save config")
	.argument("[apiKey]", "optional API key to skip interactive prompt")
	.action(async (apiKey?: string) => {
		console.log(chalk.bold("\n=== Infinity CLI Onboarding ===\n"));

		let provider: ProviderId;
		let key: string;

		if (apiKey) {
			key = apiKey;
			const result = classifyProvider(key);
			if (result === null) {
				console.error(chalk.red("Could not auto-detect provider from key."));
				process.exit(1);
			}
			provider = result.provider;
		} else {
			if (!input.isTTY) {
				console.error(
					chalk.red(
						"Error: not running in an interactive terminal. " +
							"Please provide an API key as an argument or run this command in a terminal.",
					),
				);
				process.exit(1);
			}

			provider = await promptForProvider();

			if (provider === "ollama") {
				key = "";
			} else {
				key = await promptForKey();
				if (key === "") {
					console.error(chalk.red("Error: API key is required."));
					process.exit(1);
				}
			}
		}

		const model = PROVIDER_DEFAULT_MODELS[provider];

		console.log(chalk.green(`\nSelected provider: ${provider} (default model: ${model})`));

		if (provider !== "ollama") {
			const valid = await validateApiKey(provider, key);
			if (valid) {
				console.log(chalk.green("✓ API key validated successfully."));
			} else {
				console.log(
					chalk.yellow("⚠ API key validation could not be completed (continuing anyway)."),
				);
			}
		}

		const configPath = await applyOnboardingConfig(provider, model, key);

		console.log(
			chalk.green(
				`\nOnboarding complete!\n  Provider: ${provider}\n  Model: ${model}\n  Config: ${configPath}\n`,
			),
		);
	});
