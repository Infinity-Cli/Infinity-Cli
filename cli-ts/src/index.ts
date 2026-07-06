#!/usr/bin/env node
import chalk from "chalk";
import { Command } from "commander";
import dotenv from "dotenv";
import { askCommand } from "./commands/ask.js";
import { bridgeCommand } from "./commands/bridge.js";
import { configCommand } from "./commands/config.js";
import { daemonCommand } from "./commands/daemon.js";
import { historyCommand } from "./commands/history.js";
import { indexCommand } from "./commands/index.js";
import { onboardCommand } from "./commands/onboard.js";
import { runCommand } from "./commands/run.js";
import { searchCommand } from "./commands/search.js";
import { summarizeCommand } from "./commands/summarize.js";
import { updateCommand } from "./commands/update.js";

dotenv.config();

const program = new Command();

program
	.name("infinity")
	.description("Autonomous coding CLI")
	.version("0.1.0")
	.option("-c, --config <path>", "path to a custom config file")
	.addCommand(askCommand)
	.addCommand(bridgeCommand)
	.addCommand(configCommand)
	.addCommand(historyCommand)
	.addCommand(indexCommand)
	.addCommand(runCommand)
	.addCommand(searchCommand)
	.addCommand(daemonCommand)
	.addCommand(summarizeCommand)
	.addCommand(onboardCommand)
	.addCommand(updateCommand);

program.action(() => {
	const width = 62;
	const title = "Infinity CLI";
	const subtitle = "Terminal-native autonomous AI operating system";

	const pad = (text: string) => {
		const side = Math.max(0, width - text.length - 2);
		const left = Math.floor(side / 2);
		const right = side - left;
		return `║${" ".repeat(left)}${text}${" ".repeat(right)}║`;
	};

	const line = "═".repeat(width);
	console.log(chalk.cyan(`╔${line}╗`));
	console.log(chalk.cyan(pad(chalk.bold(title))));
	console.log(chalk.cyan(pad(subtitle)));
	console.log(chalk.cyan(`╚${line}╝`));
	console.log();

	program.outputHelp();
});

await program.parseAsync();
