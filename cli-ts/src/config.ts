import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

export const configSchema = z.object({
	provider: z.string().min(1).default("openai"),
	model: z.string().min(1).default("gpt-4o-mini"),
	apiKeys: z.record(z.string()).default({}),
	providers: z.array(z.string()).default([]),
	defaultProvider: z.string().min(1).default("openai"),
	serverUrl: z.string().min(1).default("http://127.0.0.1:8000"),
});

export type Config = z.infer<typeof configSchema>;

export function getDefaultConfigPath(): string {
	if (process.env.INFINITY_CONFIG_PATH) {
		return process.env.INFINITY_CONFIG_PATH;
	}
	return join(homedir(), ".infinity", "config.json");
}

export function readConfig(path = getDefaultConfigPath()): Config {
	if (!existsSync(path)) {
		return configSchema.parse({});
	}
	const raw = JSON.parse(readFileSync(path, "utf-8"));
	return configSchema.parse(raw);
}

export function writeConfig(config: Config, path = getDefaultConfigPath()): void {
	const dir = join(path, "..");
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	const validated = configSchema.parse(config);
	writeFileSync(path, JSON.stringify(validated, null, 2), "utf-8");
}
