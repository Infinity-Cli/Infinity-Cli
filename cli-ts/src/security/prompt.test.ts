import { Readable, Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { createConsolePrompt } from "./prompt.js";
import type { PermissionRequest } from "./types.js";

describe("createConsolePrompt", () => {
	const createMockStreams = (inputData: string) => {
		const input = new Readable({
			read() {
				this.push(inputData);
				this.push(null);
			},
		});
		const outputChunks: Buffer[] = [];
		const output = new Writable({
			write(
				chunk: Buffer | string,
				_encoding: BufferEncoding,
				callback: (error?: Error | null) => void,
			) {
				outputChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
				callback();
			},
		});
		const mockWrite = vi.fn((chunk: string | Buffer) => {
			outputChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
			return true;
		});
		output.write = mockWrite;
		return { input, output, getOutput: () => Buffer.concat(outputChunks).toString() };
	};

	it("should return true for input starting with y", async () => {
		const { input, output, getOutput } = createMockStreams("yes\n");
		const promptFn = createConsolePrompt({ input, output });

		const request: PermissionRequest = {
			tool: "file",
			operation: "delete",
			description: "Delete a file",
			path: "/tmp/test.txt",
			destructive: true,
		};

		const result = await promptFn(request);
		expect(result).toBe(true);
		expect(output.write).toHaveBeenCalled();
		expect(getOutput()).toContain("file");
	});

	it("should return true for input starting with Y", async () => {
		const { input, output } = createMockStreams("Y\n");
		const promptFn = createConsolePrompt({ input, output });

		const request: PermissionRequest = {
			tool: "file",
			operation: "delete",
			description: "Delete a file",
			path: "/tmp/test.txt",
			destructive: true,
		};

		const result = await promptFn(request);
		expect(result).toBe(true);
	});

	it("should return false for input starting with n", async () => {
		const { input, output } = createMockStreams("no\n");
		const promptFn = createConsolePrompt({ input, output });

		const request: PermissionRequest = {
			tool: "file",
			operation: "delete",
			description: "Delete a file",
			path: "/tmp/test.txt",
			destructive: true,
		};

		const result = await promptFn(request);
		expect(result).toBe(false);
	});

	it("should return false for input starting with N", async () => {
		const { input, output } = createMockStreams("N\n");
		const promptFn = createConsolePrompt({ input, output });

		const request: PermissionRequest = {
			tool: "file",
			operation: "delete",
			description: "Delete a file",
			path: "/tmp/test.txt",
			destructive: true,
		};

		const result = await promptFn(request);
		expect(result).toBe(false);
	});

	it("should return false for empty input", async () => {
		const { input, output } = createMockStreams("\n");
		const promptFn = createConsolePrompt({ input, output });

		const request: PermissionRequest = {
			tool: "file",
			operation: "delete",
			description: "Delete a file",
			path: "/tmp/test.txt",
			destructive: true,
		};

		const result = await promptFn(request);
		expect(result).toBe(false);
	});

	it("should return false for random input", async () => {
		const { input, output } = createMockStreams("maybe\n");
		const promptFn = createConsolePrompt({ input, output });

		const request: PermissionRequest = {
			tool: "file",
			operation: "delete",
			description: "Delete a file",
			path: "/tmp/test.txt",
			destructive: true,
		};

		const result = await promptFn(request);
		expect(result).toBe(false);
	});

	it("should include tool, operation, path, and description in prompt", async () => {
		const { input, output, getOutput } = createMockStreams("yes\n");
		const promptFn = createConsolePrompt({ input, output });

		const request: PermissionRequest = {
			tool: "shell",
			operation: "exec",
			description: "Run dangerous command",
			path: "/usr/bin/rm",
			destructive: true,
		};

		await promptFn(request);

		const outputStr = getOutput();
		expect(outputStr).toContain("shell");
		expect(outputStr).toContain("exec");
		expect(outputStr).toContain("Run dangerous command");
		expect(outputStr).toContain("/usr/bin/rm");
		expect(outputStr).toContain("DESTRUCTIVE");
	});
});
