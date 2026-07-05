import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { testingTool } from "./testing.js";
import type { ToolContext } from "./types.js";

function safeRemove(dir: string): void {
	for (let i = 0; i < 5; i++) {
		try {
			rmSync(dir, { recursive: true, force: true });
			return;
		} catch {
			// On Windows spawned processes may briefly lock the temp directory.
			if (i < 4) {
				const start = Date.now();
				while (Date.now() - start < 200) {
					/* spin */
				}
			}
		}
	}
}

describe("testingTool", () => {
	let tempDir: string;
	let context: ToolContext;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "testing-tool-test-"));
		context = { workspace: tempDir, cwd: tempDir };
	});

	afterEach(() => {
		safeRemove(tempDir);
	});

	it("should handle unknown framework gracefully", async () => {
		const result = await testingTool.execute(
			{ framework: "unknown" as "vitest", args: "" },
			context,
		);
		expect(result.success).toBe(false);
		expect(result.error).toBeDefined();
	});

	it("should run npm test command (dry run)", async () => {
		// Test that the command is formed correctly by checking error for non-existent script
		writeFileSync(
			join(tempDir, "package.json"),
			JSON.stringify(
				{
					name: "test-project",
					type: "module",
					scripts: { test: "echo hello" },
				},
				null,
				2,
			),
		);

		const result = await testingTool.execute(
			{ framework: "npm", args: "", cwd: tempDir },
			{ ...context, cwd: tempDir },
		);
		// npm test will run 'echo hello' which succeeds
		expect(result.success).toBe(true);
		expect(result.output).toContain("hello");
	}, 30000);

	it("should handle npm test failure", async () => {
		writeFileSync(
			join(tempDir, "package.json"),
			JSON.stringify(
				{
					name: "test-project",
					type: "module",
					scripts: { test: "exit 1" },
				},
				null,
				2,
			),
		);

		const result = await testingTool.execute(
			{ framework: "npm", args: "", cwd: tempDir },
			{ ...context, cwd: tempDir },
		);
		expect(result.success).toBe(false);
	}, 30000);
});
