import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stdout } from "node:process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readConfig, writeConfig } from "../config.js";
import type { Config } from "../config.js";
import type { ProviderId } from "../providers/key-classifier.js";
import { applyOnboardingConfig, onboardCommand, validateApiKey } from "./onboard.js";

const { questionMock, closeMock, moveCursorMock, clearLineMock } = vi.hoisted(() => ({
	questionMock: vi.fn(),
	closeMock: vi.fn(),
	moveCursorMock: vi.fn(),
	clearLineMock: vi.fn(),
}));

vi.mock("node:readline/promises", () => ({
	createInterface: vi.fn(() => ({
		question: questionMock,
		close: closeMock,
	})),
}));

vi.mock("node:readline", () => ({
	default: {
		moveCursor: moveCursorMock,
		clearLine: clearLineMock,
	},
}));

describe("onboard command", () => {
	let testConfigDir: string;
	let originalEnv: NodeJS.ProcessEnv;
	let originalFetch: typeof global.fetch;

	beforeEach(() => {
		testConfigDir = mkdtempSync(join(tmpdir(), "inf-onboard-test-"));
		originalEnv = { ...process.env };
		process.env.INFINITY_CONFIG_PATH = join(testConfigDir, "config.json");
		originalFetch = global.fetch;
		global.fetch = vi.fn().mockResolvedValue({ status: 200 });
	});

	afterEach(() => {
		process.env = originalEnv;
		global.fetch = originalFetch;
		rmSync(testConfigDir, { recursive: true, force: true });
		vi.clearAllMocks();
		Object.defineProperty(process.stdin, "isTTY", { value: undefined, configurable: true });
	});

	it('exports a command named "onboard"', () => {
		expect(onboardCommand.name()).toBe("onboard");
	});

	it('has description matching "Onboard"', () => {
		expect(onboardCommand.description()).toContain("Onboard");
	});

	it("auto-detects provider and writes config when API key is supplied", async () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		writeConfig(
			{
				provider: "openai",
				model: "gpt-4o",
				apiKeys: {},
				providers: [],
				defaultProvider: "openai",
				serverUrl: "http://127.0.0.1:8000",
			},
			process.env.INFINITY_CONFIG_PATH as string,
		);

		await onboardCommand.parseAsync(["sk-test-key"], { from: "user" });

		const config = readConfig(process.env.INFINITY_CONFIG_PATH as string);
		expect(config.provider).toBe("openai");
		expect(config.defaultProvider).toBe("openai");
		expect(config.model).toBe("gpt-4o-mini");
		expect(config.apiKeys.openai).toBe("sk-test-key");
		expect(questionMock).not.toHaveBeenCalled();
		consoleSpy.mockRestore();
	});

	it("prompts for provider and API key in TTY when no key is supplied", async () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const stdoutSpy = vi.spyOn(stdout, "write").mockImplementation(() => true);
		Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
		questionMock.mockResolvedValueOnce("2");
		questionMock.mockResolvedValueOnce("sk-ant-api03-test-key");
		writeConfig(
			{
				provider: "openai",
				model: "gpt-4o",
				apiKeys: {},
				providers: [],
				defaultProvider: "openai",
				serverUrl: "http://127.0.0.1:8000",
			},
			process.env.INFINITY_CONFIG_PATH as string,
		);

		await onboardCommand.parseAsync([], { from: "user" });

		const config = readConfig(process.env.INFINITY_CONFIG_PATH as string);
		expect(config.provider).toBe("anthropic");
		expect(config.defaultProvider).toBe("anthropic");
		expect(config.model).toBe("claude-3-5-sonnet-20240620");
		expect(config.apiKeys.anthropic).toBe("sk-ant-api03-test-key");
		expect(questionMock).toHaveBeenCalledTimes(2);
		expect(questionMock).toHaveBeenNthCalledWith(1, expect.stringContaining("Select provider"));
		expect(questionMock).toHaveBeenNthCalledWith(2, expect.stringContaining("Paste your API key"));
		expect(moveCursorMock).toHaveBeenCalled();
		expect(clearLineMock).toHaveBeenCalled();
		expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining("******************"));
		consoleSpy.mockRestore();
		stdoutSpy.mockRestore();
	});

	it("skips API key prompt and writes default model when ollama is selected", async () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
		questionMock.mockResolvedValueOnce("6");
		writeConfig(
			{
				provider: "openai",
				model: "gpt-4o",
				apiKeys: {},
				providers: [],
				defaultProvider: "openai",
				serverUrl: "http://127.0.0.1:8000",
			},
			process.env.INFINITY_CONFIG_PATH as string,
		);

		await onboardCommand.parseAsync([], { from: "user" });

		const config = readConfig(process.env.INFINITY_CONFIG_PATH as string);
		expect(config.provider).toBe("ollama");
		expect(config.defaultProvider).toBe("ollama");
		expect(config.model).toBe("qwen2.5-coder:7b");
		expect(config.apiKeys.ollama).toBe("");
		expect(questionMock).toHaveBeenCalledTimes(1);
		expect(questionMock).toHaveBeenCalledWith(expect.stringContaining("Select provider"));
		consoleSpy.mockRestore();
	});

	it("errors and exits when no key is supplied in non-TTY", async () => {
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
			throw new Error("process.exit");
		});
		Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });

		await expect(onboardCommand.parseAsync([], { from: "user" })).rejects.toThrow("process.exit");

		expect(consoleErrorSpy).toHaveBeenCalledWith(
			expect.stringContaining("not running in an interactive terminal"),
		);
		expect(exitSpy).toHaveBeenCalledWith(1);
		expect(questionMock).not.toHaveBeenCalled();
		consoleErrorSpy.mockRestore();
		exitSpy.mockRestore();
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
