import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryManager } from "../memory/index.js";
import { historyCommand } from "./history.js";

describe("history command", () => {
	let testDir: string;
	let originalEnv: string | undefined;

	beforeEach(() => {
		testDir = mkdtempSync(join(tmpdir(), "infinity-history-"));
		originalEnv = process.env.INFINITY_MEMORY_PATH;
		process.env.INFINITY_MEMORY_PATH = testDir;
	});

	afterEach(() => {
		process.env.INFINITY_MEMORY_PATH = originalEnv;
		rmSync(testDir, { recursive: true, force: true });
	});

	it("lists sessions sorted by updatedAt desc", async () => {
		const manager = new MemoryManager();
		manager.createSession("first");
		const second = manager.createSession("second");

		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await historyCommand.parseAsync(["--list"], { from: "user" });

		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining(second.id));
		consoleSpy.mockRestore();
	});

	it("shows messages for a session", async () => {
		const manager = new MemoryManager();
		const session = manager.createSession("demo");
		manager.addMessage(session.id, "user", "hello");
		manager.addMessage(session.id, "assistant", "hi there");

		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await historyCommand.parseAsync(["--show", session.id], { from: "user" });

		expect(consoleSpy).toHaveBeenCalledWith("[user] hello");
		expect(consoleSpy).toHaveBeenCalledWith("[assistant] hi there");
		consoleSpy.mockRestore();
	});

	it("shows default session when --show is used without value and --session set", async () => {
		const manager = new MemoryManager();
		const session = manager.createSession("default");
		manager.addMessage(session.id, "user", "default prompt");

		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await historyCommand.parseAsync(["--session", session.id, "--show"], { from: "user" });

		expect(consoleSpy).toHaveBeenCalledWith("[user] default prompt");
		consoleSpy.mockRestore();
	});

	it("errors when session not found", async () => {
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

		await historyCommand.parseAsync(["--show", "missing-id"], { from: "user" });

		expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Session not found"));
		expect(exitSpy).toHaveBeenCalledWith(1);
		consoleErrorSpy.mockRestore();
		exitSpy.mockRestore();
	});

	it("clears memory", async () => {
		const manager = new MemoryManager();
		const session = manager.createSession("to-clear");

		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		await historyCommand.parseAsync(["--session", session.id, "--clear"], { from: "user" });

		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Cleared memory"));
		expect(new MemoryManager().listSessions()).toHaveLength(0);
		consoleSpy.mockRestore();
	});
});
