import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AskEngineError } from "../ask-engine.js";
import { type ChatRuntime, HELP_TEXT, chatCommand, runChat } from "./chat.js";

interface MockReadlineHandle extends ChatRuntime {
	question: ReturnType<typeof vi.fn>;
	close: ReturnType<typeof vi.fn>;
	writeLine: ReturnType<typeof vi.fn>;
	writeError: ReturnType<typeof vi.fn>;
}

function createMockReadline(lines: string[], isTTY = true): MockReadlineHandle {
	const queue = [...lines];
	return {
		isTTY,
		question: vi.fn(async (prompt: string) => {
			prompts.push(prompt);
			const next = queue.shift();
			if (next === undefined) {
				throw new Error("readline closed");
			}
			return next;
		}),
		close: vi.fn(() => {
			closed = true;
		}),
		writeLine: vi.fn((line: string) => {
			written.push(line);
		}),
		writeError: vi.fn((line: string) => {
			errored.push(line);
		}),
	};
}

let mockAskOnce: ReturnType<typeof vi.fn>;
let written: string[];
let errored: string[];
let prompts: string[];
let closed: boolean;

describe("chat REPL (runChat)", () => {
	beforeEach(() => {
		mockAskOnce = vi.fn();
		written = [];
		errored = [];
		prompts = [];
		closed = false;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("handles multiple turns, prints responses, and closes the interface", async () => {
		mockAskOnce
			.mockResolvedValueOnce({ response: "hi there", providerId: "openai", model: "gpt-4o" })
			.mockResolvedValueOnce({
				response: "I can help with that",
				providerId: "openai",
				model: "gpt-4o",
			});

		const rl = createMockReadline(["hello", "what can you do?", "exit"]);

		await runChat({ session: "test" }, { askOnce: mockAskOnce, createReadline: () => rl });

		expect(mockAskOnce).toHaveBeenCalledTimes(2);
		expect(mockAskOnce).toHaveBeenNthCalledWith(1, "hello", { session: "test" });
		expect(mockAskOnce).toHaveBeenNthCalledWith(2, "what can you do?", { session: "test" });
		expect(written.some((line) => line.includes("hi there"))).toBe(true);
		expect(written.some((line) => line.includes("I can help with that"))).toBe(true);
		expect(rl.close).toHaveBeenCalledTimes(1);
	});

	it.each([{ command: "exit" }, { command: "quit" }, { command: ":q" }])(
		"ends the loop on '$command' without calling askOnce",
		async ({ command }) => {
			const rl = createMockReadline([command]);

			await runChat({ session: "test" }, { askOnce: mockAskOnce, createReadline: () => rl });

			expect(mockAskOnce).not.toHaveBeenCalled();
			expect(rl.close).toHaveBeenCalledTimes(1);
		},
	);

	it("ends the loop when readline closes (Ctrl+D)", async () => {
		mockAskOnce.mockResolvedValueOnce({
			response: "response",
			providerId: "openai",
			model: "gpt-4o",
		});
		// Queue a single input, then undefined triggers the "closed" throw.
		const rl = createMockReadline(["hello", "should-not-be-reached"]);
		// Simulate the interface closing after first prompt.
		rl.question.mockImplementationOnce(async () => "hello");
		rl.question.mockImplementationOnce(async () => {
			throw new Error("readline closed");
		});

		await runChat({ session: "test" }, { askOnce: mockAskOnce, createReadline: () => rl });

		expect(mockAskOnce).toHaveBeenCalledTimes(1);
		expect(rl.close).toHaveBeenCalledTimes(1);
	});

	it.each([
		{ command: "help", expected: HELP_TEXT },
		{ command: ":h", expected: HELP_TEXT },
	])("prints help on '$command' and does not call askOnce", async ({ command, expected }) => {
		const rl = createMockReadline([command, "exit"]);

		await runChat({ session: "test" }, { askOnce: mockAskOnce, createReadline: () => rl });

		expect(mockAskOnce).not.toHaveBeenCalled();
		expect(written).toContain(expected);
	});

	it("treats empty input as a no-op and re-prompts", async () => {
		mockAskOnce.mockResolvedValueOnce({
			response: "ok",
			providerId: "openai",
			model: "gpt-4o",
		});
		const rl = createMockReadline(["", "   ", "hello", "exit"]);

		await runChat({ session: "test" }, { askOnce: mockAskOnce, createReadline: () => rl });

		expect(mockAskOnce).toHaveBeenCalledTimes(1);
		expect(mockAskOnce).toHaveBeenCalledWith("hello", { session: "test" });
		expect(rl.question).toHaveBeenCalledTimes(4);
	});

	it("continues the loop when askOnce throws and prints the error", async () => {
		mockAskOnce.mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce({
			response: "second works",
			providerId: "openai",
			model: "gpt-4o",
		});
		const rl = createMockReadline(["first", "second", "exit"]);

		await runChat({ session: "test" }, { askOnce: mockAskOnce, createReadline: () => rl });

		expect(mockAskOnce).toHaveBeenCalledTimes(2);
		expect(errored.some((line) => line.includes("network down"))).toBe(true);
		expect(written.some((line) => line.includes("second works"))).toBe(true);
	});

	it("prints an API-key hint when AskEngineError code is API_KEY_MISSING", async () => {
		mockAskOnce.mockRejectedValueOnce(
			new AskEngineError("API key not set for provider 'openai'", "API_KEY_MISSING", "openai"),
		);
		mockAskOnce.mockResolvedValueOnce({
			response: "fixed",
			providerId: "openai",
			model: "gpt-4o",
		});
		const rl = createMockReadline(["hi", "again", "exit"]);

		await runChat({ session: "test" }, { askOnce: mockAskOnce, createReadline: () => rl });

		expect(errored.some((line) => line.includes("API key not set"))).toBe(true);
		expect(errored.some((line) => line.includes("infinity config set apiKey.openai"))).toBe(true);
		expect(mockAskOnce).toHaveBeenCalledTimes(2);
	});

	it("handles non-Error throws gracefully", async () => {
		mockAskOnce.mockRejectedValueOnce("string error");
		mockAskOnce.mockResolvedValueOnce({
			response: "after",
			providerId: "openai",
			model: "gpt-4o",
		});
		const rl = createMockReadline(["hi", "next", "exit"]);

		await runChat({ session: "test" }, { askOnce: mockAskOnce, createReadline: () => rl });

		expect(errored.some((line) => line.includes("unknown error"))).toBe(true);
		expect(mockAskOnce).toHaveBeenCalledTimes(2);
	});

	it("passes provider, model, and session overrides to askOnce", async () => {
		mockAskOnce.mockResolvedValueOnce({
			response: "ok",
			providerId: "anthropic",
			model: "claude-3",
		});
		const rl = createMockReadline(["hello", "exit"]);

		await runChat(
			{ provider: "anthropic", model: "claude-3", session: "session-xyz" },
			{ askOnce: mockAskOnce, createReadline: () => rl },
		);

		expect(mockAskOnce).toHaveBeenCalledWith("hello", {
			provider: "anthropic",
			model: "claude-3",
			session: "session-xyz",
		});
	});

	it("errors and exits with code 1 when not running in a TTY", async () => {
		const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
			throw new Error("__exit__");
		}) as never);

		const rl = createMockReadline([], false);

		await expect(
			runChat({ session: "test" }, { askOnce: mockAskOnce, createReadline: () => rl }),
		).rejects.toThrow("__exit__");

		expect(exitSpy).toHaveBeenCalledWith(1);
		expect(errored.some((line) => line.includes("TTY"))).toBe(true);
		expect(rl.close).toHaveBeenCalledTimes(1);
		expect(mockAskOnce).not.toHaveBeenCalled();
	});

	it("always closes the readline interface, even when askOnce throws repeatedly", async () => {
		mockAskOnce.mockRejectedValue(new Error("always fails"));
		const rl = createMockReadline(["hi", "again", "exit"]);

		await runChat({ session: "test" }, { askOnce: mockAskOnce, createReadline: () => rl });

		expect(rl.close).toHaveBeenCalledTimes(1);
		expect(mockAskOnce).toHaveBeenCalledTimes(2);
	});
});

describe("chatCommand", () => {
	it('exports a chat command named "chat"', () => {
		expect(chatCommand.name()).toBe("chat");
	});

	it("registers the --provider option", () => {
		const provider = chatCommand.options.find((o) => o.long === "--provider");
		expect(provider).toBeDefined();
	});

	it("registers the --model option", () => {
		const model = chatCommand.options.find((o) => o.long === "--model");
		expect(model).toBeDefined();
	});

	it("registers the --session option with default 'default'", () => {
		const session = chatCommand.options.find((o) => o.long === "--session");
		expect(session).toBeDefined();
		expect(session?.defaultValue).toBe("default");
	});
});
