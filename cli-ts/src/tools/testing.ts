import { spawn } from "node:child_process";
import { z } from "zod";
import type { Tool, ToolContext, ToolResult } from "./types.js";

const testingInputSchema = z.object({
	framework: z.enum(["vitest", "jest", "pytest", "npm"]),
	args: z.string().optional().default(""),
	cwd: z.string().optional(),
});

function getTestCommand(framework: string, args: string): string {
	switch (framework) {
		case "vitest":
			return `npx vitest run ${args}`.trim();
		case "jest":
			return `npx jest ${args}`.trim();
		case "pytest":
			return `python -m pytest ${args}`.trim();
		case "npm":
			return `npm test -- ${args}`.trim();
		default:
			throw new Error(`Unknown test framework: ${framework}`);
	}
}

function runCommand(
	command: string,
	cwd: string | undefined,
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

		child.on("close", (code) => {
			resolve({ stdout, stderr, code: code ?? 0 });
		});
		child.on("error", (error) => {
			resolve({ stdout, stderr: error.message, code: 1 });
		});
	});
}

export const testingTool: Tool = {
	name: "testing",
	description: "Run tests with various frameworks",
	inputSchema: testingInputSchema,
	async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
		let parsed: z.infer<typeof testingInputSchema>;
		try {
			parsed = testingInputSchema.parse(input);
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
		const { framework, args, cwd } = parsed;

		const workingDir = cwd ? cwd : (context.cwd ?? context.workspace);

		try {
			const command = getTestCommand(framework, args);
			const result = await runCommand(command, workingDir);
			const output = result.stdout.trim() + (result.stderr ? `\n${result.stderr.trim()}` : "");
			return result.code === 0
				? { success: true, output: output.trim() }
				: {
						success: false,
						output: output.trim(),
						error: `Tests failed with exit code ${result.code}`,
					};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	},
};
