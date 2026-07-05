import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SandboxPolicy } from "../security/sandbox.js";
import { gitTool } from "./git.js";
import type { ToolContext } from "./types.js";

function safeRemove(dir: string): void {
	for (let i = 0; i < 5; i++) {
		try {
			rmSync(dir, { recursive: true, force: true });
			return;
		} catch {
			if (i < 4) {
				const start = Date.now();
				while (Date.now() - start < 200) {
					/* spin */
				}
			}
		}
	}
}

async function runGit(
	args: string[],
	cwd: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
	return new Promise((resolve) => {
		const child = spawn("git", args, { cwd, shell: false });
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (data) => {
			stdout += data.toString();
		});
		child.stderr.on("data", (data) => {
			stderr += data.toString();
		});
		child.on("close", (code) => {
			resolve({ stdout, stderr, code: code ?? 0 });
		});
		child.on("error", (error) => {
			resolve({ stdout, stderr: error.message, code: 1 });
		});
	});
}

async function initRepo(dir: string): Promise<void> {
	await runGit(["init"], dir);
	await runGit(["config", "user.email", "test@test.com"], dir);
	await runGit(["config", "user.name", "Test User"], dir);
	writeFileSync(join(dir, "README.md"), "# Test Repo");
	await runGit(["add", "."], dir);
	await runGit(["commit", "-m", "Initial commit"], dir);
}

describe("gitTool", () => {
	let tempDir: string;
	let context: ToolContext;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "git-tool-test-"));
		context = { workspace: tempDir, cwd: tempDir };
	});

	afterEach(() => {
		safeRemove(tempDir);
	});

	it("should return status for a git repo", async () => {
		await initRepo(tempDir);
		writeFileSync(join(tempDir, "new-file.txt"), "new content");

		const result = await gitTool.execute({ operation: "status" }, context);
		expect(result.success).toBe(true);
		expect(result.output).toContain("new-file.txt");
	});

	it("should return diff for a git repo", async () => {
		await initRepo(tempDir);
		writeFileSync(join(tempDir, "README.md"), "# Modified Test Repo");

		const result = await gitTool.execute({ operation: "diff" }, context);
		expect(result.success).toBe(true);
		expect(result.output).toContain("Modified Test Repo");
	});

	it("should return log for a git repo", async () => {
		await initRepo(tempDir);

		const result = await gitTool.execute({ operation: "log", limit: 5 }, context);
		expect(result.success).toBe(true);
		expect(result.output).toContain("Initial commit");
	});

	it("should clone a local repo", async () => {
		const sourceDir = mkdtempSync(join(tmpdir(), "git-source-"));
		await initRepo(sourceDir);

		const result = await gitTool.execute(
			{ operation: "clone", remoteUrl: sourceDir, repoPath: "cloned-repo" },
			context,
		);
		expect(result.success).toBe(true);

		// Verify the clone worked
		const cloneDir = join(tempDir, "cloned-repo");
		const statusResult = await gitTool.execute(
			{ operation: "status", repoPath: "cloned-repo" },
			context,
		);
		expect(statusResult.success).toBe(true);

		safeRemove(sourceDir);
	}, 30000);

	it("should fail clone without remoteUrl", async () => {
		const result = await gitTool.execute({ operation: "clone", repoPath: "cloned-repo" }, context);
		expect(result.success).toBe(false);
		expect(result.error).toContain("remoteUrl is required");
	});

	it("should fail clone without repoPath", async () => {
		const result = await gitTool.execute(
			{ operation: "clone", remoteUrl: "https://example.com/repo.git" },
			context,
		);
		expect(result.success).toBe(false);
		expect(result.error).toContain("repoPath is required");
	});

	it("should deny clone outside workspace when sandbox is provided", async () => {
		const outsideDir = mkdtempSync(join(tmpdir(), "outside-clone-"));
		try {
			const sandbox = new SandboxPolicy({ workspace: tempDir });
			const contextWithSandbox: ToolContext = { ...context, sandbox };

			const result = await gitTool.execute(
				{
					operation: "clone",
					remoteUrl: "https://example.com/repo.git",
					repoPath: join(outsideDir, "cloned"),
				},
				contextWithSandbox,
			);
			expect(result.success).toBe(false);
			expect(result.error).toContain("not allowed by sandbox policy");
		} finally {
			safeRemove(outsideDir);
		}
	});

	it("should allow clone within workspace when sandbox is provided", async () => {
		const sourceDir = mkdtempSync(join(tmpdir(), "git-source-"));
		await initRepo(sourceDir);

		const sandbox = new SandboxPolicy({ workspace: tempDir });
		const contextWithSandbox: ToolContext = { ...context, sandbox };

		const result = await gitTool.execute(
			{ operation: "clone", remoteUrl: sourceDir, repoPath: "cloned-repo" },
			contextWithSandbox,
		);
		expect(result.success).toBe(true);

		safeRemove(sourceDir);
	}, 30000);

	it("should deny git operations outside workspace when sandbox is provided", async () => {
		const outsideDir = mkdtempSync(join(tmpdir(), "outside-git-"));
		try {
			await initRepo(outsideDir);

			const sandbox = new SandboxPolicy({ workspace: tempDir });
			const contextWithSandbox: ToolContext = { ...context, sandbox };

			const result = await gitTool.execute(
				{ operation: "status", repoPath: outsideDir },
				contextWithSandbox,
			);
			expect(result.success).toBe(false);
			expect(result.error).toContain("not allowed by sandbox policy");
		} finally {
			safeRemove(outsideDir);
		}
	});

	it("should allow git operations within workspace when sandbox is provided", async () => {
		await initRepo(tempDir);
		writeFileSync(join(tempDir, "new-file.txt"), "new content");

		const sandbox = new SandboxPolicy({ workspace: tempDir });
		const contextWithSandbox: ToolContext = { ...context, sandbox };

		const result = await gitTool.execute({ operation: "status" }, contextWithSandbox);
		expect(result.success).toBe(true);
		expect(result.output).toContain("new-file.txt");
	});

	it("should allow git operations in allowedPaths when sandbox is provided", async () => {
		const extraDir = mkdtempSync(join(tmpdir(), "extra-git-"));
		try {
			await initRepo(extraDir);
			writeFileSync(join(extraDir, "extra-file.txt"), "extra content");

			const sandbox = new SandboxPolicy({ workspace: tempDir, allowedPaths: [extraDir] });
			const contextWithSandbox: ToolContext = { ...context, sandbox };

			const result = await gitTool.execute(
				{ operation: "status", repoPath: extraDir },
				contextWithSandbox,
			);
			expect(result.success).toBe(true);
			expect(result.output).toContain("extra-file.txt");
		} finally {
			safeRemove(extraDir);
		}
	});
});
