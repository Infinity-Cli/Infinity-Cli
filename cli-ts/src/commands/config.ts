import { stdin, stdout } from "node:process";
import chalk from "chalk";
import { Command } from "commander";
import { getDefaultConfigPath, readConfig, writeConfig } from "../config.js";
import { type ProviderId, getDefaultModel } from "../providers/key-classifier.js";

const SUPPORTED_KEY_PREFIXES = [
	{ prefix: "sk-", provider: "openai" },
	{ prefix: "pk-", provider: "openai" },
	{ prefix: "nvapi-", provider: "nvidia" },
	{ prefix: "hf_", provider: "huggingface" },
	{ prefix: "ghp_", provider: "github" },
	{ prefix: "xai-", provider: "xai" },
	{ prefix: "AIza", provider: "gemini" },
	{ prefix: "ollama_", provider: "ollama" },
];

function looksLikeApiKey(str: string): boolean {
	if (/^(sk-|pk-|nvapi-|hf_|ghp_|xai-|AIza|ollama_)(\S+)$/.test(str)) {
		return true;
	}
	if (str.length > 20 && !str.includes(".") && /^[a-zA-Z0-9_-]+$/.test(str)) {
		return true;
	}
	return false;
}

function mapApiKeyToProvider(key: string): string | undefined {
	for (const { prefix, provider } of SUPPORTED_KEY_PREFIXES) {
		if (key.startsWith(prefix)) {
			return provider;
		}
	}
	return undefined;
}

function isSensitiveConfigKey(key: string): boolean {
	return key.startsWith("apiKey.") || /token|secret|password/i.test(key);
}

export async function promptMasked(promptText: string): Promise<string> {
	return new Promise((resolve) => {
		stdout.write(promptText);

		if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
			stdin.once("data", (data) => {
				resolve(data.toString("utf8").replace(/\r?\n$/, ""));
			});
			return;
		}

		const previousRawMode = stdin.isRaw;
		stdin.setRawMode(true);
		stdin.resume();

		let value = "";

		const onData = (data: Buffer) => {
			const str = data.toString("utf8");
			for (const char of str) {
				const code = char.charCodeAt(0);
				if (code === 3) {
					// Ctrl+C
					stdout.write("^C\n");
					stdin.setRawMode(previousRawMode);
					stdin.pause();
					stdin.removeListener("data", onData);
					process.exitCode = 1;
					resolve("");
					return;
				}
				if (code === 13 || code === 10) {
					// Enter
					stdout.write("\n");
					stdin.setRawMode(previousRawMode);
					stdin.pause();
					stdin.removeListener("data", onData);
					resolve(value);
					return;
				}
				if (code === 127 || code === 8) {
					// Backspace
					if (value.length > 0) {
						value = value.slice(0, -1);
						stdout.write("\b \b");
					}
					continue;
				}
				if (code < 32) {
					continue;
				}
				value += char;
				stdout.write("*");
			}
		};

		stdin.on("data", onData);
	});
}

const getCommand = new Command("get")
	.description("print the current config or a specific key")
	.argument("[key]", "config key to retrieve (e.g., provider, model, apiKey.openai)")
	.action((key?: string) => {
		const config = readConfig();
		if (key) {
			const value = getNestedValue(config, key);
			if (value === undefined) {
				console.error(chalk.red(`Key not found: ${key}`));
				process.exitCode = 1;
				return;
			}
			console.log(JSON.stringify(value, null, 2));
		} else {
			console.log(JSON.stringify(config, null, 2));
		}
	});

const setCommand = new Command("set")
	.description("set a config value (e.g., provider, model, apiKey.openai)")
	.argument("<key>", "config key to set (e.g., provider, model, apiKey.openai)")
	.argument("[value...]", "value to set")
	.action(async (rawKey: string, valueParts: string[]) => {
		let key = rawKey;
		let value = valueParts.join(" ");

		if (value === "" && looksLikeApiKey(key)) {
			const provider = mapApiKeyToProvider(key);
			if (provider === undefined) {
				console.error(
					chalk.red(
						[
							"Error: the value looks like an API key, but its provider prefix is not recognized.",
							`Supported prefixes: ${SUPPORTED_KEY_PREFIXES.map((p) => p.prefix).join(", ")}`,
							"Usage: infinity config set apiKey.<provider> <key>",
						].join("\n"),
					),
				);
				process.exitCode = 1;
				return;
			}
			value = key;
			key = `apiKey.${provider}`;
			const config = readConfig();
			setNestedValue(config, "provider", provider);
			const currentModel = getNestedValue(config, "model");
			if (typeof currentModel !== "string" || currentModel === "gpt-4o-mini") {
				setNestedValue(config, "model", getDefaultModel(provider as ProviderId));
			}
			setNestedValue(config, key, value);
			writeConfig(config);
			const displayValue = isSensitiveConfigKey(key) ? "********" : value;
			console.log(chalk.green(`Set ${key} = ${displayValue}`));
			console.log(chalk.green(`Set provider = ${provider}`));
			const updatedModel = getNestedValue(config, "model");
			if (typeof updatedModel === "string") {
				console.log(chalk.green(`Set model = ${updatedModel}`));
			}
			return;
		}

		const isSensitiveKey = isSensitiveConfigKey(key);

		if (value === "" && process.stdin.isTTY) {
			const promptText = chalk.cyan(`Enter ${key}: `);
			value = await promptMasked(promptText);
		}

		if (value === "") {
			console.error(chalk.red("Error: value is required"));
			process.exitCode = 1;
			return;
		}

		const config = readConfig();
		setNestedValue(config, key, value);
		writeConfig(config);
		const displayValue = isSensitiveKey ? "********" : value;
		console.log(chalk.green(`Set ${key} = ${displayValue}`));
	});

const listCommand = new Command("list")
	.description("list available providers and their API key status")
	.action(() => {
		const config = readConfig();
		console.log(chalk.bold("Providers:"));
		for (const provider of [
			"openai",
			"anthropic",
			"gemini",
			"ollama",
			"groq",
			"openrouter",
			"nvidia",
		]) {
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
