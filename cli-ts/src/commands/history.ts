import { rmSync } from "node:fs";
import chalk from "chalk";
import { Command } from "commander";
import { MemoryManager } from "../memory/index.js";

function getManager(): MemoryManager {
	return new MemoryManager();
}

export const historyCommand = new Command("history")
	.description("Manage conversation history and sessions")
	.option("--session <session>", "session id to use", "default")
	.option("--list", "list sessions")
	.option("--show [session]", "show messages for a session")
	.option("--clear", "clear stored memory")
	.action((options: { session: string; list?: boolean; show?: string | true; clear?: boolean }) => {
		const manager = getManager();
		const id = options.session;

		if (options.clear) {
			const session = manager.getSession(id);
			if (!session) {
				console.error(chalk.red(`Session not found: ${id}`));
				process.exit(1);
				return;
			}
			rmSync(manager.getBaseDir(), { recursive: true, force: true });
			console.log(chalk.yellow(`Cleared memory (session: ${id})`));
			return;
		}

		if (options.list || (!options.show && !options.clear)) {
			const sessions = manager.listSessions().sort((a, b) => {
				return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
			});
			if (sessions.length === 0) {
				console.log(chalk.gray("No sessions found."));
				return;
			}
			for (const session of sessions) {
				console.log(`${session.id} | ${session.title} | ${session.updatedAt}`);
			}
			return;
		}

		const showId = typeof options.show === "string" ? options.show : id;
		const session = manager.getSession(showId);
		if (!session) {
			console.error(chalk.red(`Session not found: ${showId}`));
			process.exit(1);
			return;
		}
		const messages = manager.getMessages(session.id);
		if (messages.length === 0) {
			console.log(chalk.gray("No messages in this session."));
			return;
		}
		for (const message of messages) {
			console.log(`[${message.role}] ${message.content}`);
		}
	});
