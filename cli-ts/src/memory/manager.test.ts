import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryManager } from "./manager.js";

describe("MemoryManager", () => {
	let testDir: string;
	let manager: MemoryManager;

	beforeEach(() => {
		testDir = mkdtempSync(join(tmpdir(), "infinity-test-"));
		manager = new MemoryManager({ baseDir: testDir });
	});

	afterEach(() => {
		manager.close();
		rmSync(testDir, { recursive: true, force: true });
	});

	describe("sessions", () => {
		it("creates and lists sessions", () => {
			const s1 = manager.createSession("Session 1");
			const s2 = manager.createSession("Session 2");

			expect(s1.id).toBeDefined();
			expect(s1.title).toBe("Session 1");
			expect(s2.title).toBe("Session 2");

			const sessions = manager.listSessions();
			expect(sessions).toHaveLength(2);
			expect(sessions.map((s) => s.title)).toEqual(["Session 1", "Session 2"]);
		});

		it("gets session by id", () => {
			const created = manager.createSession("Test Session");
			const found = manager.getSession(created.id);
			expect(found).toBeDefined();
			expect(found?.title).toBe("Test Session");

			const notFound = manager.getSession("non-existent");
			expect(notFound).toBeUndefined();
		});
	});

	describe("messages", () => {
		it("adds and gets messages for a session", () => {
			const session = manager.createSession("Chat Session");

			manager.addMessage(session.id, "user", "Hello");
			manager.addMessage(session.id, "assistant", "Hi there!");
			manager.addMessage(session.id, "system", "System message");

			const messages = manager.getMessages(session.id);
			expect(messages).toHaveLength(3);
			expect(messages[0].role).toBe("user");
			expect(messages[0].content).toBe("Hello");
			expect(messages[1].role).toBe("assistant");
			expect(messages[2].role).toBe("system");
		});

		it("returns empty array for session with no messages", () => {
			const session = manager.createSession("Empty Session");
			const messages = manager.getMessages(session.id);
			expect(messages).toHaveLength(0);
		});

		it("does not return messages from other sessions", () => {
			const s1 = manager.createSession("Session 1");
			const s2 = manager.createSession("Session 2");

			manager.addMessage(s1.id, "user", "Message for session 1");
			manager.addMessage(s2.id, "user", "Message for session 2");

			const s1Messages = manager.getMessages(s1.id);
			const s2Messages = manager.getMessages(s2.id);

			expect(s1Messages).toHaveLength(1);
			expect(s1Messages[0].content).toBe("Message for session 1");
			expect(s2Messages).toHaveLength(1);
			expect(s2Messages[0].content).toBe("Message for session 2");
		});
	});

	describe("tasks", () => {
		it("creates and lists tasks", () => {
			const session = manager.createSession("Task Session");

			const t1 = manager.createTask(session.id, "Goal 1");
			const t2 = manager.createTask(session.id, "Goal 2");

			expect(t1.id).toBeDefined();
			expect(t1.goal).toBe("Goal 1");
			expect(t1.status).toBe("pending");
			expect(t2.goal).toBe("Goal 2");

			const tasks = manager.listTasks(session.id);
			expect(tasks).toHaveLength(2);
			expect(tasks.map((t) => t.goal)).toEqual(["Goal 1", "Goal 2"]);
		});

		it("gets task by id", () => {
			const session = manager.createSession("Session");
			const created = manager.createTask(session.id, "Test Goal");
			const found = manager.getTask(created.id);
			expect(found).toBeDefined();
			expect(found?.goal).toBe("Test Goal");
		});

		it("updates task status and goal", async () => {
			const session = manager.createSession("Session");
			const task = manager.createTask(session.id, "Original Goal");

			// Ensure the update timestamp differs from the creation timestamp
			await new Promise((resolve) => setTimeout(resolve, 10));

			const updated = manager.updateTask(task.id, { status: "running", goal: "Updated Goal" });
			expect(updated).toBeDefined();
			expect(updated?.status).toBe("running");
			expect(updated?.goal).toBe("Updated Goal");
			expect(updated?.updatedAt).not.toBe(task.updatedAt);

			const reloaded = manager.getTask(task.id);
			expect(reloaded?.status).toBe("running");
			expect(reloaded?.goal).toBe("Updated Goal");
		});

		it("returns undefined when updating non-existent task", () => {
			const result = manager.updateTask("non-existent", { status: "completed" });
			expect(result).toBeUndefined();
		});

		it("lists all tasks when no sessionId provided", () => {
			const s1 = manager.createSession("Session 1");
			const s2 = manager.createSession("Session 2");

			manager.createTask(s1.id, "Task 1");
			manager.createTask(s2.id, "Task 2");

			const allTasks = manager.listTasks();
			expect(allTasks).toHaveLength(2);
		});
	});

	describe("logs", () => {
		it("adds and gets logs for a session", () => {
			const session = manager.createSession("Log Session");

			manager.addLog(session.id, "info", "Info message");
			manager.addLog(session.id, "error", "Error message");
			manager.addLog(session.id, "debug", "Debug message");

			const logs = manager.getLogs(session.id);
			expect(logs).toHaveLength(3);
			expect(logs[0].level).toBe("info");
			expect(logs[1].level).toBe("error");
			expect(logs[2].level).toBe("debug");
		});

		it("returns empty array for session with no logs", () => {
			const session = manager.createSession("Empty Session");
			const logs = manager.getLogs(session.id);
			expect(logs).toHaveLength(0);
		});

		it("does not return logs from other sessions", () => {
			const s1 = manager.createSession("Session 1");
			const s2 = manager.createSession("Session 2");

			manager.addLog(s1.id, "info", "Log for session 1");
			manager.addLog(s2.id, "info", "Log for session 2");

			const s1Logs = manager.getLogs(s1.id);
			const s2Logs = manager.getLogs(s2.id);

			expect(s1Logs).toHaveLength(1);
			expect(s1Logs[0].message).toBe("Log for session 1");
			expect(s2Logs).toHaveLength(1);
			expect(s2Logs[0].message).toBe("Log for session 2");
		});
	});

	describe("persistence", () => {
		it("persists data across manager instances", () => {
			// First manager writes data
			const session = manager.createSession("Persistent Session");
			manager.addMessage(session.id, "user", "Test message");
			manager.createTask(session.id, "Test task");
			manager.addLog(session.id, "info", "Test log");
			manager.close();

			// Second manager reads data
			const manager2 = new MemoryManager({ baseDir: testDir });

			const sessions = manager2.listSessions();
			expect(sessions).toHaveLength(1);
			expect(sessions[0].title).toBe("Persistent Session");

			const messages = manager2.getMessages(session.id);
			expect(messages).toHaveLength(1);
			expect(messages[0].content).toBe("Test message");

			const tasks = manager2.listTasks(session.id);
			expect(tasks).toHaveLength(1);
			expect(tasks[0].goal).toBe("Test task");

			const logs = manager2.getLogs(session.id);
			expect(logs).toHaveLength(1);
			expect(logs[0].message).toBe("Test log");

			manager2.close();
		});
	});
});
