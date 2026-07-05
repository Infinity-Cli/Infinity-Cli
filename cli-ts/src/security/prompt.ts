import { stdin as processStdin, stdout as processStdout } from "node:process";
import { type Interface, createInterface } from "node:readline/promises";
import chalk from "chalk";
import type { PermissionRequest } from "./types.js";

export interface ConsolePromptOptions {
	input?: NodeJS.ReadableStream;
	output?: NodeJS.WritableStream;
}

export function createConsolePrompt(
	options: ConsolePromptOptions = {},
): (request: PermissionRequest) => Promise<boolean> {
	const input = options.input ?? processStdin;
	const output = options.output ?? processStdout;

	const rl = createInterface({
		input,
		output,
	});

	return async (request: PermissionRequest): Promise<boolean> => {
		const destructiveMark = request.destructive ? chalk.red(" [DESTRUCTIVE]") : "";
		const pathInfo = request.path ? chalk.cyan(`\n  Path: ${request.path}`) : "";
		const description = request.description ? chalk.gray(`\n  ${request.description}`) : "";

		output.write(
			chalk.yellow("\n⚠ Permission Request") +
				destructiveMark +
				chalk.yellow("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━") +
				chalk.white(`\n  Tool: ${chalk.bold(request.tool)}`) +
				chalk.white(`\n  Operation: ${chalk.bold(request.operation)}`) +
				pathInfo +
				description +
				chalk.yellow("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━") +
				chalk.white("\nAllow? [y/N] "),
		);

		try {
			const answer = await rl.question("");
			return answer.trim().toLowerCase().startsWith("y");
		} finally {
			rl.close();
		}
	};
}
