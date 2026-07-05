import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SandboxPolicy } from "../security/sandbox.js";
import { shellTool } from "./shell.js";
import type { ToolContext } from "./types.js";

describe("shellTool", () => {
	let tempDir: string;
	let context: ToolContext;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "shell-tool-test-"));
		context = { workspace: tempDir, cwd: tempDir };
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("should execute echo command", async () => {
		const result = await shellTool.execute({ command: "echo hello" }, context);
		expect(result.success).toBe(true);
		expect(result.output).toContain("hello");
	});

	it("should block rm -rf / pattern", async () => {
		const result = await shellTool.execute({ command: "rm -rf /" }, context);
		expect(result.success).toBe(false);
		expect(result.error).toContain("Blocked dangerous command pattern");
		expect(result.error).toContain("rm -rf /");
	});

	it("should block fork bomb pattern", async () => {
		const result = await shellTool.execute({ command: ":(){ :|:& };:" }, context);
		expect(result.success).toBe(false);
		expect(result.error).toContain("Blocked dangerous command pattern");
	});

	it("should block /dev/sda pattern", async () => {
		const result = await shellTool.execute({ command: "echo test > /dev/sda" }, context);
		expect(result.success).toBe(false);
		expect(result.error).toContain("Blocked dangerous command pattern");
	});

	it("should block mkfs pattern", async () => {
		const result = await shellTool.execute({ command: "mkfs.ext4 /dev/sda1" }, context);
		expect(result.success).toBe(false);
		expect(result.error).toContain("Blocked dangerous command pattern");
	});

	it("should return failure for nonexistent command", async () => {
		const result = await shellTool.execute({ command: "nonexistentcommand12345" }, context);
		expect(result.success).toBe(false);
		expect(result.error).toContain("exited with code");
	});

	it("should respect custom cwd", async () => {
		const subDir = join(tempDir, "subdir");
		const { mkdirSync } = await import("node:fs");
		mkdirSync(subDir, { recursive: true });

		// Use cross-platform command to print working directory
		const command = process.platform === "win32" ? "cd" : "pwd";
		const result = await shellTool.execute({ command, cwd: subDir }, context);
		expect(result.success).toBe(true);
		expect(result.output).toContain(subDir);
	});

	it("should capture stderr", async () => {
		const result = await shellTool.execute({ command: "echo stderr >&2" }, context);
		// Command succeeds but writes to stderr
		expect(result.success).toBe(true);
	});

	it("should deny dangerous command when sandbox is provided", async () => {
		const sandbox = new SandboxPolicy({ workspace: tempDir });
		const contextWithSandbox: ToolContext = { ...context, sandbox };

		const result = await shellTool.execute({ command: "rm -rf /" }, contextWithSandbox);
		expect(result.success).toBe(false);
		expect(result.error).toContain("blocked by sandbox policy");
	});

	it("should allow safe command when sandbox is provided", async () => {
		const sandbox = new SandboxPolicy({ workspace: tempDir });
		const contextWithSandbox: ToolContext = { ...context, sandbox };

		const result = await shellTool.execute({ command: "echo safe" }, contextWithSandbox);
		expect(result.success).toBe(true);
		expect(result.output).toContain("safe");
	});

	it("should deny custom blocked pattern when sandbox is provided", async () => {
		const sandbox = new SandboxPolicy({
			workspace: tempDir,
			blockedPatterns: ["forbidden-command"],
		});
		const contextWithSandbox: ToolContext = { ...context, sandbox };

		const result = await shellTool.execute(
			{ command: "forbidden-command arg" },
			contextWithSandbox,
		);
		expect(result.success).toBe(false);
		expect(result.error).toContain("blocked by sandbox policy");
	});

	it("should allow all commands when allowAll is true", async () => {
		const sandbox = new SandboxPolicy({ workspace: tempDir, allowAll: true });
		const contextWithSandbox: ToolContext = { ...context, sandbox };

		const result = await shellTool.execute({ command: "rm -rf /" }, contextWithSandbox);
		// allowAll bypasses checks, but the command will fail at execution
		// The important thing is it doesn't get blocked by sandbox
		expect(result.error).not.toContain("blocked by sandbox policy");
	});
});
