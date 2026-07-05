import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import chalk from "chalk";
import { Command } from "commander";
import ora from "ora";
import { RepositoryIndexer } from "../indexer/repository.js";
import type { Chunk, IndexedFile, RepositoryIndex } from "../indexer/types.js";

const DEFAULT_INDEX_DIR = joinHome(".infinity", "index");

function joinHome(...parts: string[]): string {
	const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
	return join(home, ...parts);
}

function formatNumber(num: number): string {
	return num.toLocaleString();
}

function displayLanguage(lang: string): string {
	const map: Record<string, string> = {
		typescript: "TypeScript",
		javascript: "JavaScript",
		markdown: "Markdown",
		yaml: "YAML",
		yml: "YAML",
		json: "JSON",
		html: "HTML",
		css: "CSS",
		shell: "Shell",
		bash: "Bash",
		python: "Python",
		dockerfile: "Dockerfile",
	};
	return map[lang] ?? lang.charAt(0).toUpperCase() + lang.slice(1);
}

function getExtension(filePath: string): string {
	const ext = filePath.split(".").pop()?.toLowerCase() ?? "unknown";
	return ext ? `.${ext}` : "unknown";
}

function getParentDir(relativePath: string): string {
	const parts = relativePath.split("/");
	if (parts.length <= 1) return "(root)";
	return parts[0];
}

const STOP_WORDS = new Set([
	"a",
	"an",
	"and",
	"are",
	"as",
	"at",
	"be",
	"by",
	"for",
	"from",
	"has",
	"he",
	"in",
	"is",
	"it",
	"its",
	"of",
	"on",
	"that",
	"the",
	"to",
	"was",
	"were",
	"will",
	"with",
	"this",
	"that",
	"these",
	"those",
	"but",
	"or",
	"not",
	"if",
	"then",
	"else",
	"when",
	"while",
	"do",
	"return",
	"const",
	"let",
	"var",
	"function",
	"class",
	"interface",
	"type",
	"import",
	"export",
	"default",
	"async",
	"await",
	"new",
	"this",
	"super",
	"extends",
	"implements",
	"public",
	"private",
	"protected",
	"static",
	"readonly",
	"abstract",
	"declare",
	"namespace",
	"module",
	"get",
	"set",
	"constructor",
	"void",
	"never",
	"any",
	"unknown",
	"string",
	"number",
	"boolean",
	"object",
	"array",
	"null",
	"undefined",
	"true",
	"false",
	"in",
	"instanceof",
	"typeof",
	"delete",
	"typeof",
	"try",
	"catch",
	"finally",
	"throw",
	"switch",
	"case",
	"break",
	"continue",
	"for",
	"while",
	"do",
	"if",
	"else",
	"return",
	"yield",
]);

interface SummaryStats {
	repoPath: string;
	repoId: string;
	totalFiles: number;
	totalChunks: number;
	totalLines: number;
	languageBreakdown: Record<string, number>;
	topDirectories: Record<string, number>;
	topTokens: Array<{ token: string; count: number }>;
	largestFiles: Array<{ path: string; lines: number }>;
}

function computeSummary(index: RepositoryIndex): SummaryStats {
	const { meta, files, chunks, invertedIndex } = index;

	// Language breakdown
	const languageBreakdown: Record<string, number> = {};
	for (const file of files) {
		const lang = file.language ?? getExtension(file.relativePath);
		languageBreakdown[lang] = (languageBreakdown[lang] ?? 0) + 1;
	}

	// Top directories
	const topDirectories: Record<string, number> = {};
	for (const file of files) {
		const dir = getParentDir(file.relativePath);
		topDirectories[dir] = (topDirectories[dir] ?? 0) + 1;
	}

	// Top tokens from inverted index (excluding stop words)
	const tokenCounts: Array<{ token: string; count: number }> = [];
	for (const [token, chunkIds] of Object.entries(invertedIndex)) {
		if (!STOP_WORDS.has(token) && token.length > 1) {
			tokenCounts.push({ token, count: chunkIds.length });
		}
	}
	tokenCounts.sort((a, b) => b.count - a.count);
	const topTokens = tokenCounts.slice(0, 20);

	// Largest files by line count
	const fileLines = new Map<string, number>();
	for (const chunk of chunks) {
		const lines = chunk.endLine - chunk.startLine + 1;
		fileLines.set(chunk.fileId, (fileLines.get(chunk.fileId) ?? 0) + lines);
	}

	const fileMap = new Map<string, IndexedFile>(files.map((f) => [f.id, f]));
	const largestFiles = Array.from(fileLines.entries())
		.map(([fileId, lines]) => {
			const file = fileMap.get(fileId);
			return { path: file?.relativePath ?? "unknown", lines };
		})
		.sort((a, b) => b.lines - a.lines)
		.slice(0, 10);

	// Total lines (sum of endLine across chunks, but we need unique file lines)
	// Sum chunk line counts
	let totalLines = 0;
	for (const chunk of chunks) {
		totalLines += chunk.endLine - chunk.startLine + 1;
	}

	return {
		repoPath: meta.repoPath,
		repoId: meta.repoId,
		totalFiles: meta.fileCount,
		totalChunks: meta.chunkCount,
		totalLines,
		languageBreakdown,
		topDirectories,
		topTokens,
		largestFiles,
	};
}

function formatTextSummary(stats: SummaryStats): string {
	const lines: string[] = [];

	lines.push(chalk.bold("Repository Summary"));
	lines.push(chalk.gray("═".repeat(50)));
	lines.push("");
	lines.push(`${chalk.cyan("Repository:")} ${stats.repoPath}`);
	lines.push(`${chalk.cyan("Repo ID:")} ${stats.repoId}`);
	lines.push("");

	lines.push(chalk.bold("Overview"));
	lines.push(chalk.gray("─".repeat(50)));
	lines.push(`  ${chalk.white("Total Files:")}     ${formatNumber(stats.totalFiles)}`);
	lines.push(`  ${chalk.white("Total Chunks:")}    ${formatNumber(stats.totalChunks)}`);
	lines.push(`  ${chalk.white("Total Lines:")}     ${formatNumber(stats.totalLines)}`);
	lines.push("");

	lines.push(chalk.bold("Language Breakdown"));
	lines.push(chalk.gray("─".repeat(50)));
	const sortedLanguages = Object.entries(stats.languageBreakdown).sort((a, b) => b[1] - a[1]);
	for (const [lang, count] of sortedLanguages) {
		const bar = "█".repeat(Math.min(Math.round((count / stats.totalFiles) * 20), 20));
		lines.push(
			`  ${chalk.white(displayLanguage(lang).padEnd(15))} ${formatNumber(count).padStart(8)}  ${chalk.gray(bar)}`,
		);
	}
	lines.push("");

	lines.push(chalk.bold("Top Directories"));
	lines.push(chalk.gray("─".repeat(50)));
	const sortedDirs = Object.entries(stats.topDirectories)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 15);
	for (const [dir, count] of sortedDirs) {
		lines.push(`  ${chalk.white(dir.padEnd(30))} ${formatNumber(count)}`);
	}
	lines.push("");

	lines.push(chalk.bold("Most Common Tokens (non-stop-word)"));
	lines.push(chalk.gray("─".repeat(50)));
	for (const { token, count } of stats.topTokens) {
		lines.push(`  ${chalk.white(token.padEnd(25))} ${formatNumber(count)}`);
	}
	lines.push("");

	lines.push(chalk.bold("Largest Files (by line count)"));
	lines.push(chalk.gray("─".repeat(50)));
	for (const { path, lines: lineCount } of stats.largestFiles) {
		lines.push(`  ${chalk.white(path.padEnd(50))} ${formatNumber(lineCount)} lines`);
	}
	lines.push("");

	return lines.join("\n");
}

function formatMarkdownSummary(stats: SummaryStats): string {
	const lines: string[] = [];

	lines.push("# Repository Summary");
	lines.push("");
	lines.push(`**Repository:** ${stats.repoPath}`);
	lines.push(`**Repo ID:** ${stats.repoId}`);
	lines.push("");

	lines.push("## Overview");
	lines.push("");
	lines.push("| Metric | Value |");
	lines.push("|--------|-------|");
	lines.push(`| Total Files | ${formatNumber(stats.totalFiles)} |`);
	lines.push(`| Total Chunks | ${formatNumber(stats.totalChunks)} |`);
	lines.push(`| Total Lines | ${formatNumber(stats.totalLines)} |`);
	lines.push("");

	lines.push("## Language Breakdown");
	lines.push("");
	lines.push("| Language | Files |");
	lines.push("|----------|-------|");
	const sortedLanguages = Object.entries(stats.languageBreakdown).sort((a, b) => b[1] - a[1]);
	for (const [lang, count] of sortedLanguages) {
		lines.push(`| ${lang} | ${formatNumber(count)} |`);
	}
	lines.push("");

	lines.push("## Top Directories");
	lines.push("");
	lines.push("| Directory | Files |");
	lines.push("|-----------|-------|");
	const sortedDirs = Object.entries(stats.topDirectories)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 15);
	for (const [dir, count] of sortedDirs) {
		lines.push(`| ${dir} | ${formatNumber(count)} |`);
	}
	lines.push("");

	lines.push("## Most Common Tokens (non-stop-word)");
	lines.push("");
	lines.push("| Token | Occurrences |");
	lines.push("|-------|-------------|");
	for (const { token, count } of stats.topTokens) {
		lines.push(`| ${token} | ${formatNumber(count)} |`);
	}
	lines.push("");

	lines.push("## Largest Files (by line count)");
	lines.push("");
	lines.push("| File | Lines |");
	lines.push("|------|-------|");
	for (const { path, lines: lineCount } of stats.largestFiles) {
		lines.push(`| ${path} | ${formatNumber(lineCount)} |`);
	}
	lines.push("");

	return lines.join("\n");
}

function formatJsonSummary(stats: SummaryStats): string {
	return JSON.stringify(stats, null, 2);
}

export const summarizeCommand = new Command("summarize")
	.description("Generate a summary of the repository index")
	.argument("[path]", "repository path to summarize (default: current directory)", ".")
	.option("--repo <path>", "repository path to summarize (default: current directory)")
	.option(
		"--index-dir <dir>",
		`index storage directory (default: ${DEFAULT_INDEX_DIR})`,
		DEFAULT_INDEX_DIR,
	)
	.option("--format <format>", "output format: text, json, markdown (default: text)", "text")
	.option("--output <file>", "write summary to file instead of stdout")
	.action(async (repoPath, options) => {
		const spinner = ora("Loading index...").start();

		try {
			const targetRepo = options.repo ?? repoPath;
			const absoluteRepoPath = resolve(targetRepo);

			// Create indexer
			const indexer = new RepositoryIndexer({
				repoRoot: absoluteRepoPath,
				indexBaseDir: options.indexDir,
			});

			// Try to load existing index
			let index = await indexer.loadIndex();

			// If index doesn't exist, build it
			if (!index) {
				spinner.text = "Index not found, building...";
				const result = await indexer.buildIndex();
				index = result.index;
			}

			spinner.text = "Generating summary...";
			const stats = computeSummary(index);
			spinner.succeed("Summary generated");

			// Format output
			let output: string;
			switch (options.format) {
				case "json":
					output = formatJsonSummary(stats);
					break;
				case "markdown":
					output = formatMarkdownSummary(stats);
					break;
				default:
					output = formatTextSummary(stats);
					break;
			}

			// Write to file or stdout
			if (options.output) {
				const outputPath = resolve(options.output);
				await writeFile(outputPath, output, "utf-8");
				console.log(chalk.green(`Summary written to ${outputPath}`));
			} else {
				console.log();
				console.log(output);
			}
		} catch (error) {
			spinner.fail("Failed to generate summary");
			if (error instanceof Error) {
				console.error(chalk.red(`Error: ${error.message}`));
			} else {
				console.error(chalk.red("An unknown error occurred"));
			}
			process.exit(1);
		}
	});
