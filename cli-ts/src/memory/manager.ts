import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Session {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
}

export interface Message {
	id: string;
	sessionId: string;
	role: "user" | "assistant" | "system";
	content: string;
	createdAt: string;
}

export interface Task {
	id: string;
	sessionId: string;
	goal: string;
	status: "pending" | "running" | "completed" | "failed";
	createdAt: string;
	updatedAt: string;
}

export interface Log {
	id: string;
	sessionId: string;
	level: string;
	message: string;
	createdAt: string;
}

const now = () => new Date().toISOString();

function ensureDir(dir: string): void {
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
}

function readJsonLines<T>(filePath: string): T[] {
	if (!existsSync(filePath)) {
		return [];
	}
	const content = readFileSync(filePath, "utf-8").trim();
	if (!content) {
		return [];
	}
	return content.split("\n").map((line) => JSON.parse(line)) as T[];
}

function writeJsonLines<T>(filePath: string, items: T[]): void {
	const dir = join(filePath, "..");
	ensureDir(dir);
	const content = items.map((item) => JSON.stringify(item)).join("\n");
	writeFileSync(filePath, content + (content ? "\n" : ""), "utf-8");
}

function appendJsonLine<T>(filePath: string, item: T): void {
	const dir = join(filePath, "..");
	ensureDir(dir);
	appendFileSync(filePath, `${JSON.stringify(item)}\n`, "utf-8");
}

export class MemoryManager {
	private baseDir: string;
	private sessionsFile: string;
	private messagesFile: string;
	private tasksFile: string;
	private logsFile: string;

	constructor(options?: { baseDir?: string }) {
		this.baseDir =
			options?.baseDir ??
			process.env.INFINITY_MEMORY_PATH ??
			join(homedir(), ".infinity", "memory");
		this.sessionsFile = join(this.baseDir, "sessions.json");
		this.messagesFile = join(this.baseDir, "messages.json");
		this.tasksFile = join(this.baseDir, "tasks.json");
		this.logsFile = join(this.baseDir, "logs.json");
		ensureDir(this.baseDir);
	}

	createSession(title: string): Session {
		const session: Session = {
			id: randomUUID(),
			title,
			createdAt: now(),
			updatedAt: now(),
		};
		const sessions = readJsonLines<Session>(this.sessionsFile);
		sessions.push(session);
		writeJsonLines(this.sessionsFile, sessions);
		return session;
	}

	getSession(id: string): Session | undefined {
		const sessions = readJsonLines<Session>(this.sessionsFile);
		return sessions.find((s) => s.id === id);
	}

	listSessions(): Session[] {
		return readJsonLines<Session>(this.sessionsFile);
	}

	addMessage(sessionId: string, role: "user" | "assistant" | "system", content: string): Message {
		const message: Message = {
			id: randomUUID(),
			sessionId,
			role,
			content,
			createdAt: now(),
		};
		appendJsonLine(this.messagesFile, message);
		return message;
	}

	getMessages(sessionId: string): Message[] {
		const messages = readJsonLines<Message>(this.messagesFile);
		return messages.filter((m) => m.sessionId === sessionId);
	}

	createTask(sessionId: string, goal: string): Task {
		const task: Task = {
			id: randomUUID(),
			sessionId,
			goal,
			status: "pending",
			createdAt: now(),
			updatedAt: now(),
		};
		appendJsonLine(this.tasksFile, task);
		return task;
	}

	getTask(id: string): Task | undefined {
		const tasks = readJsonLines<Task>(this.tasksFile);
		return tasks.find((t) => t.id === id);
	}

	updateTask(
		id: string,
		updates: Partial<Pick<Task, "goal" | "status" | "updatedAt">>,
	): Task | undefined {
		const tasks = readJsonLines<Task>(this.tasksFile);
		const index = tasks.findIndex((t) => t.id === id);
		if (index === -1) {
			return undefined;
		}
		tasks[index] = {
			...tasks[index],
			...updates,
			updatedAt: now(),
		};
		writeJsonLines(this.tasksFile, tasks);
		return tasks[index];
	}

	listTasks(sessionId?: string): Task[] {
		const tasks = readJsonLines<Task>(this.tasksFile);
		if (sessionId) {
			return tasks.filter((t) => t.sessionId === sessionId);
		}
		return tasks;
	}

	addLog(sessionId: string, level: string, message: string): Log {
		const log: Log = {
			id: randomUUID(),
			sessionId,
			level,
			message,
			createdAt: now(),
		};
		appendJsonLine(this.logsFile, log);
		return log;
	}

	getLogs(sessionId: string): Log[] {
		const logs = readJsonLines<Log>(this.logsFile);
		return logs.filter((l) => l.sessionId === sessionId);
	}

	close(): void {
		// no-op for compatibility
	}

	getBaseDir(): string {
		return this.baseDir;
	}
}
