/**
 * Tests for the RepositoryIndexer.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RepositoryIndexer } from "./repository.js";

describe("RepositoryIndexer", () => {
	let tempDir: string;
	let repoDir: string;
	let indexBaseDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "infinity-test-"));
		repoDir = join(tempDir, "test-repo");
		indexBaseDir = join(tempDir, "index");
		await mkdir(repoDir, { recursive: true });
		await mkdir(indexBaseDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	async function createTestRepo() {
		// Create a TypeScript file
		await writeFile(
			join(repoDir, "main.ts"),
			`export function hello(name: string): string {
	return \`Hello, \${name}!\`;
}

export class Greeter {
	private greeting: string;

	constructor(greeting: string) {
		this.greeting = greeting;
	}

	greet(name: string): string {
		return \`\${this.greeting}, \${name}!\`;
	}
}

const greeter = new Greeter('Hi');
console.log(greeter.greet('World'));
`,
		);

		// Create a Markdown file
		await writeFile(
			join(repoDir, "README.md"),
			`# Test Repository

This is a **test** repository for the indexer.

## Features

- Lexical search
- File indexing
- Chunk splitting

## Usage

Run the indexer to build the search index.
`,
		);

		// Create a nested file
		await mkdir(join(repoDir, "src", "utils"), { recursive: true });
		await writeFile(
			join(repoDir, "src", "utils", "helpers.ts"),
			`export function add(a: number, b: number): number {
	return a + b;
}

export function multiply(a: number, b: number): number {
	return a * b;
}
`,
		);

		// Create node_modules that should be ignored
		await mkdir(join(repoDir, "node_modules", "some-package"), { recursive: true });
		await writeFile(
			join(repoDir, "node_modules", "some-package", "index.js"),
			"module.exports = { ignored: true };",
		);

		// Create .git directory that should be ignored
		await mkdir(join(repoDir, ".git", "objects"), { recursive: true });
		await writeFile(join(repoDir, ".git", "config"), "[core]\nrepositoryformatversion = 0\n");

		// Create dist directory that should be ignored
		await mkdir(join(repoDir, "dist"), { recursive: true });
		await writeFile(join(repoDir, "dist", "bundle.js"), 'console.log("bundled");');

		// Create .gitignore
		await writeFile(
			join(repoDir, ".gitignore"),
			`# Custom ignore
custom-ignore/
*.tmp
`,
		);

		// Create custom ignore directory
		await mkdir(join(repoDir, "custom-ignore"), { recursive: true });
		await writeFile(join(repoDir, "custom-ignore", "secret.txt"), "should be ignored");

		// Create .tmp file that should be ignored
		await writeFile(join(repoDir, "temp.tmp"), "temporary file");
	}

	it("should build index and create all required files", async () => {
		await createTestRepo();

		const indexer = new RepositoryIndexer({
			repoRoot: repoDir,
			indexBaseDir,
		});

		const result = await indexer.buildIndex();

		// Check index directory structure
		const indexDir = result.indexDir;
		expect(indexDir).toBe(join(indexBaseDir, indexer.getRepoId()));

		// Check meta.json
		expect(result.index.meta).toBeDefined();
		expect(result.index.meta.repoPath).toBe(repoDir);
		expect(result.index.meta.repoId).toBe(indexer.getRepoId());
		expect(result.index.meta.fileCount).toBeGreaterThan(0);
		expect(result.index.meta.chunkCount).toBeGreaterThan(0);

		// Check files.json
		expect(result.index.files).toBeInstanceOf(Array);
		expect(result.index.files.length).toBeGreaterThan(0);

		// Check chunks.json
		expect(result.index.chunks).toBeInstanceOf(Array);
		expect(result.index.chunks.length).toBeGreaterThan(0);

		// Check inverted.json
		expect(result.index.invertedIndex).toBeDefined();
		expect(typeof result.index.invertedIndex).toBe("object");

		// Verify specific files are indexed
		const filePaths = result.index.files.map((f) => f.relativePath);
		expect(filePaths).toContain("main.ts");
		expect(filePaths).toContain("README.md");
		expect(filePaths).toContain(join("src", "utils", "helpers.ts"));

		// Verify ignored directories are not indexed
		expect(filePaths).not.toContain(join("node_modules", "some-package", "index.js"));
		expect(filePaths).not.toContain(join(".git", "config"));
		expect(filePaths).not.toContain(join("dist", "bundle.js"));
		expect(filePaths).not.toContain(join("custom-ignore", "secret.txt"));
		expect(filePaths).not.toContain("temp.tmp");
	});

	it("should create embeddings.jsonl placeholder", async () => {
		await createTestRepo();

		const indexer = new RepositoryIndexer({
			repoRoot: repoDir,
			indexBaseDir,
		});

		await indexer.buildIndex();

		// embeddings.jsonl should exist (created as empty file)
		const embeddingsPath = join(indexer.getIndexDir(), "embeddings.jsonl");
		const { access } = await import("node:fs/promises");
		await expect(access(embeddingsPath)).resolves.toBeUndefined();
	});

	it("should perform lexical search", async () => {
		await createTestRepo();

		const indexer = new RepositoryIndexer({
			repoRoot: repoDir,
			indexBaseDir,
		});

		await indexer.buildIndex();

		// Search for "greeter" - should find in main.ts
		const results = await indexer.searchLexical("greeter", 10);
		expect(results.length).toBeGreaterThan(0);
		expect(results.some((r) => r.file.relativePath === "main.ts")).toBe(true);
		expect(results[0].score).toBeGreaterThan(0);

		// Search for "add" - should find in helpers.ts
		const addResults = await indexer.searchLexical("add", 10);
		expect(addResults.length).toBeGreaterThan(0);
		expect(addResults.some((r) => r.file.relativePath === join("src", "utils", "helpers.ts"))).toBe(
			true,
		);

		// Search for "test" - should find in README.md
		const testResults = await indexer.searchLexical("test", 10);
		expect(testResults.length).toBeGreaterThan(0);
		expect(testResults.some((r) => r.file.relativePath === "README.md")).toBe(true);

		// Search for non-existent token
		const noResults = await indexer.searchLexical("nonexistenttokenxyz", 10);
		expect(noResults.length).toBe(0);
	});

	it("should respect custom ignore patterns", async () => {
		await createTestRepo();

		// Add a custom ignore pattern
		await writeFile(join(repoDir, "ignore-me.ts"), `export const secret = 'hidden';`);

		const indexer = new RepositoryIndexer({
			repoRoot: repoDir,
			indexBaseDir,
			ignorePatterns: ["ignore-me.ts"],
		});

		await indexer.buildIndex();

		const filePaths = indexer.buildIndex
			? (await indexer.buildIndex()).index.files.map((f) => f.relativePath)
			: [];

		// Re-build to check
		const result = await indexer.buildIndex();
		const filePathsAfter = result.index.files.map((f) => f.relativePath);
		expect(filePathsAfter).not.toContain("ignore-me.ts");
	});

	it("should handle empty repository", async () => {
		// Create empty repo
		await mkdir(repoDir, { recursive: true });

		const indexer = new RepositoryIndexer({
			repoRoot: repoDir,
			indexBaseDir,
		});

		const result = await indexer.buildIndex();

		expect(result.index.meta.fileCount).toBe(0);
		expect(result.index.meta.chunkCount).toBe(0);
		expect(result.index.files).toHaveLength(0);
		expect(result.index.chunks).toHaveLength(0);
		expect(Object.keys(result.index.invertedIndex)).toHaveLength(0);
	});

	it("should generate deterministic repo ID", async () => {
		await createTestRepo();

		const indexer1 = new RepositoryIndexer({
			repoRoot: repoDir,
			indexBaseDir,
		});

		const indexer2 = new RepositoryIndexer({
			repoRoot: repoDir,
			indexBaseDir,
		});

		expect(indexer1.getRepoId()).toBe(indexer2.getRepoId());
	});

	it("should split large files into multiple chunks", async () => {
		// Create a file with exactly 1200 lines
		const manyLines = Array.from({ length: 1200 }, (_, i) => `const x${i} = ${i};`).join("\n");
		await writeFile(join(repoDir, "large.ts"), manyLines);

		const indexer = new RepositoryIndexer({
			repoRoot: repoDir,
			indexBaseDir,
			chunkSize: 500,
		});

		const result = await indexer.buildIndex();

		const largeFile = result.index.files.find((f) => f.relativePath === "large.ts");
		expect(largeFile).toBeDefined();
		expect(largeFile?.chunkCount).toBe(3); // 1200 lines / 500 = 3 chunks (last one has 200)

		const chunks = result.index.chunks.filter((c) => c.fileId === largeFile?.id);
		expect(chunks).toHaveLength(3);
		expect(chunks[0].startLine).toBe(1);
		expect(chunks[0].endLine).toBe(500);
		expect(chunks[1].startLine).toBe(501);
		expect(chunks[1].endLine).toBe(1000);
		expect(chunks[2].startLine).toBe(1001);
		expect(chunks[2].endLine).toBe(1200);
	});

	it("should skip binary files", async () => {
		// Create a binary file (with null bytes)
		const binaryContent = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe]);
		await writeFile(join(repoDir, "binary.bin"), binaryContent);

		// Create a text file
		await writeFile(join(repoDir, "text.txt"), "This is a text file");

		const indexer = new RepositoryIndexer({
			repoRoot: repoDir,
			indexBaseDir,
		});

		const result = await indexer.buildIndex();

		const filePaths = result.index.files.map((f) => f.relativePath);
		expect(filePaths).toContain("text.txt");
		expect(filePaths).not.toContain("binary.bin");
	});

	it("should skip files larger than maxFileSize", async () => {
		// Create a file larger than default 1MB
		const largeContent = "x".repeat(2 * 1024 * 1024); // 2 MB
		await writeFile(join(repoDir, "huge.txt"), largeContent);

		// Create a small file
		await writeFile(join(repoDir, "small.txt"), "small");

		const indexer = new RepositoryIndexer({
			repoRoot: repoDir,
			indexBaseDir,
			maxFileSize: 1024 * 1024, // 1 MB
		});

		const result = await indexer.buildIndex();

		const filePaths = result.index.files.map((f) => f.relativePath);
		expect(filePaths).toContain("small.txt");
		expect(filePaths).not.toContain("huge.txt");
	});
});
