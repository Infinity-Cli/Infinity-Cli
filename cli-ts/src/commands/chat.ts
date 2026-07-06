import { stdin as stdinInput, stdout as stdoutOutput } from "node:process";
import { createInterface } from "node:readline/promises";
import chalk from "chalk";
import { Command } from "commander";
import { AskEngineError, askOnce } from "../ask-engine.js";

export interface ChatActionOptions {
	provider?: string;
	model?: string;
	session: string;
}

export interface ChatRuntime {
	isTTY: boolean;
	question: (prompt: string) => Promise<string>;
	close: () => void;
	writeLine: (line: string) => void;
	writeError: (line: string) => void;
}

export interface ChatDeps {
	askOnce: typeof askOnce;
	createReadline: () => ChatRuntime;
}

export const HELP_TEXT = [
	"Available commands:",
	"  exit, quit, :q    End the session",
	"  help, :h          Show this help",
	"  <anything else>   Send a message to the assistant",
].join("\n");

export function createTerminalReadline(): ChatRuntime {
	const rl = createInterface({ input: stdinInput, output: stdoutOutput });
	return {
		isTTY: stdinInput.isTTY === true,
		question: (prompt: string) => rl.question(prompt),
		close: () => rl.close(),
		writeLine: (line: string) => {
			console.log(line);
		},
		writeError: (line: string) => {
			console.error(line);
		},
	};
}

export async function runChat(
	options: ChatActionOptions,
	deps: ChatDeps = { askOnce, createReadline: createTerminalReadline },
): Promise<void> {
	const runtime = deps.createReadline();

	if (!runtime.isTTY) {
		runtime.close();
		runtime.writeError(chalk.red("Error: infinity chat requires an interactive terminal (TTY)."));
		process.exit(1);
	}

	runtime.writeLine(chalk.dim('Starting chat session. Type "help" for commands.'));

	try {
		while (true) {
			let line: string;
			try {
				line = (await runtime.question(chalk.cyan("you> "))).trim();
			} catch {
				// Readline closed (e.g. Ctrl+D / stdin EOF).
				break;
			}

			if (line === "") {
				continue;
			}

			const lowered = line.toLowerCase();

			if (lowered === "exit" || lowered === "quit" || lowered === ":q") {
				runtime.writeLine(chalk.dim("Goodbye."));
				break;
			}

			if (lowered === "help" || lowered === ":h") {
				runtime.writeLine(HELP_TEXT);
				continue;
			}

			try {
				const result = await deps.askOnce(line, {
					provider: options.provider,
					model: options.model,
					session: options.session,
				});
				runtime.writeLine(chalk.green(`assistant> ${result.response}`));
			} catch (error) {
				if (error instanceof AskEngineError && error.code === "API_KEY_MISSING") {
					runtime.writeError(chalk.red(`Error: ${error.message}`));
					if (error.providerId) {
						runtime.writeError(
							chalk.yellow(`Run: infinity config set apiKey.${error.providerId} <your-key>`),
						);
					}
				} else if (error instanceof Error) {
					runtime.writeError(chalk.red(`Error: ${error.message}`));
				} else {
					runtime.writeError(chalk.red("Error: an unknown error occurred"));
				}
			}
		}
	} finally {
		runtime.close();
	}
}

export const chatCommand = new Command("chat")
	.description("Start an interactive REPL chat session")
	.option("--provider <provider>", "override the default provider")
	.option("--model <model>", "override the default model")
	.option("--session <session>", "session id to store conversation under", "default")
	.action(async (options: ChatActionOptions) => {
		await runChat(options);
	});
