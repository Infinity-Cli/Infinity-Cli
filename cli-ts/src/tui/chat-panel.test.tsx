import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { render } from "ink";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askOnce } from "../ask-engine.js";
import { MemoryManager } from "../memory/manager.js";
import { ChatPanel, extractDiffBlocks } from "./chat-panel.js";
import App from "./shell.js";
import {
	createFakeStdin,
	createFakeStdout,
	delay,
	stripAnsi,
	waitForFrame,
	waitForOutput,
} from "./test-helpers.js";

vi.mock("../ask-engine.js", () => ({ askOnce: vi.fn() }));

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

		const screen = stripAnsi(
			await waitForOutput(stdout, (s) => stripAnsi(s).includes("Hi there")),
		);

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
		expect(stripAnsi(stdout.output.join(""))).toContain("Infinity TUI");

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

		await waitForOutput(stdout, () => mockOnAsk.mock.calls.length === 2);

		// Press Up to recall "second", then Up again to recall "first"
		stdin.write("\x1b[A");
		let screen = stripAnsi(await waitForFrame(stdout, (s) => s.includes("> second")));
		stdin.write("\x1b[A");
		screen = stripAnsi(await waitForFrame(stdout, (s) => s.includes("> first")));
		stdin.write("\x1b[B");
		screen = stripAnsi(await waitForFrame(stdout, (s) => s.includes("> second")));

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

			const screen = stripAnsi(
				await waitForOutput(stdout, (s) => stripAnsi(s).includes("Hello from assistant")),
			);

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

			const screen = stripAnsi(
				await waitForOutput(stdout, (s) => stripAnsi(s).includes("new line")),
			);

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

			const screen = stripAnsi(
				await waitForOutput(stdout, (s) => stripAnsi(s).includes("API key missing")),
			);

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

			const screen = stripAnsi(
				await waitForOutput(
					stdout,
					(s) =>
						stripAnsi(s).includes("previous user message") &&
						stripAnsi(s).includes("previous assistant message"),
				),
			);

			instance.unmount();

			expect(screen).toContain("> previous user message");
			expect(screen).toContain("< previous assistant message");
		});
	});
});
