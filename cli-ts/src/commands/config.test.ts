import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readConfig, writeConfig } from "../config.js";
import { configCommand } from "./config.js";

describe("config command", () => {
	let testConfigDir: string;
	let originalEnv: NodeJS.ProcessEnv;
	let originalExitCode: typeof process.exitCode;

	beforeEach(() => {
		testConfigDir = mkdtempSync(join(tmpdir(), "inf-config-test-"));
		originalEnv = { ...process.env };
		originalExitCode = process.exitCode;
		process.exitCode = 0;
		process.env.INFINITY_CONFIG_PATH = join(testConfigDir, "config.json");
	});

	afterEach(() => {
		process.env = originalEnv;
		process.exitCode = originalExitCode;
		rmSync(testConfigDir, { recursive: true, force: true });
		vi.clearAllMocks();
		Object.defineProperty(process.stdin, "isTTY", { value: undefined, configurable: true });
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
			expect(process.exitCode).toBe(1);
			consoleErrorSpy.mockRestore();
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

		it("sets apiKey for provider and masks output", async () => {
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
				expect.stringContaining("Set apiKey.openai = ********"),
			);
			consoleSpy.mockRestore();
		});

		it("joins multiple value arguments with spaces", async () => {
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

			await configCommand.parseAsync(["set", "model", "claude", "3", "opus"], { from: "user" });

			const config = readConfig(process.env.INFINITY_CONFIG_PATH as string);
			expect(config.model).toBe("claude 3 opus");
			expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Set model = claude 3 opus"));
			consoleSpy.mockRestore();
		});

		it("prompts for value in TTY when value is missing", async () => {
			const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
			const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
			Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
			(process.stdin as NodeJS.ReadStream & { setRawMode: (mode: boolean) => void }).setRawMode =
				vi.fn();
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

			const promise = configCommand.parseAsync(["set", "provider"], { from: "user" });
			setImmediate(() => {
				process.stdin.emit("data", Buffer.from("anthropic\n"));
			});
			await promise;

			const config = readConfig(process.env.INFINITY_CONFIG_PATH as string);
			expect(config.provider).toBe("anthropic");
			expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining("Enter provider:"));
			expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Set provider = anthropic"));
			consoleSpy.mockRestore();
			stdoutSpy.mockRestore();
		});

		it("masks echoed input for sensitive keys in TTY", async () => {
			const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
			const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
			Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
			(process.stdin as NodeJS.ReadStream & { setRawMode: (mode: boolean) => void }).setRawMode =
				vi.fn();
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

			const promise = configCommand.parseAsync(["set", "apiKey.openai"], { from: "user" });
			setImmediate(() => {
				process.stdin.emit("data", Buffer.from("sk-secret\n"));
			});
			await promise;

			const config = readConfig(process.env.INFINITY_CONFIG_PATH as string);
			expect(config.apiKeys.openai).toBe("sk-secret");
			expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining("Enter apiKey.openai:"));
			expect(stdoutSpy).toHaveBeenCalledWith("*");
			expect(stdoutSpy).not.toHaveBeenCalledWith(expect.stringContaining("sk-secret"));
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining("Set apiKey.openai = ********"),
			);
			consoleSpy.mockRestore();
			stdoutSpy.mockRestore();
		});

		it("errors and sets exit code when value is missing in non-TTY", async () => {
			const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
			Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
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

			await configCommand.parseAsync(["set", "provider"], { from: "user" });

			expect(consoleErrorSpy).toHaveBeenCalledWith(
				expect.stringContaining("Error: value is required"),
			);
			expect(process.exitCode).toBe(1);
			consoleErrorSpy.mockRestore();
		});

		it("auto-detects provider from API key token and stores masked", async () => {
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

			await configCommand.parseAsync(["set", "sk-test12345"], { from: "user" });

			const config = readConfig(process.env.INFINITY_CONFIG_PATH as string);
			expect(config.apiKeys.openai).toBe("sk-test12345");
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining("Set apiKey.openai = ********"),
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
