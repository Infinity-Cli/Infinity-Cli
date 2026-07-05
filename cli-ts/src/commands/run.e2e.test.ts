import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCommand } from "./run.js";

describe("run command e2e", () => {
	let originalFetch: typeof global.fetch;
	let originalHome: string | undefined;
	let originalConfigPath: string | undefined;
	let tempDir: string;

	beforeEach(() => {
		originalFetch = global.fetch;
		originalHome = process.env.HOME;
		originalConfigPath = process.env.INFINITY_CONFIG_PATH;
		tempDir = mkdtempSync(join(tmpdir(), "infinity-run-e2e-"));
		process.env.HOME = tempDir;
		process.env.INFINITY_CONFIG_PATH = join(tempDir, "config.json");
		writeFileSync(
			process.env.INFINITY_CONFIG_PATH,
			JSON.stringify(
				{
					provider: "openai",
					model: "gpt-4o-mini",
					apiKeys: { openai: "test-key" },
					defaultProvider: "openai",
					serverUrl: "http://127.0.0.1:8000",
				},
				null,
				2,
			),
		);

		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ success: true }),
		} as Response);
	});

	afterEach(() => {
		global.fetch = originalFetch;
		if (originalHome === undefined) {
			process.env.HOME = undefined;
		} else {
			process.env.HOME = originalHome;
		}
		if (originalConfigPath === undefined) {
			process.env.INFINITY_CONFIG_PATH = undefined;
		} else {
			process.env.INFINITY_CONFIG_PATH = originalConfigPath;
		}
		vi.restoreAllMocks();
	});

	it("executes a full autonomous coding task with a mocked bridge", async () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		try {
			await runCommand.parseAsync(["say hello", "--yes", "--max-agents", "1"], { from: "user" });

			const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
			expect(output).toContain("Delegating to runtime");
			expect(output).toContain("planner");
			expect(output).toContain("code");
			expect(output).toContain("reviewer");
			expect(output).toContain("Execution Summary");
			expect(output).toContain("Completed:");
			expect(output).toContain("Total:");

			expect(global.fetch).toHaveBeenCalled();
			const calls = (global.fetch as Mock).mock.calls as Array<[string, RequestInit]>;
			for (const [url] of calls) {
				expect(url).toMatch(/^http:\/\/127\.0\.0\.1:8000/);
			}
		} finally {
			consoleSpy.mockRestore();
		}
	});
});
