import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readConfig, writeConfig } from "../config.js";
import { configCommand } from "./config.js";

describe("config command", () => {
	let testConfigDir: string;
	let originalEnv: NodeJS.ProcessEnv;

	beforeEach(() => {
		testConfigDir = mkdtempSync(join(tmpdir(), "inf-config-test-"));
		originalEnv = { ...process.env };
		process.env.INFINITY_CONFIG_PATH = join(testConfigDir, "config.json");
	});

	afterEach(() => {
		process.env = originalEnv;
		rmSync(testConfigDir, { recursive: true, force: true });
	});

	it('exports a config command named "config"', () => {
		expect(configCommand.name()).toBe("config");
	});

	it("has get subcommand", () => {
		const getCmd = configCommand.commands.find((c) => c.name() === "get");
		expect(getCmd).toBeDefined();
	});

	it("has set subcommand", () => {
		const setCmd = configCommand.commands.find((c) => c.name() === "set");
		expect(setCmd).toBeDefined();
	});

	it("has list subcommand", () => {
		const listCmd = configCommand.commands.find((c) => c.name() === "list");
		expect(listCmd).toBeDefined();
	});

	describe("config get", () => {
		it("prints full config when no key provided", async () => {
			const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
			writeConfig(
				{
					provider: "openai",
					model: "gpt-4o",
					apiKeys: { openai: "test-key" },
					providers: [],
					defaultProvider: "openai",
					serverUrl: "http://127.0.0.1:8000",
				},
				process.env.INFINITY_CONFIG_PATH as string,
			);

			await configCommand.parseAsync(["get"], { from: "user" });

			expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("openai"));
			expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("gpt-4o"));
			consoleSpy.mockRestore();
		});

		it("prints specific key when provided", async () => {
			const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
			writeConfig(
				{
					provider: "anthropic",
					model: "claude-3",
					apiKeys: { anthropic: "secret-key" },
					providers: [],
					defaultProvider: "anthropic",
					serverUrl: "http://127.0.0.1:8000",
				},
				process.env.INFINITY_CONFIG_PATH as string,
			);

			await configCommand.parseAsync(["get", "provider"], { from: "user" });

			expect(consoleSpy).toHaveBeenCalledWith('"anthropic"');
			consoleSpy.mockRestore();
		});

		it("prints nested key (apiKey.openai)", async () => {
			const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
			writeConfig(
				{
					provider: "openai",
					model: "gpt-4o",
					apiKeys: { openai: "secret-key" },
					providers: [],
					defaultProvider: "openai",
					serverUrl: "http://127.0.0.1:8000",
				},
				process.env.INFINITY_CONFIG_PATH as string,
			);

			await configCommand.parseAsync(["get", "apiKey.openai"], { from: "user" });

			expect(consoleSpy).toHaveBeenCalledWith('"secret-key"');
			consoleSpy.mockRestore();
		});

		it("exits with error for unknown key", async () => {
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

			await configCommand.parseAsync(["get", "unknown.key"], { from: "user" });

			expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Key not found"));
			expect(exitSpy).toHaveBeenCalledWith(1);
			consoleErrorSpy.mockRestore();
			exitSpy.mockRestore();
		});
	});

	describe("config set", () => {
		it("sets provider", async () => {
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

			await configCommand.parseAsync(["set", "provider", "anthropic"], { from: "user" });

			const config = readConfig(process.env.INFINITY_CONFIG_PATH as string);
			expect(config.provider).toBe("anthropic");
			expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Set provider = anthropic"));
			consoleSpy.mockRestore();
		});

		it("sets model", async () => {
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

			await configCommand.parseAsync(["set", "model", "claude-3"], { from: "user" });

			const config = readConfig(process.env.INFINITY_CONFIG_PATH as string);
			expect(config.model).toBe("claude-3");
			expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Set model = claude-3"));
			consoleSpy.mockRestore();
		});

		it("sets apiKey for provider", async () => {
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

			await configCommand.parseAsync(["set", "apiKey.openai", "my-secret-key"], { from: "user" });

			const config = readConfig(process.env.INFINITY_CONFIG_PATH as string);
			expect(config.apiKeys.openai).toBe("my-secret-key");
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining("Set apiKey.openai = my-secret-key"),
			);
			consoleSpy.mockRestore();
		});

		it("sets defaultProvider", async () => {
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

			await configCommand.parseAsync(["set", "defaultProvider", "anthropic"], { from: "user" });

			const config = readConfig(process.env.INFINITY_CONFIG_PATH as string);
			expect(config.defaultProvider).toBe("anthropic");
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining("Set defaultProvider = anthropic"),
			);
			consoleSpy.mockRestore();
		});
	});

	describe("config list", () => {
		it("lists all providers with key status and default marker", async () => {
			const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
			writeConfig(
				{
					provider: "openai",
					model: "gpt-4o",
					apiKeys: { openai: "key1", anthropic: "key2" },
					providers: [],
					defaultProvider: "anthropic",
					serverUrl: "http://127.0.0.1:8000",
				},
				process.env.INFINITY_CONFIG_PATH as string,
			);

			await configCommand.parseAsync(["list"], { from: "user" });

			expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("openai"));
			expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("anthropic"));
			expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("default"));
			expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("configured"));
			expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("not set"));
			consoleSpy.mockRestore();
		});

		it("shows current settings", async () => {
			const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
			writeConfig(
				{
					provider: "gemini",
					model: "gemini-pro",
					apiKeys: { gemini: "key" },
					providers: [],
					defaultProvider: "gemini",
					serverUrl: "http://127.0.0.1:8000",
				},
				process.env.INFINITY_CONFIG_PATH as string,
			);

			await configCommand.parseAsync(["list"], { from: "user" });

			expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("provider: gemini"));
			expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("model: gemini-pro"));
			expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("defaultProvider: gemini"));
			consoleSpy.mockRestore();
		});

		it("shows config file path", async () => {
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

			await configCommand.parseAsync(["list"], { from: "user" });

			expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Config file:"));
			consoleSpy.mockRestore();
		});
	});
});
