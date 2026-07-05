import chalk from "chalk";
import { Command } from "commander";
import { getDefaultConfigPath, readConfig, writeConfig } from "../config.js";

const getCommand = new Command("get")
	.description("print the current config or a specific key")
	.argument("[key]", "config key to retrieve (e.g., provider, model, apiKey.openai)")
	.action((key?: string) => {
		const config = readConfig();
		if (key) {
			const value = getNestedValue(config, key);
			if (value === undefined) {
				console.error(chalk.red(`Key not found: ${key}`));
				process.exit(1);
			}
			console.log(JSON.stringify(value, null, 2));
		} else {
			console.log(JSON.stringify(config, null, 2));
		}
	});

const setCommand = new Command("set")
	.description("set a config value (e.g., provider, model, apiKey.openai)")
	.argument("<key>", "config key to set (e.g., provider, model, apiKey.openai)")
	.argument("<value>", "value to set")
	.action((key: string, value: string) => {
		const config = readConfig();
		setNestedValue(config, key, value);
		writeConfig(config);
		console.log(chalk.green(`Set ${key} = ${value}`));
	});

const listCommand = new Command("list")
	.description("list available providers and their API key status")
	.action(() => {
		const config = readConfig();
		console.log(chalk.bold("Providers:"));
		for (const provider of ["openai", "anthropic", "gemini", "ollama", "groq", "openrouter"]) {
			const hasKey = !!config.apiKeys[provider];
			const isDefault = config.defaultProvider === provider;
			const marker = isDefault ? chalk.green(" (default)") : "";
			const keyStatus = hasKey ? chalk.green("✓ configured") : chalk.red("✗ not set");
			console.log(`  ${provider}${marker}: ${keyStatus}`);
		}
		console.log();
		console.log(chalk.bold("Current settings:"));
		console.log(`  provider: ${config.provider}`);
		console.log(`  model: ${config.model}`);
		console.log(`  defaultProvider: ${config.defaultProvider}`);
		console.log();
		console.log(`Config file: ${getDefaultConfigPath()}`);
	});

export const configCommand = new Command("config")
	.description("Manage CLI configuration")
	.addCommand(getCommand)
	.addCommand(setCommand)
	.addCommand(listCommand);

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
	// Map apiKey.* to apiKeys.* for backward compatibility
	const normalizedPath = path.replace(/^apiKey\./, "apiKeys.");
	return normalizedPath.split(".").reduce((acc: unknown, part: string) => {
		if (acc && typeof acc === "object" && part in acc) {
			return (acc as Record<string, unknown>)[part];
		}
		return undefined;
	}, obj);
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: string): void {
	// Map apiKey.* to apiKeys.* for backward compatibility
	const normalizedPath = path.replace(/^apiKey\./, "apiKeys.");
	const parts = normalizedPath.split(".");
	let current: Record<string, unknown> = obj;
	for (let i = 0; i < parts.length - 1; i++) {
		const part = parts[i];
		if (!(part in current) || typeof current[part] !== "object" || current[part] === null) {
			current[part] = {};
		}
		current = current[part] as Record<string, unknown>;
	}
	const lastPart = parts[parts.length - 1];

	if (lastPart === "provider" || lastPart === "model" || lastPart === "defaultProvider") {
		current[lastPart] = value;
	} else {
		current[lastPart] = value;
	}
}
