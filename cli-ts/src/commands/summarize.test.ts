import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RepositoryIndexer } from "../indexer/repository.js";
import { summarizeCommand } from "./summarize.js";

describe("summarize command", () => {
	let tempDir: string;
	let tempRepoDir: string;
	let tempIndexDir: string;

	beforeEach(async () => {
		tempDir = (await mkdir(
			join(tmpdir(), `infinity-test-${Date.now()}-${Math.random().toString(36).slice(2)}`),
			{ recursive: true },
		)) as string;
		tempRepoDir = join(tempDir, "repo");
		tempIndexDir = join(tempDir, "index");
		await mkdir(tempRepoDir, { recursive: true });
		await mkdir(tempIndexDir, { recursive: true });

		// Create some test files
		await writeFile(
			join(tempRepoDir, "main.ts"),
			`
export function hello() {
	console.log('Hello, world!');
}

export class Greeter {
	greet(name: string): string {
		return \`Hello, \${name}!\`;
	}
}
`.trim(),
		);
		await writeFile(
			join(tempRepoDir, "utils.ts"),
			`
export function add(a: number, b: number): number {
	return a + b;
}

export function multiply(a: number, b: number): number {
	return a * b;
}
`.trim(),
		);
		await writeFile(
			join(tempRepoDir, "README.md"),
			`
# Test Repository

This is a test repository for the summarize command.
`.trim(),
		);
		await mkdir(join(tempRepoDir, "src"), { recursive: true });
		await writeFile(
			join(tempRepoDir, "src", "index.ts"),
			`
import { hello } from './main.js';

hello();
`.trim(),
		);
		await writeFile(
			join(tempRepoDir, "src", "helper.ts"),
			`
export function helper() {
	return 'helper';
}
`.trim(),
		);
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	async function buildIndex(): Promise<void> {
		const indexer = new RepositoryIndexer({
			repoRoot: tempRepoDir,
			indexBaseDir: tempIndexDir,
			chunkSize: 10,
		});
		await indexer.buildIndex();
	}

	it("should build index if not exists and generate text summary", async () => {
		// Don't pre-build index - let summarize command build it

		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		try {
			await summarizeCommand.parseAsync(
				[tempRepoDir, "--index-dir", tempIndexDir, "--format", "text"],
				{ from: "user" },
			);

			const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
			expect(output).toContain("Repository Summary");
			expect(output).toContain("Total Files:");
			expect(output).toContain("Total Chunks:");
			expect(output).toContain("Total Lines:");
			expect(output).toContain("Language Breakdown");
			expect(output).toContain("TypeScript");
			expect(output).toContain("Markdown");
			expect(output).toContain("Top Directories");
			expect(output).toContain("Most Common Tokens");
			expect(output).toContain("Largest Files");
		} finally {
			consoleSpy.mockRestore();
			consoleErrorSpy.mockRestore();
		}
	});

	it("should load existing index and generate text summary", async () => {
		// Pre-build index
		await buildIndex();

		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		try {
			await summarizeCommand.parseAsync(
				[tempRepoDir, "--index-dir", tempIndexDir, "--format", "text"],
				{ from: "user" },
			);

			const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
			expect(output).toContain("Repository Summary");
			expect(output).toContain("Total Files:");
			expect(output).toContain("TypeScript");
			expect(output).toContain("Markdown");
		} finally {
			consoleSpy.mockRestore();
			consoleErrorSpy.mockRestore();
		}
	});

	it("should generate JSON summary", async () => {
		await buildIndex();

		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		try {
			await summarizeCommand.parseAsync(
				[tempRepoDir, "--index-dir", tempIndexDir, "--format", "json"],
				{ from: "user" },
			);

			const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
			const parsed = JSON.parse(output);
			expect(parsed).toHaveProperty("repoPath");
			expect(parsed).toHaveProperty("repoId");
			expect(parsed).toHaveProperty("totalFiles");
			expect(parsed).toHaveProperty("totalChunks");
			expect(parsed).toHaveProperty("totalLines");
			expect(parsed).toHaveProperty("languageBreakdown");
			expect(parsed).toHaveProperty("topDirectories");
			expect(parsed).toHaveProperty("topTokens");
			expect(parsed).toHaveProperty("largestFiles");
			expect(parsed.totalFiles).toBeGreaterThan(0);
		} finally {
			consoleSpy.mockRestore();
			consoleErrorSpy.mockRestore();
		}
	});

	it("should generate markdown summary", async () => {
		await buildIndex();

		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		try {
			await summarizeCommand.parseAsync(
				[tempRepoDir, "--index-dir", tempIndexDir, "--format", "markdown"],
				{ from: "user" },
			);

			const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
			expect(output).toContain("# Repository Summary");
			expect(output).toContain("## Overview");
			expect(output).toContain("## Language Breakdown");
			expect(output).toContain("## Top Directories");
			expect(output).toContain("## Most Common Tokens");
			expect(output).toContain("## Largest Files");
			expect(output).toContain("| Total Files |");
			expect(output).toContain("| Language | Files |");
		} finally {
			consoleSpy.mockRestore();
			consoleErrorSpy.mockRestore();
		}
	});

	it("should write summary to output file", async () => {
		await buildIndex();
		const outputFile = join(tempDir, "summary.txt");

		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		try {
			await summarizeCommand.parseAsync(
				[tempRepoDir, "--index-dir", tempIndexDir, "--format", "text", "--output", outputFile],
				{ from: "user" },
			);

			const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
			expect(output).toContain("Summary written to");

			const fileContent = await readFile(outputFile, "utf-8");
			expect(fileContent).toContain("Repository Summary");
			expect(fileContent).toContain("Total Files:");
			expect(fileContent).toContain("Language Breakdown");
		} finally {
			consoleSpy.mockRestore();
			consoleErrorSpy.mockRestore();
		}
	});

	it("should write JSON to output file", async () => {
		await buildIndex();
		const outputFile = join(tempDir, "summary.json");

		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		try {
			await summarizeCommand.parseAsync(
				[tempRepoDir, "--index-dir", tempIndexDir, "--format", "json", "--output", outputFile],
				{ from: "user" },
			);

			const fileContent = await readFile(outputFile, "utf-8");
			const parsed = JSON.parse(fileContent);
			expect(parsed).toHaveProperty("repoPath");
			expect(parsed).toHaveProperty("totalFiles");
		} finally {
			consoleSpy.mockRestore();
			consoleErrorSpy.mockRestore();
		}
	});

	it("should write markdown to output file", async () => {
		await buildIndex();
		const outputFile = join(tempDir, "summary.md");

		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		try {
			await summarizeCommand.parseAsync(
				[tempRepoDir, "--index-dir", tempIndexDir, "--format", "markdown", "--output", outputFile],
				{ from: "user" },
			);

			const fileContent = await readFile(outputFile, "utf-8");
			expect(fileContent).toContain("# Repository Summary");
			expect(fileContent).toContain("## Overview");
		} finally {
			consoleSpy.mockRestore();
			consoleErrorSpy.mockRestore();
		}
	});

	it("should use default repo path (current directory)", async () => {
		await buildIndex();

		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const originalCwd = process.cwd();
		try {
			// Change to temp repo dir
			process.chdir(tempRepoDir);

			await summarizeCommand.parseAsync(["--index-dir", tempIndexDir, "--format", "text"], {
				from: "user",
			});

			const output = consoleSpy.mock.calls.map((c) => c.join(" ")).join("\n");
			expect(output).toContain("Repository Summary");
		} finally {
			process.chdir(originalCwd);
			consoleSpy.mockRestore();
			consoleErrorSpy.mockRestore();
		}
	});

	it("should handle non-existent repository gracefully", async () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

		try {
			await summarizeCommand.parseAsync(
				["/non/existent/path", "--index-dir", tempIndexDir, "--format", "text"],
				{ from: "user" },
			);

			expect(exitSpy).toHaveBeenCalledWith(1);
			expect(consoleErrorSpy).toHaveBeenCalled();
		} finally {
			consoleSpy.mockRestore();
			consoleErrorSpy.mockRestore();
			exitSpy.mockRestore();
		}
	});
});
