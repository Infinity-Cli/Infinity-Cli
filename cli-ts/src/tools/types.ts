import type { z } from "zod";

export interface ToolResult {
	success: boolean;
	output?: string;
	error?: string;
	data?: unknown;
}

export interface SandboxPolicyLike {
	assertPathAllowed(path: string): void;
	assertShellCommandAllowed(command: string): void;
}

export interface ToolContext {
	workspace: string;
	session?: string;
	env?: Record<string, string>;
	cwd?: string;
	allowDestructive?: boolean;
	sandbox?: SandboxPolicyLike;
}

export interface Tool {
	name: string;
	description: string;
	inputSchema: z.ZodSchema;
	execute(input: unknown, context: ToolContext): Promise<ToolResult>;
}

export class ToolError extends Error {
	constructor(
		message: string,
		public readonly code?: string,
	) {
		super(message);
		this.name = "ToolError";
	}
}

export class ToolRegistry {
	private tools = new Map<string, Tool>();

	register(tool: Tool): void {
		this.tools.set(tool.name, tool);
	}

	get(name: string): Tool | undefined {
		return this.tools.get(name);
	}

	list(): Tool[] {
		return Array.from(this.tools.values());
	}

	static createBuiltinRegistry(): ToolRegistry {
		const registry = new ToolRegistry();
		return registry;
	}
}
