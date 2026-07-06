import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { render } from "ink";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askOnce } from "../ask-engine.js";
import { MemoryManager } from "../memory/manager.js";
import { ChatPanel, extractDiffBlocks } from "./chat-panel.js";
import App from "./shell.js";

vi.mock("../ask-engine.js", () => ({ askOnce: vi.fn() }));

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

describe("TUI chat panel", () => {
	it("sends on Enter", async () => {
		const mockOnAsk = vi.fn().mockResolvedValue("Hi there");
		const stdout = createFakeStdout();
		const stdin = createFakeStdin();
		const instance = render(<ChatPanel onAsk={mockOnAsk} />, { stdout, stdin });

		await delay(30);
		for (const char of "hello") {
			stdin.write(char);
			await delay(5);
		}
		stdin.write("\r");

		let screen = stdout.output.join("");
		let attempts = 0;
		while (!screen.includes("Hi there") && attempts < 30) {
			await delay(50);
			screen = stdout.output.join("");
			attempts++;
		}

		instance.unmount();

		expect(mockOnAsk).toHaveBeenCalledWith("hello");
		expect(screen).toContain("> hello");
		expect(screen).toContain("< Hi there");
	});

	it("exits on ctrl+c", async () => {
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-panel-exit-test-"));
		const previousMemoryPath = process.env.INFINITY_MEMORY_PATH;
		process.env.INFINITY_MEMORY_PATH = tmpDir;

		const stdout = createFakeStdout();
		const stdin = createFakeStdin();

		const instance = render(<App />, { stdout, stdin, exitOnCtrlC: false });
		const exitPromise = instance.waitUntilExit();
		await delay(30);

		stdin.write("\x03");

		await expect(exitPromise).resolves.toBeUndefined();
		expect(stdout.output.join("")).toContain("Infinity TUI");

		if (previousMemoryPath === undefined) {
			process.env.INFINITY_MEMORY_PATH = undefined;
		} else {
			process.env.INFINITY_MEMORY_PATH = previousMemoryPath;
		}
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("scrolls through history with up and down arrows", async () => {
		const mockOnAsk = vi.fn().mockResolvedValue("Ok");
		const stdout = createFakeStdout();
		const stdin = createFakeStdin();
		const instance = render(<ChatPanel onAsk={mockOnAsk} />, { stdout, stdin });

		await delay(30);
		for (const char of "first") {
			stdin.write(char);
			await delay(5);
		}
		stdin.write("\r");
		await delay(30);

		for (const char of "second") {
			stdin.write(char);
			await delay(5);
		}
		stdin.write("\r");

		let screen = stdout.output.join("");
		let attempts = 0;
		while (!screen.includes("< Ok") && attempts < 30) {
			await delay(50);
			screen = stdout.output.join("");
			attempts++;
		}

		// Press Up to recall "second", then Up again to recall "first"
		stdin.write("\x1b[A");
		await delay(20);
		stdin.write("\x1b[A");
		await delay(20);
		stdin.write("\x1b[B");
		await delay(20);

		screen = stdout.output.join("");
		instance.unmount();

		expect(mockOnAsk).toHaveBeenCalledTimes(2);
		expect(screen).toContain("> first");
		expect(screen).toContain("> second");
	});

	describe("with askOnce mocked", () => {
		beforeEach(() => {
			vi.mocked(askOnce).mockReset();
		});

		it("renders assistant response from askOnce", async () => {
			vi.mocked(askOnce).mockResolvedValue({
				response: "Hello from assistant",
				providerId: "openai",
				model: "gpt-4o",
			});

			const stdout = createFakeStdout();
			const stdin = createFakeStdin();
			const instance = render(<ChatPanel />, { stdout, stdin });

			await delay(30);
			for (const char of "hi") {
				stdin.write(char);
				await delay(5);
			}
			stdin.write("\r");

			let screen = stdout.output.join("");
			let attempts = 0;
			while (!screen.includes("Hello from assistant") && attempts < 30) {
				await delay(50);
				screen = stdout.output.join("");
				attempts++;
			}

			instance.unmount();

			expect(askOnce).toHaveBeenCalledWith("hi", {});
			expect(screen).toContain("> hi");
			expect(screen).toContain("< Hello from assistant");
		});

		it("extracts diff blocks from assistant responses", async () => {
			const diffResponse = "Here is the diff:\n```diff\n- old line\n+ new line\n```";
			vi.mocked(askOnce).mockResolvedValue({
				response: diffResponse,
				providerId: "openai",
				model: "gpt-4o",
			});

			const onShowDiff = vi.fn();
			const stdout = createFakeStdout();
			const stdin = createFakeStdin();
			const instance = render(<ChatPanel onShowDiff={onShowDiff} />, { stdout, stdin });

			await delay(30);
			for (const char of "generate diff") {
				stdin.write(char);
				await delay(5);
			}
			stdin.write("\r");

			let screen = stdout.output.join("");
			let attempts = 0;
			while (!screen.includes("new line") && attempts < 30) {
				await delay(50);
				screen = stdout.output.join("");
				attempts++;
			}

			instance.unmount();

			expect(onShowDiff).toHaveBeenCalledWith("- old line\n+ new line");
		});

		it("extractDiffBlocks returns all fenced diff blocks", () => {
			const text = "intro\n```diff\n-a\n+b\n```\noutro\n```diff\n-c\n+d\n```";
			expect(extractDiffBlocks(text)).toEqual(["-a\n+b", "-c\n+d"]);
		});

		it("extractDiffBlocks returns empty array when no diff blocks", () => {
			expect(extractDiffBlocks("no diff here")).toEqual([]);
		});

		it("displays askOnce errors inline", async () => {
			vi.mocked(askOnce).mockRejectedValue(new Error("API key missing"));

			const stdout = createFakeStdout();
			const stdin = createFakeStdin();
			const instance = render(<ChatPanel />, { stdout, stdin });

			await delay(30);
			for (const char of "fail") {
				stdin.write(char);
				await delay(5);
			}
			stdin.write("\r");

			let screen = stdout.output.join("");
			let attempts = 0;
			while (!screen.includes("API key missing") && attempts < 30) {
				await delay(50);
				screen = stdout.output.join("");
				attempts++;
			}

			instance.unmount();

			expect(askOnce).toHaveBeenCalledWith("fail", {});
			expect(screen).toContain("> fail");
			expect(screen).toContain("API key missing");
		});
	});

	describe("with a shared MemoryManager", () => {
		let tmpDir: string;

		afterEach(() => {
			if (tmpDir) {
				fs.rmSync(tmpDir, { recursive: true, force: true });
			}
		});

		it("loads existing messages for the provided sessionId", async () => {
			tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-panel-session-test-"));
			const memoryManager = new MemoryManager({ baseDir: tmpDir });
			const session = memoryManager.createSession("Test Session");
			memoryManager.addMessage(session.id, "user", "previous user message");
			memoryManager.addMessage(session.id, "assistant", "previous assistant message");

			const stdout = createFakeStdout();
			const stdin = createFakeStdin();
			const instance = render(<ChatPanel sessionId={session.id} memoryManager={memoryManager} />, {
				stdout,
				stdin,
			});

			let screen = stdout.output.join("");
			let attempts = 0;
			while (
				!(
					screen.includes("previous user message") && screen.includes("previous assistant message")
				) &&
				attempts < 30
			) {
				await delay(50);
				screen = stdout.output.join("");
				attempts++;
			}

			instance.unmount();

			expect(screen).toContain("> previous user message");
			expect(screen).toContain("< previous assistant message");
		});
	});
});
