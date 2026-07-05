import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SandboxPolicy } from "../security/sandbox.js";
import { fileTool } from "./file.js";
import type { ToolContext } from "./types.js";

describe("fileTool", () => {
	let tempDir: string;
	let context: ToolContext;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "file-tool-test-"));
		context = { workspace: tempDir, cwd: tempDir };
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("should write and read a file", async () => {
		const writeResult = await fileTool.execute(
			{ operation: "write", path: "test.txt", content: "Hello, World!" },
			context,
		);
		expect(writeResult.success).toBe(true);

		const readResult = await fileTool.execute({ operation: "read", path: "test.txt" }, context);
		expect(readResult.success).toBe(true);
		expect(readResult.output).toBe("Hello, World!");
	});

	it("should list directory contents", async () => {
		writeFileSync(join(tempDir, "file1.txt"), "content1");
		writeFileSync(join(tempDir, "file2.txt"), "content2");

		const listResult = await fileTool.execute({ operation: "list", path: "." }, context);
		expect(listResult.success).toBe(true);
		expect(listResult.data).toBeInstanceOf(Array);
		expect(listResult.data).toContain("file1.txt");
		expect(listResult.data).toContain("file2.txt");
	});

	it("should delete a file when allowDestructive is true", async () => {
		writeFileSync(join(tempDir, "to-delete.txt"), "delete me");

		const contextWithDestructive: ToolContext = { ...context, allowDestructive: true };
		const deleteResult = await fileTool.execute(
			{ operation: "delete", path: "to-delete.txt" },
			contextWithDestructive,
		);
		expect(deleteResult.success).toBe(true);
	});

	it("should reject delete when allowDestructive is false", async () => {
		writeFileSync(join(tempDir, "to-delete.txt"), "delete me");

		const deleteResult = await fileTool.execute(
			{ operation: "delete", path: "to-delete.txt" },
			context,
		);
		expect(deleteResult.success).toBe(false);
		expect(deleteResult.error).toContain("Destructive operations require permission");
	});

	it("should reject path traversal outside workspace", async () => {
		const result = await fileTool.execute({ operation: "read", path: "../../etc/passwd" }, context);
		expect(result.success).toBe(false);
		expect(result.error).toContain("Path traversal");
	});

	it("should create parent directories for write", async () => {
		const writeResult = await fileTool.execute(
			{ operation: "write", path: "nested/deep/file.txt", content: "deep content" },
			context,
		);
		expect(writeResult.success).toBe(true);

		const readResult = await fileTool.execute(
			{ operation: "read", path: "nested/deep/file.txt" },
			context,
		);
		expect(readResult.success).toBe(true);
		expect(readResult.output).toBe("deep content");
	});

	it("should return error for write without content", async () => {
		const result = await fileTool.execute({ operation: "write", path: "test.txt" }, context);
		expect(result.success).toBe(false);
		expect(result.error).toContain("Content is required");
	});

	it("should deny path outside workspace when sandbox is provided", async () => {
		const outsideDir = mkdtempSync(join(tmpdir(), "outside-"));
		try {
			const sandbox = new SandboxPolicy({ workspace: tempDir });
			const contextWithSandbox: ToolContext = { ...context, sandbox };

			const result = await fileTool.execute(
				{ operation: "read", path: join(outsideDir, "file.txt") },
				contextWithSandbox,
			);
			expect(result.success).toBe(false);
			expect(result.error).toContain("not allowed by sandbox policy");
		} finally {
			rmSync(outsideDir, { recursive: true, force: true });
		}
	});

	it("should allow path within workspace when sandbox is provided", async () => {
		const sandbox = new SandboxPolicy({ workspace: tempDir });
		const contextWithSandbox: ToolContext = { ...context, sandbox };

		const writeResult = await fileTool.execute(
			{ operation: "write", path: "sandbox-test.txt", content: "sandbox content" },
			contextWithSandbox,
		);
		expect(writeResult.success).toBe(true);

		const readResult = await fileTool.execute(
			{ operation: "read", path: "sandbox-test.txt" },
			contextWithSandbox,
		);
		expect(readResult.success).toBe(true);
		expect(readResult.output).toBe("sandbox content");
	});

	it("should allow path in allowedPaths when sandbox is provided", async () => {
		const extraDir = mkdtempSync(join(tmpdir(), "extra-allowed-"));
		try {
			const sandbox = new SandboxPolicy({ workspace: tempDir, allowedPaths: [extraDir] });
			const contextWithSandbox: ToolContext = { ...context, sandbox };

			writeFileSync(join(extraDir, "allowed.txt"), "allowed content");

			const readResult = await fileTool.execute(
				{ operation: "read", path: join(extraDir, "allowed.txt") },
				contextWithSandbox,
			);
			expect(readResult.success).toBe(true);
			expect(readResult.output).toBe("allowed content");
		} finally {
			rmSync(extraDir, { recursive: true, force: true });
		}
	});
});
