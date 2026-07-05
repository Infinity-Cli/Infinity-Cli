import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readConfig, writeConfig } from "./config.js";

describe("config", () => {
	it("returns defaults when config file does not exist", () => {
		const config = readConfig(join(mkdtempSync(join(tmpdir(), "inf-")), "missing.json"));
		expect(config.provider).toBe("openai");
		expect(config.model).toBe("gpt-4o-mini");
		expect(config.apiKeys).toEqual({});
	});

	it("reads and validates a stored config", () => {
		const dir = mkdtempSync(join(tmpdir(), "inf-"));
		const path = join(dir, "config.json");
		mkdirSync(dir, { recursive: true });
		writeFileSync(path, JSON.stringify({ provider: "anthropic", model: "claude-3" }), "utf-8");
		const config = readConfig(path);
		expect(config.provider).toBe("anthropic");
		expect(config.model).toBe("claude-3");
		rmSync(dir, { recursive: true, force: true });
	});

	it("writes a config file that can be read back", () => {
		const dir = mkdtempSync(join(tmpdir(), "inf-"));
		const path = join(dir, "config.json");
		writeConfig(
			{
				provider: "openai",
				model: "gpt-4o",
				apiKeys: {},
				providers: [],
				defaultProvider: "openai",
				serverUrl: "http://127.0.0.1:8000",
			},
			path,
		);
		const config = readConfig(path);
		expect(config.provider).toBe("openai");
		expect(config.model).toBe("gpt-4o");
		rmSync(dir, { recursive: true, force: true });
	});
});
