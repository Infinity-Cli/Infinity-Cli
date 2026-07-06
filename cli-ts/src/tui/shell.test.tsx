import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { askOnce } from "../ask-engine.js";
import { renderTUI } from "./render.js";
import App from "./shell.js";
import { renderTui } from "./test-helpers.js";

vi.mock("../ask-engine.js", () => ({ askOnce: vi.fn() }));

const ESC = String.fromCharCode(0x1b);
const ANSI_SEQUENCE = new RegExp(`${ESC}\\[[0-9;?]*[a-zA-Z]`, "g");

function stripAnsi(input: string): string {
	return input.replace(ANSI_SEQUENCE, "");
}

function createFakeStdin(): NodeJS.ReadStream & {
	isTTY: boolean;
	isRawModeSupported: boolean;
	setRawMode: (mode: boolean) => unknown;
	ref: () => void;
	unref: () => void;
} {
	const stdin = Object.assign(new PassThrough(), {
		isTTY: true,
		isRawModeSupported: true,
		setRawMode: () => stdin,
		pause: () => stdin,
		resume: () => stdin,
		ref: () => {},
		unref: () => {},
	}) as unknown as NodeJS.ReadStream & {
		isTTY: boolean;
		isRawModeSupported: boolean;
		setRawMode: (mode: boolean) => unknown;
		ref: () => void;
		unref: () => void;
	};
	return stdin;
}

function createFakeStdout(): NodeJS.WriteStream & {
	columns: number;
	rows: number;
	isTTY: boolean;
	output: string[];
} {
	const output: string[] = [];
	const stdout = Object.assign(new PassThrough(), {
		columns: 120,
		rows: 40,
		isTTY: true,
		output,
	}) as unknown as NodeJS.WriteStream & {
		columns: number;
		rows: number;
		isTTY: boolean;
		output: string[];
	};
	(stdout as unknown as { write: NodeJS.WriteStream["write"] }).write = ((
		chunk: string | Uint8Array,
		encodingOrCb?: BufferEncoding | ((err?: Error | null) => void),
		cb?: (err?: Error | null) => void,
	) => {
		output.push(chunk.toString());
		const callback = typeof encodingOrCb === "function" ? encodingOrCb : cb;
		if (typeof callback === "function") {
			callback();
		}
		return true;
	}) as NodeJS.WriteStream["write"];
	return stdout;
}

async function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForOutput(
	stdout: ReturnType<typeof createFakeStdout>,
	predicate: (screen: string) => boolean,
	timeoutMs = 2000,
): Promise<string> {
	const start = Date.now();
	let screen = stdout.output.join("");
	while (!predicate(screen) && Date.now() - start < timeoutMs) {
		await delay(20);
		screen = stdout.output.join("");
	}
	return screen;
}

describe("TUI shell", () => {
	it("renders the multi-panel layout", async () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shell-layout-test-"));
		const previousMemoryPath = process.env.INFINITY_MEMORY_PATH;
		process.env.INFINITY_MEMORY_PATH = tmpDir;

		const stdout = createFakeStdout();
		const stdin = createFakeStdin();

		const instance = renderTui(<App />, { stdout, stdin });
		await delay(50);
		instance.unmount();

		if (previousMemoryPath === undefined) {
			process.env.INFINITY_MEMORY_PATH = undefined;
		} else {
			process.env.INFINITY_MEMORY_PATH = previousMemoryPath;
		}
		fs.rmSync(tmpDir, { recursive: true, force: true });

		const screen = stdout.output.join("");
		expect(screen).toContain("Infinity TUI");
		expect(screen).toContain("Chat");
		expect(screen).toContain("Files");
		expect(screen).toContain("Diff");
		expect(screen).toContain("Session");
		expect(screen).toContain("Ctrl+C to quit");
	});

	describe("file selection", () => {
		let tmpDir: string | undefined;

		afterEach(() => {
			if (tmpDir) {
				fs.rmSync(tmpDir, { recursive: true, force: true });
				tmpDir = undefined;
			}
		});

		it("shows selected file content in the diff panel", async () => {
			tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shell-file-select-test-"));
			fs.writeFileSync(path.join(tmpDir, "hello.txt"), "hello world");

			const previousMemoryPath = process.env.INFINITY_MEMORY_PATH;
			process.env.INFINITY_MEMORY_PATH = tmpDir;

			const stdout = createFakeStdout();
			const stdin = createFakeStdin();
			const instance = renderTui(<App cwd={tmpDir} />, { stdout, stdin });

			let screen = stripAnsi(
				await waitForOutput(stdout, (s) => stripAnsi(s).includes("> 📄 hello.txt"), 5000),
			);
			expect(screen).toContain("> 📄 hello.txt");

			stdin.write("\r");
			screen = stripAnsi(
				await waitForOutput(stdout, (s) => stripAnsi(s).includes("hello world"), 5000),
			);

			instance.unmount();

			if (previousMemoryPath === undefined) {
				process.env.INFINITY_MEMORY_PATH = undefined;
			} else {
				process.env.INFINITY_MEMORY_PATH = previousMemoryPath;
			}

			expect(screen).toContain("hello world");
			expect(screen).toContain("File:");
		});
	});

	it("exits with an error when not running in a TTY", async () => {
		const originalStdinIsTTY = process.stdin.isTTY;
		const originalStdoutIsTTY = process.stdout.isTTY;
		(process.stdin as NodeJS.ReadStream & { isTTY?: boolean }).isTTY = false;
		(process.stdout as NodeJS.WriteStream & { isTTY?: boolean }).isTTY = false;

		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await expect(renderTUI()).resolves.toBeUndefined();

		expect(errorSpy).toHaveBeenCalledTimes(1);
		expect(errorSpy.mock.calls[0]?.[0]).toContain("interactive terminal");

		errorSpy.mockRestore();
		(process.stdin as NodeJS.ReadStream & { isTTY?: boolean }).isTTY = originalStdinIsTTY;
		(process.stdout as NodeJS.WriteStream & { isTTY?: boolean }).isTTY = originalStdoutIsTTY;
	});
});
