import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readConfig, writeConfig } from "../config.js";
import { askCommand } from "./ask.js";

describe("ask command", () => {
	let testConfigDir: string;
	let originalEnv: NodeJS.ProcessEnv;

	beforeEach(() => {
		testConfigDir = mkdtempSync(join(tmpdir(), "inf-test-"));
		originalEnv = { ...process.env };
		process.env.INFINITY_CONFIG_PATH = join(testConfigDir, "config.json");
	});

	afterEach(() => {
		process.env = originalEnv;
		rmSync(testConfigDir, { recursive: true, force: true });
	});

	it('exports an ask command named "ask"', () => {
		expect(askCommand.name()).toBe("ask");
	});

	it("registers the --dry-run option", () => {
		const opts = askCommand.options;
		const dryRun = opts.find((o) => o.long === "--dry-run");
		expect(dryRun).toBeDefined();
	});

	it("registers the --provider option", () => {
		const opts = askCommand.options;
		const provider = opts.find((o) => o.long === "--provider");
		expect(provider).toBeDefined();
	});

	it("registers the --model option", () => {
		const opts = askCommand.options;
		const model = opts.find((o) => o.long === "--model");
		expect(model).toBeDefined();
	});

	it("dry-run prints provider, model, prompt and config path", async () => {
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

		await askCommand.parseAsync(
			["hello world", "--dry-run", "--provider", "ollama", "--model", "test-model"],
			{ from: "user" },
		);

		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Provider: ollama"));
		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Model: test-model"));
		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Prompt: hello world"));
		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Config path:"));
		consoleSpy.mockRestore();
	});

	it("dry-run uses config defaults when no overrides provided", async () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		writeConfig(
			{
				provider: "anthropic",
				model: "claude-3",
				apiKeys: {},
				providers: [],
				defaultProvider: "anthropic",
				serverUrl: "http://127.0.0.1:8000",
			},
			process.env.INFINITY_CONFIG_PATH as string,
		);

		await askCommand.parseAsync(["test prompt", "--dry-run"], { from: "user" });

		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Provider: anthropic"));
		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Model: claude-3"));
		consoleSpy.mockRestore();
	});
});

describe("ask command - API key validation", () => {
	let testConfigDir: string;
	let originalEnv: NodeJS.ProcessEnv;

	beforeEach(() => {
		testConfigDir = mkdtempSync(join(tmpdir(), "inf-test-"));
		originalEnv = { ...process.env };
		process.env.INFINITY_CONFIG_PATH = join(testConfigDir, "config.json");
	});

	afterEach(() => {
		process.env = originalEnv;
		rmSync(testConfigDir, { recursive: true, force: true });
	});

	it("exits with error when provider needs API key but none configured", async () => {
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
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

		await askCommand.parseAsync(["hello", "--provider", "openai"], { from: "user" });

		expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("API key not set"));
		expect(exitSpy).toHaveBeenCalledWith(1);
		consoleErrorSpy.mockRestore();
		exitSpy.mockRestore();
	});

	it("allows ollama without API key", async () => {
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
		writeConfig(
			{
				provider: "ollama",
				model: "qwen2.5-coder:7b",
				apiKeys: {},
				providers: [],
				defaultProvider: "ollama",
				serverUrl: "http://127.0.0.1:8000",
			},
			process.env.INFINITY_CONFIG_PATH as string,
		);

		// Mock fetch to avoid actual network call
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(
				new Response(JSON.stringify({ message: { content: "test response" } }), { status: 200 }),
			);

		await askCommand.parseAsync(["hello", "--provider", "ollama"], { from: "user" });

		expect(consoleErrorSpy).not.toHaveBeenCalledWith(expect.stringContaining("API key not set"));
		expect(exitSpy).not.toHaveBeenCalled();
		fetchSpy.mockRestore();
		consoleErrorSpy.mockRestore();
		exitSpy.mockRestore();
	});
});
