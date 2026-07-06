import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryManager, type Session } from "../memory/manager.js";
import { SessionSidebar } from "./session-sidebar.js";
import {
	createFakeStdin,
	createFakeStdout,
	renderTui,
	stripAnsi,
	waitForOutput,
} from "./test-helpers.js";

describe("SessionSidebar", () => {
	let tmpDir: string;

	afterEach(() => {
		if (tmpDir) {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("lists sessions with mocked MemoryManager", async () => {
		const firstSession: Session = {
			id: "session-1",
			title: "Mocked First",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
		};
		const secondSession: Session = {
			id: "session-2",
			title: "Mocked Second",
			createdAt: "2026-01-02T00:00:00.000Z",
			updatedAt: "2026-01-02T00:00:00.000Z",
		};
		const memoryManager = {
			listSessions: vi.fn().mockReturnValue([firstSession, secondSession]),
			getMessages: vi.fn().mockReturnValue([]),
		} as unknown as MemoryManager;

		const stdout = createFakeStdout();
		const stdin = createFakeStdin();
		const instance = renderTui(
			<SessionSidebar
				sessionId={secondSession.id}
				memoryManager={memoryManager}
				onSelectSession={() => {}}
			/>,
			{ stdout, stdin },
		);

		const screen = stripAnsi(
			await waitForOutput(
				stdout,
				(s) => stripAnsi(s).includes("Mocked Second") && stripAnsi(s).includes("Mocked First"),
			),
		);

		instance.unmount();

		const secondIndex = screen.indexOf("Mocked Second");
		const firstIndex = screen.indexOf("Mocked First");
		expect(secondIndex).toBeGreaterThan(-1);
		expect(firstIndex).toBeGreaterThan(-1);
		expect(secondIndex).toBeLessThan(firstIndex);
		expect(screen).toContain("> Mocked Second (0)");
		expect(screen).toContain("Mocked First (0)");
		expect(memoryManager.listSessions).toHaveBeenCalledTimes(1);
	});

	it("lists sessions", async () => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "session-sidebar-test-"));
		const memoryManager = new MemoryManager({ baseDir: tmpDir });
		const firstSession = memoryManager.createSession("First Session");
		await new Promise((resolve) => setTimeout(resolve, 10));
		const secondSession = memoryManager.createSession("Second Session");

		const stdout = createFakeStdout();
		const stdin = createFakeStdin();
		const instance = renderTui(
			<SessionSidebar
				sessionId={secondSession.id}
				memoryManager={memoryManager}
				onSelectSession={() => {}}
			/>,
			{ stdout, stdin },
		);

		const screen = stripAnsi(
			await waitForOutput(
				stdout,
				(s) => stripAnsi(s).includes("Second Session") && stripAnsi(s).includes("First Session"),
			),
		);

		instance.unmount();

		const secondIndex = screen.indexOf("Second Session");
		const firstIndex = screen.indexOf("First Session");
		expect(secondIndex).toBeGreaterThan(-1);
		expect(firstIndex).toBeGreaterThan(-1);
		expect(secondIndex).toBeLessThan(firstIndex);
		expect(screen).toContain("> Second Session (0)");
		expect(screen).toContain("First Session (0)");
	});

	it("selects session with enter", async () => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "session-sidebar-select-test-"));
		const memoryManager = new MemoryManager({ baseDir: tmpDir });
		const firstSession = memoryManager.createSession("Alpha");
		await new Promise((resolve) => setTimeout(resolve, 10));
		const secondSession = memoryManager.createSession("Beta");
		const onSelectSession = vi.fn();

		const stdout = createFakeStdout();
		const stdin = createFakeStdin();
		const instance = renderTui(
			<SessionSidebar
				sessionId={secondSession.id}
				memoryManager={memoryManager}
				onSelectSession={onSelectSession}
			/>,
			{ stdout, stdin },
		);

		let screen = stripAnsi(await waitForOutput(stdout, (s) => stripAnsi(s).includes("Beta")));
		expect(screen).toContain("> Beta (0)");

		stdout.output.length = 0;
		stdin.write("\x1b[B");
		screen = stripAnsi(await waitForOutput(stdout, (s) => stripAnsi(s).includes("> Alpha")));
		expect(screen).toContain("> Alpha (0)");

		stdout.output.length = 0;
		stdin.write("\r");
		await waitForOutput(stdout, () => onSelectSession.mock.calls.length > 0, 500);

		instance.unmount();

		expect(onSelectSession).toHaveBeenCalledTimes(1);
		expect(onSelectSession).toHaveBeenCalledWith(firstSession.id);
	});

	it("creates a new session on ctrl+n", async () => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "session-sidebar-create-test-"));
		const memoryManager = new MemoryManager({ baseDir: tmpDir });
		memoryManager.createSession("Existing");
		const onCreateSession = vi.fn();

		const stdout = createFakeStdout();
		const stdin = createFakeStdin();
		const instance = renderTui(
			<SessionSidebar
				sessionId={undefined}
				memoryManager={memoryManager}
				onCreateSession={onCreateSession}
			/>,
			{ stdout, stdin },
		);

		await waitForOutput(stdout, (s) => stripAnsi(s).includes("Existing"));
		stdin.write("\x0e");
		await waitForOutput(stdout, () => onCreateSession.mock.calls.length > 0, 500);

		instance.unmount();

		expect(onCreateSession).toHaveBeenCalledTimes(1);
	});
});
