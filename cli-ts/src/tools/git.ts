import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "./types.js";

const gitInputSchema = z.object({
	operation: z.enum(["status", "diff", "log", "clone"]),
	repoPath: z.string().optional(),
	remoteUrl: z.string().optional(),
	limit: z.number().int().positive().optional().default(10),
});

function runGit(
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

export const gitTool: Tool = {
	name: "git",
	description: "Git operations: status, diff, log, clone",
	inputSchema: gitInputSchema,
	async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
		const parsed = gitInputSchema.parse(input);
		const { operation, repoPath, remoteUrl, limit } = parsed;

		const workspace = context.workspace;
		const workingDir = repoPath ? resolve(workspace, repoPath) : workspace;

		// Sandbox path validation (if sandbox is provided)
		if (context.sandbox) {
			try {
				// For clone, validate the target path; for other operations, validate the repo path
				const pathToCheck =
					operation === "clone" && repoPath ? resolve(workspace, repoPath) : workingDir;
				context.sandbox.assertPathAllowed(pathToCheck);
			} catch (error) {
				if (error instanceof Error && error.name === "SandboxError") {
					return { success: false, error: error.message };
				}
				throw error;
			}
		}

		try {
			switch (operation) {
				case "status": {
					const result = await runGit(["status", "--short"], workingDir);
					return result.code === 0
						? { success: true, output: result.stdout.trim() }
						: { success: false, error: result.stderr.trim() || "Git status failed" };
				}
				case "diff": {
					const result = await runGit(["diff"], workingDir);
					return result.code === 0
						? { success: true, output: result.stdout.trim() }
						: { success: false, error: result.stderr.trim() || "Git diff failed" };
				}
				case "log": {
					const result = await runGit(["log", `--max-count=${limit}`, "--oneline"], workingDir);
					return result.code === 0
						? { success: true, output: result.stdout.trim() }
						: { success: false, error: result.stderr.trim() || "Git log failed" };
				}
				case "clone": {
					if (!remoteUrl) {
						return { success: false, error: "remoteUrl is required for clone operation" };
					}
					if (!repoPath) {
						return { success: false, error: "repoPath is required for clone operation" };
					}
					const targetPath = resolve(workspace, repoPath);
					const result = await runGit(["clone", remoteUrl, targetPath], workspace);
					return result.code === 0
						? { success: true, output: result.stdout.trim() }
						: { success: false, error: result.stderr.trim() || "Git clone failed" };
				}
				default: {
					return { success: false, error: `Unknown operation: ${operation}` };
				}
			}
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	},
};
