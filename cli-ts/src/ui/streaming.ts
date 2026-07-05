import chalk from "chalk";
import type { Ora } from "ora";

export type OutputFormat = "pretty" | "markdown" | "json";

interface LogEvent {
	type: "log";
	level: "info" | "warn" | "error";
	message: string;
	timestamp: string;
}

interface StatusEvent {
	type: "status";
	action: "start" | "update" | "succeed" | "fail";
	message: string;
	timestamp: string;
}

interface ProgressEvent {
	type: "progress";
	completed: number;
	failed: number;
	skipped: number;
	total: number;
	timestamp: string;
}

interface SummaryEvent {
	type: "summary";
	goal?: string;
	completed: number;
	failed: number;
	skipped: number;
	total: number;
	timestamp: string;
}

type UIEvent = LogEvent | StatusEvent | ProgressEvent | SummaryEvent;

export class StreamingUI {
	private format: OutputFormat;
	private spinner: Ora | null = null;
	private events: UIEvent[] = [];
	private markdownLines: string[] = [];
	private isMarkdownMode: boolean;
	private isJsonMode: boolean;
	private isPrettyMode: boolean;

	constructor(format: OutputFormat = "pretty") {
		this.format = format;
		this.isMarkdownMode = format === "markdown";
		this.isJsonMode = format === "json";
		this.isPrettyMode = format === "pretty";
	}

	async start(message: string): Promise<void> {
		const timestamp = new Date().toISOString();
		if (this.isPrettyMode) {
			const oraModule = await import("ora");
			this.spinner = oraModule.default(message).start();
		} else if (this.isMarkdownMode) {
			this.markdownLines.push(`> **Status:** ${message}`);
		} else if (this.isJsonMode) {
			this.events.push({ type: "status", action: "start", message, timestamp });
		}
	}

	async update(message: string): Promise<void> {
		const timestamp = new Date().toISOString();
		if (this.isPrettyMode && this.spinner) {
			this.spinner.text = message;
		} else if (this.isMarkdownMode) {
			this.markdownLines.push(`> **Update:** ${message}`);
		} else if (this.isJsonMode) {
			this.events.push({ type: "status", action: "update", message, timestamp });
		}
	}

	async succeed(message?: string): Promise<void> {
		const timestamp = new Date().toISOString();
		if (this.isPrettyMode && this.spinner) {
			this.spinner.succeed(message);
			this.spinner = null;
		} else if (this.isMarkdownMode) {
			this.markdownLines.push(`> ✅ **Success:** ${message ?? "Completed"}`);
		} else if (this.isJsonMode) {
			this.events.push({
				type: "status",
				action: "succeed",
				message: message ?? "Completed",
				timestamp,
			});
		}
	}

	async fail(message?: string): Promise<void> {
		const timestamp = new Date().toISOString();
		if (this.isPrettyMode && this.spinner) {
			this.spinner.fail(message);
			this.spinner = null;
		} else if (this.isMarkdownMode) {
			this.markdownLines.push(`> ❌ **Failed:** ${message ?? "Failed"}`);
		} else if (this.isJsonMode) {
			this.events.push({ type: "status", action: "fail", message: message ?? "Failed", timestamp });
		}
	}

	log(level: "info" | "warn" | "error", message: string): void {
		const timestamp = new Date().toISOString();
		if (this.isPrettyMode) {
			const prefix =
				level === "info" ? chalk.blue("ℹ") : level === "warn" ? chalk.yellow("⚠") : chalk.red("✖");
			const coloredMessage =
				level === "info"
					? chalk.white(message)
					: level === "warn"
						? chalk.yellow(message)
						: chalk.red(message);
			console.log(`${prefix} ${coloredMessage}`);
		} else if (this.isMarkdownMode) {
			const icon = level === "info" ? "ℹ️" : level === "warn" ? "⚠️" : "❌";
			this.markdownLines.push(`- ${icon} **${level.toUpperCase()}:** ${message}`);
		} else if (this.isJsonMode) {
			this.events.push({ type: "log", level, message, timestamp });
		}
	}

	progress(completed: number, failed: number, skipped: number, total: number): void {
		const timestamp = new Date().toISOString();
		if (this.isPrettyMode && this.spinner) {
			this.spinner.text = `Progress: ${completed}/${total} completed, ${failed} failed, ${skipped} skipped`;
		} else if (this.isMarkdownMode) {
			this.markdownLines.push(
				`> **Progress:** ${completed}/${total} completed, ${failed} failed, ${skipped} skipped`,
			);
		} else if (this.isJsonMode) {
			this.events.push({ type: "progress", completed, failed, skipped, total, timestamp });
		}
	}

	renderSummary(summary: {
		goal?: string;
		completed: number;
		failed: number;
		skipped: number;
		total: number;
	}): void {
		const timestamp = new Date().toISOString();
		if (this.isPrettyMode) {
			console.log();
			console.log(chalk.bold("Execution Summary"));
			console.log(chalk.gray("═".repeat(40)));
			console.log(`  ${chalk.green("Completed:")} ${summary.completed}`);
			console.log(`  ${chalk.red("Failed:")}    ${summary.failed}`);
			console.log(`  ${chalk.yellow("Skipped:")}   ${summary.skipped}`);
			console.log(`  ${chalk.white("Total:")}     ${summary.total}`);
			if (summary.goal) {
				console.log(`  ${chalk.cyan("Goal:")}      ${summary.goal}`);
			}
			console.log();
		} else if (this.isMarkdownMode) {
			this.markdownLines.push("");
			this.markdownLines.push("# Execution Report");
			this.markdownLines.push("");
			if (summary.goal) {
				this.markdownLines.push("## Goal");
				this.markdownLines.push("");
				this.markdownLines.push(summary.goal);
				this.markdownLines.push("");
			}
			this.markdownLines.push("## Summary");
			this.markdownLines.push("");
			this.markdownLines.push("| Metric | Count |");
			this.markdownLines.push("|--------|-------|");
			this.markdownLines.push(`| Completed | ${summary.completed} |`);
			this.markdownLines.push(`| Failed | ${summary.failed} |`);
			this.markdownLines.push(`| Skipped | ${summary.skipped} |`);
			this.markdownLines.push(`| Total | ${summary.total} |`);
			this.markdownLines.push("");
		} else if (this.isJsonMode) {
			this.events.push({
				type: "summary",
				goal: summary.goal,
				completed: summary.completed,
				failed: summary.failed,
				skipped: summary.skipped,
				total: summary.total,
				timestamp,
			});
		}
	}

	getOutput(): string {
		if (this.isJsonMode) {
			return JSON.stringify(this.events, null, 2);
		}
		if (this.isMarkdownMode) {
			return this.markdownLines.join("\n");
		}
		return "";
	}
}
