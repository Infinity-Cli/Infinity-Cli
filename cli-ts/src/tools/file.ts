import { promises as fs } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { z } from "zod";
import { type Tool, type ToolContext, ToolError, type ToolResult } from "./types.js";

const fileInputSchema = z.object({
	operation: z.enum(["read", "write", "list", "delete"]),
	path: z.string(),
	content: z.string().optional(),
});

export const fileTool: Tool = {
	name: "file",
	description: "File operations: read, write, list, delete",
	inputSchema: fileInputSchema,
	async execute(input: unknown, context: ToolContext): Promise<ToolResult> {
		const parsed = fileInputSchema.parse(input);
		const { operation, path, content } = parsed;

		const baseDir = context.cwd ?? context.workspace;
		const fullPath = resolve(baseDir, path);

		try {
			// Sandbox path validation (if sandbox is provided)
			if (context.sandbox) {
				context.sandbox.assertPathAllowed(fullPath);
			} else {
				// Fallback: ensure the resolved path is within the workspace
				const workspaceResolved = resolve(context.workspace);
				const relativePath = relative(workspaceResolved, fullPath);
				if (relativePath.startsWith("..")) {
					return {
						success: false,
						error: "Path traversal outside workspace is not allowed",
					};
				}
			}

			switch (operation) {
				case "read": {
					const fileContent = await fs.readFile(fullPath, "utf-8");
					return { success: true, output: fileContent };
				}
				case "write": {
					if (content === undefined) {
						return { success: false, error: "Content is required for write operation" };
					}
					await fs.mkdir(dirname(fullPath), { recursive: true });
					await fs.writeFile(fullPath, content, "utf-8");
					return { success: true, output: `Written to ${path}` };
				}
				case "list": {
					const entries = await fs.readdir(fullPath, { withFileTypes: true });
					const files = entries.map((entry) => entry.name);
					return { success: true, output: files.join("\n"), data: files };
				}
				case "delete": {
					if (!context.allowDestructive) {
						throw new ToolError(
							"Destructive operations require permission",
							"DESTRUCTIVE_OPERATION",
						);
					}
					await fs.rm(fullPath, { recursive: true, force: true });
					return { success: true, output: `Deleted ${path}` };
				}
				default: {
					return { success: false, error: `Unknown operation: ${operation}` };
				}
			}
		} catch (error) {
			if (error instanceof ToolError) {
				return { success: false, error: error.message };
			}
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	},
};
