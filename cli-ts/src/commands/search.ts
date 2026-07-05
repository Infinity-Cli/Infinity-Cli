import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import chalk from "chalk";
import { Command } from "commander";
import ora from "ora";
import { OllamaEmbeddingProvider } from "../indexer/embeddings.js";
import { RepositoryIndexer } from "../indexer/repository.js";
import type { SearchResult } from "../indexer/types.js";

const DEFAULT_INDEX_DIR = joinHome(".infinity", "index");
const DEFAULT_LIMIT = 10;
const DEFAULT_EMBEDDING_MODEL = "nomic-embed-text";

function joinHome(...parts: string[]): string {
	const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
	return join(home, ...parts);
}

function truncate(str: string, maxLength: number): string {
	if (str.length <= maxLength) return str;
	return `${str.substring(0, maxLength - 3)}...`;
}

function highlightMatch(text: string, query: string): string {
	const queryTokens = query
		.toLowerCase()
		.split(/[^a-z0-9_]+/)
		.filter((t) => t.length > 0);
	let result = text;
	for (const token of queryTokens) {
		const regex = new RegExp(`(${token})`, "gi");
		result = result.replace(regex, chalk.yellow("$1"));
	}
	return result;
}

export const searchCommand = new Command("search")
	.description("Search the repository index")
	.argument("<query>", "search query")
	.option("--repo <path>", "repository path (default: current directory)", ".")
	.option(
		"--index-dir <dir>",
		`index storage directory (default: ${DEFAULT_INDEX_DIR})`,
		DEFAULT_INDEX_DIR,
	)
	.option(
		"--limit <n>",
		`maximum results to return (default: ${DEFAULT_LIMIT})`,
		String(DEFAULT_LIMIT),
	)
	.option(
		"--semantic",
		"use semantic search with embeddings (requires --embeddings during index)",
		false,
	)
	.option(
		"--model <model>",
		`embedding model for semantic search (default: ${DEFAULT_EMBEDDING_MODEL})`,
		DEFAULT_EMBEDDING_MODEL,
	)
	.action(async (query: string, options) => {
		const spinner = ora("Loading index...").start();

		try {
			const absoluteRepoPath = resolve(options.repo);

			// Verify repository exists
			try {
				await stat(absoluteRepoPath);
			} catch {
				spinner.fail("Repository not found");
				console.error(chalk.red(`Error: Repository not found: ${absoluteRepoPath}`));
				process.exit(1);
			}

			// Create indexer
			const indexer = new RepositoryIndexer({
				repoRoot: absoluteRepoPath,
				indexBaseDir: options.indexDir,
			});

			// Configure embedding provider if semantic search requested
			if (options.semantic) {
				const embeddingProvider = new OllamaEmbeddingProvider({
					baseUrl: "http://127.0.0.1:11434",
					model: options.model,
					indexDir: indexer.getIndexDir(),
				});

				// Check if embeddings exist first
				spinner.text = "Checking embeddings...";
				const embeddings = await embeddingProvider.loadEmbeddings();
				if (embeddings.length === 0) {
					spinner.fail("No embeddings found in index");
					console.error(chalk.red("Error: Index has no embeddings"));
					console.error(chalk.yellow("Re-run index with --embeddings flag to generate embeddings"));
					process.exit(1);
				}

				// Test connection to Ollama
				spinner.text = "Connecting to Ollama...";
				try {
					await embeddingProvider.embedText("test");
					indexer.withEmbeddingProvider(embeddingProvider);
				} catch (error) {
					spinner.fail("Failed to connect to Ollama");
					console.error(chalk.red("Error: Could not connect to Ollama at http://127.0.0.1:11434"));
					console.error(chalk.yellow("Make sure Ollama is running: ollama serve"));
					console.error(chalk.yellow(`And the model is available: ollama pull ${options.model}`));
					process.exit(1);
				}
			}

			// Perform search
			spinner.text = options.semantic ? "Searching semantically..." : "Searching...";
			const limit = Number(options.limit);
			let results: SearchResult[];

			if (options.semantic) {
				results = await indexer.searchSemantic(query, limit);
			} else {
				results = await indexer.searchLexical(query, limit);
			}

			spinner.succeed(`Found ${results.length} result${results.length !== 1 ? "s" : ""}`);

			if (results.length === 0) {
				console.log();
				console.log(
					chalk.gray(
						"No results found. Try a different query or use --semantic for semantic search.",
					),
				);
				return;
			}

			// Print results
			console.log();
			console.log(chalk.bold(`Search Results for "${query}"`));
			if (options.semantic) {
				console.log(chalk.gray("  (semantic search)"));
			} else {
				console.log(chalk.gray("  (lexical search)"));
			}
			console.log(chalk.gray("─".repeat(80)));

			for (let i = 0; i < results.length; i++) {
				const result = results[i];
				const { chunk, file, score } = result;
				const rank = i + 1;

				// Format file path relative to repo root
				const relativePath = file.relativePath;

				// Format snippet (truncate to ~200 chars)
				const snippet = truncate(chunk.content.trim(), 200);
				const highlightedSnippet = highlightMatch(snippet, query);

				// Format line range
				const lineRange =
					chunk.startLine === chunk.endLine
						? `L${chunk.startLine}`
						: `L${chunk.startLine}-${chunk.endLine}`;

				console.log();
				console.log(
					`${chalk.bold.cyan(String(rank).padStart(2))}  ${chalk.gray(`score: ${score.toFixed(3)}`)}`,
				);
				console.log(`     ${chalk.white(relativePath)} ${chalk.gray(lineRange)}`);
				console.log(`     ${highlightedSnippet}`);
			}

			console.log();
			console.log(
				chalk.gray(
					`Showing ${results.length} of ${results.length} result${results.length !== 1 ? "s" : ""}`,
				),
			);
		} catch (error) {
			spinner.fail("Search failed");
			if (error instanceof Error) {
				console.error(chalk.red(`Error: ${error.message}`));
			} else {
				console.error(chalk.red("An unknown error occurred"));
			}
			process.exit(1);
		}
	});
