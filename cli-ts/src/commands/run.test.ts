import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCommand } from "./run.js";

describe("run command", () => {
	let testMemoryDir: string;
	let testConfigDir: string;
	let originalEnv: NodeJS.ProcessEnv;
	let originalCwd: string;
	let originalFetch: typeof global.fetch;

	beforeEach(() => {
		testMemoryDir = mkdtempSync(join(tmpdir(), "inf-memory-"));
		testConfigDir = mkdtempSync(join(tmpdir(), "inf-config-"));
		originalEnv = { ...process.env };
		process.env.INFINITY_MEMORY_PATH = testMemoryDir;
		process.env.INFINITY_CONFIG_PATH = join(testConfigDir, "config.json");
		originalCwd = process.cwd();
		originalFetch = global.fetch;
	});

	afterEach(() => {
		process.env = originalEnv;
		rmSync(testMemoryDir, { recursive: true, force: true });
		rmSync(testConfigDir, { recursive: true, force: true });
		process.chdir(originalCwd);
		global.fetch = originalFetch;
	});

	it('exports a run command named "run"', () => {
		expect(runCommand.name()).toBe("run");
	});

	it("registers the --repo option", () => {
		const opts = runCommand.options;
		const repo = opts.find((o) => o.long === "--repo");
		expect(repo).toBeDefined();
	});

	it("registers the --plan option", () => {
		const opts = runCommand.options;
		const plan = opts.find((o) => o.long === "--plan");
		expect(plan).toBeDefined();
	});

	it("registers the --yes option", () => {
		const opts = runCommand.options;
		const yes = opts.find((o) => o.long === "--yes");
		expect(yes).toBeDefined();
	});

	it("registers the --max-agents option", () => {
		const opts = runCommand.options;
		const maxAgents = opts.find((o) => o.long === "--max-agents");
		expect(maxAgents).toBeDefined();
	});

	it("registers the --dry-run option", () => {
		const opts = runCommand.options;
		const dryRun = opts.find((o) => o.long === "--dry-run");
		expect(dryRun).toBeDefined();
	});

	it("registers the --session option", () => {
		const opts = runCommand.options;
		const session = opts.find((o) => o.long === "--session");
		expect(session).toBeDefined();
	});

	it("registers the --output option", () => {
		const opts = runCommand.options;
		const output = opts.find((o) => o.long === "--output");
		expect(output).toBeDefined();
	});

	it("exits with error when goal is missing", async () => {
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
			throw new Error(`exit:${code}`);
		});

		try {
			await expect(runCommand.parseAsync([], { from: "user" })).rejects.toThrow("exit:1");
			expect(consoleErrorSpy).toHaveBeenCalledWith(
				expect.stringContaining("Error: Goal argument is required"),
			);
		} finally {
			consoleErrorSpy.mockRestore();
			exitSpy.mockRestore();
		}
	});

	it("--plan prints tasks and exits 0 without executing", async () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		try {
			await runCommand.parseAsync(["add a login route", "--plan"], { from: "user" });
			const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
			expect(output).toContain("Execution Plan");
			expect(output).toContain("Goal: add a login route");
			expect(output).toContain("Tasks: 5");
			// Check for all 5 task roles
			expect(output).toContain("planner");
			expect(output).toContain("code");
			expect(output).toContain("reviewer");
			expect(output).toContain("documentation");
			expect(output).toContain("security");
		} finally {
			consoleSpy.mockRestore();
			consoleErrorSpy.mockRestore();
		}
	});

	it("joins multi-word goals passed as separate arguments", async () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		try {
			await runCommand.parseAsync(["add", "a", "login", "route", "--plan"], { from: "user" });
			const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
			expect(output).toContain("Execution Plan");
			expect(output).toContain("Goal: add a login route");
			expect(output).toContain("Tasks: 5");
		} finally {
			consoleSpy.mockRestore();
			consoleErrorSpy.mockRestore();
		}
	});

	it('--dry-run prints "Would execute" lines and a summary, exits 0', async () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		try {
			await runCommand.parseAsync(["implement a feature", "--dry-run"], { from: "user" });
			const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
			expect(output).toContain("Would execute:");
			expect(output).toContain("planner - Analyze goal and plan tasks");
			expect(output).toContain("code - Implement the requested change");
			expect(output).toContain("reviewer - Review implementation");
			expect(output).toContain("documentation - Update documentation");
			expect(output).toContain("security - Security review");
			expect(output).toContain("Execution Summary");
			expect(output).toContain("Completed:");
			expect(output).toContain("Total:");
		} finally {
			consoleSpy.mockRestore();
			consoleErrorSpy.mockRestore();
		}
	});

	it('--yes with no TTY proceeds in real mode (logs "Delegating to runtime")', async () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		// Mock stdin as not TTY
		const originalIsTTY = process.stdin.isTTY;
		Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });

		// Mock fetch to return successful RunResult
		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				success: true,
				goal: "add tests",
				completed: ["task-1", "task-2"],
				failed: [],
			}),
		} as Response);

		try {
			await runCommand.parseAsync(["add tests", "--yes", "--max-agents", "2"], { from: "user" });
			const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
			expect(output).toContain("Delegating to runtime:");
			expect(output).toContain("planner - Analyze goal and plan tasks");
			expect(output).toContain("Execution Summary");
		} finally {
			Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true });
			consoleSpy.mockRestore();
			consoleErrorSpy.mockRestore();
		}
	});

	it("--max-agents overrides concurrency", async () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const originalIsTTY = process.stdin.isTTY;
		Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });

		try {
			await runCommand.parseAsync(["refactor code", "--dry-run", "--max-agents", "5"], {
				from: "user",
			});
			const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
			expect(output).toContain("Would execute:");
			expect(output).toContain("Execution Summary");
		} finally {
			Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true });
			consoleSpy.mockRestore();
			consoleErrorSpy.mockRestore();
		}
	});

	it("--session uses specified session id", async () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const originalIsTTY = process.stdin.isTTY;
		Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });

		try {
			await runCommand.parseAsync(["test goal", "--dry-run", "--session", "custom-session"], {
				from: "user",
			});
			const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
			expect(output).toContain("Would execute:");
		} finally {
			Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true });
			consoleSpy.mockRestore();
			consoleErrorSpy.mockRestore();
		}
	});

	it("--plan with no goal still prints plan and exits 1", async () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
			throw new Error(`exit:${code}`);
		});

		try {
			await expect(runCommand.parseAsync(["--plan"], { from: "user" })).rejects.toThrow("exit:1");
			expect(consoleErrorSpy).toHaveBeenCalledWith(
				expect.stringContaining("Error: Goal argument is required"),
			);
		} finally {
			consoleSpy.mockRestore();
			consoleErrorSpy.mockRestore();
			exitSpy.mockRestore();
		}
	});

	it("--output markdown prints a markdown report", async () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		try {
			await runCommand.parseAsync(["say hello", "--yes", "--output", "markdown"], { from: "user" });
			const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
			expect(output).toContain("# Execution Report");
			expect(output).toContain("## Goal");
			expect(output).toContain("say hello");
			expect(output).toContain("## Summary");
			expect(output).toContain("| Completed |");
		} finally {
			consoleSpy.mockRestore();
			consoleErrorSpy.mockRestore();
		}
	});

	it("--output json prints valid JSON", async () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		try {
			await runCommand.parseAsync(["say hello", "--yes", "--output", "json"], { from: "user" });
			const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
			const start = output.indexOf("[");
			const end = output.lastIndexOf("]");
			expect(start).toBeGreaterThanOrEqual(0);
			expect(end).toBeGreaterThan(start);
			const events = JSON.parse(output.slice(start, end + 1)) as Array<{ type: string }>;
			expect(Array.isArray(events)).toBe(true);
			expect(events.some((e) => e.type === "summary")).toBe(true);
		} finally {
			consoleSpy.mockRestore();
			consoleErrorSpy.mockRestore();
		}
	});
});
