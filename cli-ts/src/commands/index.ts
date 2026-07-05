import { join, resolve } from "node:path";
import chalk from "chalk";
import { Command } from "commander";
import ora from "ora";
import { OllamaEmbeddingProvider } from "../indexer/embeddings.js";
import { RepositoryIndexer } from "../indexer/repository.js";

const DEFAULT_INDEX_DIR = joinHome(".infinity", "index");
const DEFAULT_CHUNK_SIZE = 500;
const DEFAULT_EMBEDDING_MODEL = "nomic-embed-text";

function joinHome(...parts: string[]): string {
	const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
	return join(home, ...parts);
}

function formatNumber(num: number): string {
	return num.toLocaleString();
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	return `${(ms / 60000).toFixed(1)}m`;
}

export const indexCommand = new Command("index")
	.description("Build a searchable index of the repository")
	.argument("[path]", "repository path to index (default: current directory)")
	.option(
		"--index-dir <dir>",
		`index storage directory (default: ${DEFAULT_INDEX_DIR})`,
		DEFAULT_INDEX_DIR,
	)
	.option("--chunk-size <n>", "lines per chunk (default: 500)", String(DEFAULT_CHUNK_SIZE))
	.option("--embeddings", "generate embeddings via local Ollama", false)
	.option(
		"--model <model>",
		`embedding model to use (default: ${DEFAULT_EMBEDDING_MODEL})`,
		DEFAULT_EMBEDDING_MODEL,
	)
	.action(async (repoPath, options) => {
		const spinner = ora("Building index...").start();
		const startTime = Date.now();

		try {
			const absoluteRepoPath = resolve(repoPath);

			// Create indexer
			const indexer = new RepositoryIndexer({
				repoRoot: absoluteRepoPath,
				indexBaseDir: options.indexDir,
				chunkSize: Number(options.chunkSize),
			});

			// Configure embedding provider if requested
			let embeddingsGenerated = 0;
			if (options.embeddings) {
				const embeddingProvider = new OllamaEmbeddingProvider({
					baseUrl: "http://127.0.0.1:11434",
					model: options.model,
					indexDir: indexer.getIndexDir(),
				});

				// Test connection to Ollama
				spinner.text = "Testing Ollama connection...";
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

			// Build the index
			spinner.text = "Scanning repository...";
			const result = await indexer.buildIndex();

			if (options.embeddings) {
				embeddingsGenerated = result.index.chunks.length;
			}

			const duration = Date.now() - startTime;
			spinner.succeed(`Index built in ${formatDuration(duration)}`);

			// Print summary
			console.log();
			console.log(chalk.bold("Index Summary"));
			console.log(chalk.gray("─".repeat(40)));
			console.log(`  ${chalk.cyan("Repository:")} ${absoluteRepoPath}`);
			console.log(`  ${chalk.cyan("Repo ID:")} ${result.index.meta.repoId}`);
			console.log(`  ${chalk.cyan("Files indexed:")} ${formatNumber(result.index.meta.fileCount)}`);
			console.log(
				`  ${chalk.cyan("Chunks created:")} ${formatNumber(result.index.meta.chunkCount)}`,
			);
			console.log(
				`  ${chalk.cyan("Embeddings generated:")} ${options.embeddings ? formatNumber(embeddingsGenerated) : chalk.gray("skipped")}`,
			);
			console.log(`  ${chalk.cyan("Index directory:")} ${result.indexDir}`);
			console.log();
		} catch (error) {
			spinner.fail("Failed to build index");
			if (error instanceof Error) {
				console.error(chalk.red(`Error: ${error.message}`));
			} else {
				console.error(chalk.red("An unknown error occurred"));
			}
			process.exit(1);
		}
	});
