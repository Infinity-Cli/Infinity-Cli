import { spawn } from "node:child_process";
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "./types.js";

const DANGEROUS_PATTERNS = ["rm -rf /", ":(){ :|:& };:", "> /dev/sda", "mkfs"];

const shellInputSchema = z.object({
	command: z.string(),
	cwd: z.string().optional(),
	timeout: z.number().int().positive().optional().default(30000),
});

function containsDangerousPattern(command: string): string | null {
	for (const pattern of DANGEROUS_PATTERNS) {
		if (command.includes(pattern)) {
			return pattern;
		}
	}
	return null;
}

function runCommand(
	command: string,
	cwd: string | undefined,
	timeoutMs: number,
): Promise<{ stdout: string; stderr: string; code: number }> {
	return new Promise((resolve) => {
		const child = spawn(command, {
			cwd,
			shell: true,
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";

		child.stdout.on("data", (data) => {
			stdout += data.toString();
		});
		child.stderr.on("data", (data) => {
			stderr += data.toString();
		});

		const timeoutId = setTimeout(() => {
			child.kill("SIGKILL");
			resolve({ stdout, stderr: `${stderr}\nCommand timed out`, code: 124 });
		}, timeoutMs);

		child.on("close", (code) => {
			clearTimeout(timeoutId);
			resolve({ stdout, stderr, code: code ?? 0 });
		});
		child.on("error", (error) => {
			clearTimeout(timeoutId);
			resolve({ stdout, stderr: error.message, code: 1 });
		});
	});
}

export const shellTool: Tool = {
	name: "shell",
	description: "Execute shell commands",
	inputSchema: shellInputSchema,
	async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
		const parsed = shellInputSchema.parse(input);
		const { command, cwd, timeout } = parsed;

		// Sandbox command validation (if sandbox is provided)
		if (context.sandbox) {
			try {
				context.sandbox.assertShellCommandAllowed(command);
			} catch (error) {
				if (error instanceof Error && error.name === "SandboxError") {
					return { success: false, error: error.message };
				}
				throw error;
			}
		} else {
			// Fallback: check built-in dangerous patterns
			const dangerousPattern = containsDangerousPattern(command);
			if (dangerousPattern) {
				return {
					success: false,
					error: `Blocked dangerous command pattern: ${dangerousPattern}`,
				};
			}
		}

		const workingDir = cwd ? cwd : (context.cwd ?? context.workspace);

		try {
			const result = await runCommand(command, workingDir, timeout);
			const output = result.stdout.trim() + (result.stderr ? `\n${result.stderr.trim()}` : "");
			return result.code === 0
				? { success: true, output: output.trim() }
				: {
						success: false,
						output: output.trim(),
						error: `Command exited with code ${result.code}`,
					};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	},
};
