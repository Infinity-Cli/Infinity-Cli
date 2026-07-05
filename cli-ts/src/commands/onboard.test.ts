import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readConfig, writeConfig } from "../config.js";
import type { Config } from "../config.js";
import type { ProviderId } from "../providers/key-classifier.js";
import { applyOnboardingConfig, onboardCommand, validateApiKey } from "./onboard.js";

describe("onboard command", () => {
	let testConfigDir: string;
	let originalEnv: NodeJS.ProcessEnv;
	let originalFetch: typeof global.fetch;

	beforeEach(() => {
		testConfigDir = mkdtempSync(join(tmpdir(), "inf-onboard-test-"));
		originalEnv = { ...process.env };
		process.env.INFINITY_CONFIG_PATH = join(testConfigDir, "config.json");
		originalFetch = global.fetch;
	});

	afterEach(() => {
		process.env = originalEnv;
		global.fetch = originalFetch;
		rmSync(testConfigDir, { recursive: true, force: true });
	});

	it('exports a command named "onboard"', () => {
		expect(onboardCommand.name()).toBe("onboard");
	});

	it('has description matching "Onboard"', () => {
		expect(onboardCommand.description()).toContain("Onboard");
	});
});

describe("validateApiKey", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns true for openai on 2xx", async () => {
		global.fetch = vi.fn().mockResolvedValue({ status: 200 });
		const result = await validateApiKey("openai" as ProviderId, "sk-test-key");
		expect(result).toBe(true);
	});

	it("returns true for anthropic on 2xx", async () => {
		global.fetch = vi.fn().mockResolvedValue({ status: 200 });
		const result = await validateApiKey("anthropic" as ProviderId, "sk-ant-test");
		expect(result).toBe(true);
	});

	it("returns true for gemini on 2xx", async () => {
		global.fetch = vi.fn().mockResolvedValue({ status: 200 });
		const result = await validateApiKey("gemini" as ProviderId, "AIza-test");
		expect(result).toBe(true);
	});

	it("returns true for groq on 2xx", async () => {
		global.fetch = vi.fn().mockResolvedValue({ status: 200 });
		const result = await validateApiKey("groq" as ProviderId, "gsk_test");
		expect(result).toBe(true);
	});

	it("returns true for openrouter on 2xx", async () => {
		global.fetch = vi.fn().mockResolvedValue({ status: 200 });
		const result = await validateApiKey("openrouter" as ProviderId, "sk-or-test");
		expect(result).toBe(true);
	});

	it("returns false on network error", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		global.fetch = vi.fn().mockRejectedValue(new Error("network error"));
		const result = await validateApiKey("openai" as ProviderId, "sk-test");
		expect(result).toBe(false);
		expect(warnSpy).toHaveBeenCalled();
	});

	it("returns false on 4xx error", async () => {
		global.fetch = vi.fn().mockResolvedValue({ status: 401 });
		const result = await validateApiKey("openai" as ProviderId, "sk-test");
		expect(result).toBe(false);
	});

	it("returns false for unknown provider", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const result = await validateApiKey("unknown" as ProviderId, "key");
		expect(result).toBe(false);
		expect(warnSpy).toHaveBeenCalled();
	});
});

describe("applyOnboardingConfig", () => {
	let testConfigDir: string;

	beforeEach(() => {
		testConfigDir = mkdtempSync(join(tmpdir(), "inf-onboard-apply-"));
		process.env.INFINITY_CONFIG_PATH = join(testConfigDir, "config.json");
	});

	afterEach(() => {
		process.env.INFINITY_CONFIG_PATH = undefined;
		rmSync(testConfigDir, { recursive: true, force: true });
	});

	it("writes provider, model, defaultProvider, and apiKeys", async () => {
		const configPath = join(testConfigDir, "config.json");
		const resultPath = await applyOnboardingConfig(
			"openai" as ProviderId,
			"gpt-4o-mini",
			"sk-test-key",
			configPath,
		);
		const config = readConfig(configPath);
		expect(config.provider).toBe("openai");
		expect(config.model).toBe("gpt-4o-mini");
		expect(config.defaultProvider).toBe("openai");
		expect(config.apiKeys).toHaveProperty("openai", "sk-test-key");
		expect(resultPath).toBe(configPath);
	});

	it("writes anthropic config", async () => {
		const configPath = join(testConfigDir, "config.json");
		await applyOnboardingConfig(
			"anthropic" as ProviderId,
			"claude-3-5-sonnet-20240620",
			"sk-ant-test",
			configPath,
		);
		const config = readConfig(configPath);
		expect(config.provider).toBe("anthropic");
		expect(config.defaultProvider).toBe("anthropic");
		expect(config.apiKeys).toHaveProperty("anthropic", "sk-ant-test");
	});
});
