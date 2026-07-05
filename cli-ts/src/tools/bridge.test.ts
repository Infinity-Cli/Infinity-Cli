import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PermissionManager } from "../security/permissions.js";
import { SandboxPolicy } from "../security/sandbox.js";
import { createToolBridgeHandler } from "./bridge.js";
import { ToolExecutor } from "./executor.js";
import { fileTool } from "./file.js";
import { shellTool } from "./shell.js";
import { ToolRegistry } from "./types.js";

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

describe("tool bridge", () => {
	let tempDir: string;
	let registry: ToolRegistry;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "tool-bridge-test-"));
		registry = new ToolRegistry();
		registry.register(fileTool);
		registry.register(shellTool);
	});

	afterEach(() => {
		safeRemove(tempDir);
	});

	function createHandler(
		options: { sandbox?: SandboxPolicy; permissionManager?: PermissionManager } = {},
	) {
		const executor = new ToolExecutor({
			registry,
			workspace: tempDir,
			sandbox: options.sandbox,
			permissionManager: options.permissionManager,
		});
		return createToolBridgeHandler(executor);
	}

	it("writes and reads a file through the bridge", async () => {
		const handler = createHandler();

		const writeResult = await handler({
			tool: "file",
			input: { operation: "write", path: "bridge.txt", content: "hello bridge" },
		});
		expect(writeResult.success).toBe(true);

		const readResult = await handler({
			tool: "file",
			input: { operation: "read", path: "bridge.txt" },
		});
		expect(readResult.success).toBe(true);
		expect(readResult.output).toBe("hello bridge");
	});

	it("returns error for unknown tool", async () => {
		const handler = createHandler();

		const result = await handler({ tool: "browser", input: {} });
		expect(result.success).toBe(false);
		expect(result.error).toContain("Tool not found");
	});

	it("returns error for invalid input", async () => {
		const handler = createHandler();

		const result = await handler({ tool: "file", input: { operation: "unknown" } });
		expect(result.success).toBe(false);
		expect(result.error).toContain("Invalid input");
	});

	it("blocks paths outside workspace via sandbox", async () => {
		const outsideDir = mkdtempSync(join(tmpdir(), "outside-bridge-"));
		try {
			const sandbox = new SandboxPolicy({ workspace: tempDir });
			const handler = createHandler({ sandbox });

			const result = await handler({
				tool: "file",
				input: { operation: "read", path: join(outsideDir, "secret.txt") },
			});
			expect(result.success).toBe(false);
			expect(result.error).toContain("not allowed by sandbox policy");
		} finally {
			safeRemove(outsideDir);
		}
	});

	it("denies destructive delete without permission", async () => {
		const permissionManager = new PermissionManager({ defaultDecision: "deny" });
		const handler = createHandler({ permissionManager });

		const result = await handler({
			tool: "file",
			input: { operation: "delete", path: "foo.txt" },
		});
		expect(result.success).toBe(false);
		expect(result.error).toContain("Permission denied");
	});

	it("executes shell commands when allowed", async () => {
		const handler = createHandler();

		const result = await handler({
			tool: "shell",
			input: { command: "echo bridge-ok" },
		});
		expect(result.success).toBe(true);
		expect(result.output).toContain("bridge-ok");
	});

	it("blocks dangerous shell commands via sandbox", async () => {
		const sandbox = new SandboxPolicy({ workspace: tempDir });
		const handler = createHandler({ sandbox });

		const result = await handler({
			tool: "shell",
			input: { command: "rm -rf /" },
		});
		expect(result.success).toBe(false);
		expect(result.error).toContain("blocked");
	});
});
