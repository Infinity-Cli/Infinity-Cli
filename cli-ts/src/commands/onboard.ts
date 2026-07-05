import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import chalk from "chalk";
import { Command } from "commander";
import { getDefaultConfigPath, readConfig, writeConfig } from "../config.js";
import type { Config } from "../config.js";
import { PROVIDER_DEFAULT_MODELS, classifyProvider } from "../providers/key-classifier.js";
import type { ProviderId } from "../providers/key-classifier.js";

/**
 * Prompt the user to paste an API key, returning the trimmed input.
 * If the process is not connected to a TTY (interactive terminal),
 * this prints an error message and exits with code 1.
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

	const rl = createInterface({ input, output });
	const key = await rl.question(
		chalk.cyan(
			"\nWelcome to Infinity CLI onboarding!\n" +
				"Paste your API key (it will not be displayed):\n> ",
		),
	);
	rl.close();

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
	.action(async () => {
		console.log(chalk.bold("\n=== Infinity CLI Onboarding ===\n"));

		const key = await promptForKey();

		const result = classifyProvider(key);
		if (result === null) {
			console.error(chalk.red("Could not auto-detect provider from key."));
			process.exit(1);
		}

		const provider: ProviderId = result.provider;
		const model = PROVIDER_DEFAULT_MODELS[provider];

		console.log(chalk.green(`\nDetected provider: ${provider} (default model: ${model})`));

		const valid = await validateApiKey(provider, key);
		if (valid) {
			console.log(chalk.green("✓ API key validated successfully."));
		} else {
			console.log(chalk.yellow("⚠ API key validation could not be completed (continuing anyway)."));
		}

		const configPath = await applyOnboardingConfig(provider, model, key);

		console.log(
			chalk.green(
				`\nOnboarding complete!\n  Provider: ${provider}\n  Model: ${model}\n  Config: ${configPath}\n`,
			),
		);
	});
