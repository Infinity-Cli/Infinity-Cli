import type { z } from "zod";
import type { PermissionManager } from "../security/permissions.js";
import type { SandboxPolicy } from "../security/sandbox.js";
import { Tool, type ToolContext, ToolError, type ToolRegistry, type ToolResult } from "./types.js";

export interface ToolExecutorOptions {
	registry: ToolRegistry;
	workspace: string;
	sandbox?: SandboxPolicy;
	permissionManager?: PermissionManager;
}

export class ToolExecutor {
	private registry: ToolRegistry;
	private workspace: string;
	private sandbox?: SandboxPolicy;
	private permissionManager?: PermissionManager;

	constructor(options: ToolExecutorOptions) {
		this.registry = options.registry;
		this.workspace = options.workspace;
		this.sandbox = options.sandbox;
		this.permissionManager = options.permissionManager;
	}

	async execute(name: string, input: unknown): Promise<ToolResult> {
		const tool = this.registry.get(name);
		if (!tool) {
			return { success: false, error: `Tool not found: ${name}` };
		}

		let parsed: unknown;
		try {
			const safe = tool.inputSchema.safeParse?.(input);
			if (safe && "success" in safe) {
				if (!safe.success) {
					return { success: false, error: `Invalid input: ${safe.error.message}` };
				}
				parsed = safe.data;
			} else {
				parsed = (tool.inputSchema as z.ZodSchema).parse(input);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { success: false, error: `Invalid input: ${message}` };
		}

		const permission = await this.checkPermission(name, parsed);
		if (!permission.allowed) {
			const reason = permission.reason ? `: ${permission.reason}` : "";
			return { success: false, error: `Permission denied${reason}` };
		}

		const context: ToolContext = {
			workspace: this.workspace,
			cwd: this.workspace,
			sandbox: this.sandbox,
			allowDestructive: true,
		};

		try {
			return await tool.execute(parsed, context);
		} catch (error) {
			if (error instanceof ToolError) {
				return { success: false, error: error.message };
			}
			const message = error instanceof Error ? error.message : String(error);
			return { success: false, error: message };
		}
	}

	private async checkPermission(
		name: string,
		input: unknown,
	): Promise<{ allowed: boolean; reason?: string }> {
		if (!this.permissionManager) {
			return { allowed: true };
		}

		if (name === "file" && isObject(input) && input.operation === "delete") {
			const decision = await this.permissionManager.requestPermission({
				tool: "file",
				operation: "delete",
				description: `Delete file ${String(input.path ?? "")}`,
				path: typeof input.path === "string" ? input.path : undefined,
				destructive: true,
			});
			return { allowed: decision.allowed, reason: decision.reason };
		}

		if (name === "shell" && isObject(input) && typeof input.command === "string") {
			const decision = await this.permissionManager.requestPermission({
				tool: "shell",
				operation: "execute",
				description: `Execute shell command: ${input.command}`,
				destructive: true,
			});
			return { allowed: decision.allowed, reason: decision.reason };
		}

		return { allowed: true };
	}
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
