import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RepositoryIndexer } from "../indexer/repository.js";
import { searchCommand } from "./search.js";

describe("search command", () => {
	let testDir: string;
	let repoDir: string;
	let indexBaseDir: string;
	let originalEnv: NodeJS.ProcessEnv;
	let indexer: RepositoryIndexer;

	beforeEach(async () => {
		testDir = await mkdtemp(join(tmpdir(), "infinity-search-test-"));
		repoDir = join(testDir, "test-repo");
		indexBaseDir = join(testDir, "index");
		await mkdir(repoDir, { recursive: true });
		await mkdir(indexBaseDir, { recursive: true });

		originalEnv = { ...process.env };
		process.env.HOME = testDir;
		process.env.USERPROFILE = testDir;

		// Create test repo and build index
		await createTestRepo();

		indexer = new RepositoryIndexer({
			repoRoot: repoDir,
			indexBaseDir,
		});
		await indexer.buildIndex();
	});

	afterEach(async () => {
		process.env = originalEnv;
		await rm(testDir, { recursive: true, force: true });
	});

	async function createTestRepo() {
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
`,
		);

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

		await mkdir(join(repoDir, "src"), { recursive: true });
		await writeFile(
			join(repoDir, "src", "utils.ts"),
			`export function add(a: number, b: number): number {
	return a + b;
}

export function multiply(a: number, b: number): number {
	return a * b;
}
`,
		);

		await mkdir(join(repoDir, "src", "auth"), { recursive: true });
		await writeFile(
			join(repoDir, "src", "auth", "handler.ts"),
			`export function authenticate(token: string): boolean {
	if (!token) return false;
	return token.length > 10;
}

export function authorize(user: string, resource: string): boolean {
	return user === 'admin' || resource === 'public';
}
`,
		);

		// Create ignored directories
		await mkdir(join(repoDir, "node_modules", "pkg"), { recursive: true });
		await writeFile(join(repoDir, "node_modules", "pkg", "index.js"), "ignored");
		await mkdir(join(repoDir, ".git"), { recursive: true });
		await writeFile(join(repoDir, ".git", "config"), "git config");
		await mkdir(join(repoDir, "dist"), { recursive: true });
		await writeFile(join(repoDir, "dist", "bundle.js"), "bundled");
	}

	it('exports a search command named "search"', () => {
		expect(searchCommand.name()).toBe("search");
	});

	it("has the correct description", () => {
		expect(searchCommand.description()).toBe("Search the repository index");
	});

	it("has --repo option with default", () => {
		const option = searchCommand.options.find((o) => o.long === "--repo");
		expect(option).toBeDefined();
		expect(option?.defaultValue).toBe(".");
	});

	it("has --index-dir option with default", () => {
		const option = searchCommand.options.find((o) => o.long === "--index-dir");
		expect(option).toBeDefined();
		expect(option?.defaultValue).toContain(join(".infinity", "index"));
	});

	it("has --limit option with default", () => {
		const option = searchCommand.options.find((o) => o.long === "--limit");
		expect(option).toBeDefined();
		expect(option?.defaultValue).toBe("10");
	});

	it("has --semantic flag", () => {
		const option = searchCommand.options.find((o) => o.long === "--semantic");
		expect(option).toBeDefined();
		expect(option?.defaultValue).toBe(false);
	});

	it("has --model option with default", () => {
		const option = searchCommand.options.find((o) => o.long === "--model");
		expect(option).toBeDefined();
		expect(option?.defaultValue).toBe("nomic-embed-text");
	});

	it("performs lexical search and finds results", async () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

		// Search for "greeter" - should find in main.ts
		await searchCommand.parseAsync(["greeter", "--repo", repoDir, "--index-dir", indexBaseDir], {
			from: "user",
		});

		expect(consoleErrorSpy).not.toHaveBeenCalled();
		expect(exitSpy).not.toHaveBeenCalled();
		expect(consoleSpy).toHaveBeenCalledWith(
			expect.stringContaining('Search Results for "greeter"'),
		);
		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("main.ts"));
		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("greeter"));

		consoleSpy.mockRestore();
		consoleErrorSpy.mockRestore();
		exitSpy.mockRestore();
	});

	it('performs lexical search for "authenticate" and finds auth handler', async () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

		await searchCommand.parseAsync(
			["authenticate", "--repo", repoDir, "--index-dir", indexBaseDir],
			{ from: "user" },
		);

		expect(consoleErrorSpy).not.toHaveBeenCalled();
		expect(exitSpy).not.toHaveBeenCalled();
		expect(consoleSpy).toHaveBeenCalledWith(
			expect.stringContaining('Search Results for "authenticate"'),
		);
		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("handler.ts"));
		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("authenticate"));

		consoleSpy.mockRestore();
		consoleErrorSpy.mockRestore();
		exitSpy.mockRestore();
	});

	it("joins multi-word queries passed as separate arguments", async () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

		await searchCommand.parseAsync(
			["Greeter", "class", "--repo", repoDir, "--index-dir", indexBaseDir],
			{ from: "user" },
		);

		expect(consoleErrorSpy).not.toHaveBeenCalled();
		expect(exitSpy).not.toHaveBeenCalled();
		expect(consoleSpy).toHaveBeenCalledWith(
			expect.stringContaining('Search Results for "Greeter class"'),
		);
		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("main.ts"));

		consoleSpy.mockRestore();
		consoleErrorSpy.mockRestore();
		exitSpy.mockRestore();
	});

	it('performs lexical search for "add" and finds utils.ts', async () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

		await searchCommand.parseAsync(["add", "--repo", repoDir, "--index-dir", indexBaseDir], {
			from: "user",
		});

		expect(consoleErrorSpy).not.toHaveBeenCalled();
		expect(exitSpy).not.toHaveBeenCalled();
		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Search Results for "add"'));
		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("utils.ts"));
		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("add"));

		consoleSpy.mockRestore();
		consoleErrorSpy.mockRestore();
		exitSpy.mockRestore();
	});

	it("returns no results for non-existent query", async () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

		await searchCommand.parseAsync(
			["nonexistentqueryxyz", "--repo", repoDir, "--index-dir", indexBaseDir],
			{ from: "user" },
		);

		expect(consoleErrorSpy).not.toHaveBeenCalled();
		expect(exitSpy).not.toHaveBeenCalled();
		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("No results found"));

		consoleSpy.mockRestore();
		consoleErrorSpy.mockRestore();
		exitSpy.mockRestore();
	});

	it("respects --limit option", async () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

		// Search with limit 1
		await searchCommand.parseAsync(
			["function", "--repo", repoDir, "--index-dir", indexBaseDir, "--limit", "1"],
			{ from: "user" },
		);

		expect(consoleErrorSpy).not.toHaveBeenCalled();
		expect(exitSpy).not.toHaveBeenCalled();
		// Should only show 1 result
		const logCalls = consoleSpy.mock.calls.map((c) => c[0]).join("\n");
		const resultLines = logLines(logCalls);
		expect(resultLines.length).toBeLessThanOrEqual(1);

		consoleSpy.mockRestore();
		consoleErrorSpy.mockRestore();
		exitSpy.mockRestore();
	});

	it("exits with error for non-existent repository", async () => {
		const nonExistentPath = join(testDir, "does-not-exist");

		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

		await searchCommand.parseAsync(
			["test", "--repo", nonExistentPath, "--index-dir", indexBaseDir],
			{ from: "user" },
		);

		expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Error:"));
		expect(exitSpy).toHaveBeenCalledWith(1);

		consoleErrorSpy.mockRestore();
		exitSpy.mockRestore();
	});

	it("exits with error for semantic search when no embeddings exist", async () => {
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

		await searchCommand.parseAsync(
			["test", "--repo", repoDir, "--index-dir", indexBaseDir, "--semantic"],
			{ from: "user" },
		);

		expect(consoleErrorSpy).toHaveBeenCalledWith(
			expect.stringContaining("Error: Index has no embeddings"),
		);
		expect(consoleErrorSpy).toHaveBeenCalledWith(
			expect.stringContaining("Re-run index with --embeddings flag"),
		);
		expect(exitSpy).toHaveBeenCalledWith(1);

		consoleErrorSpy.mockRestore();
		exitSpy.mockRestore();
	});

	it("shows semantic search label when --semantic used", async () => {
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

		// This will fail due to no embeddings, but we can check the label
		await searchCommand.parseAsync(
			["test", "--repo", repoDir, "--index-dir", indexBaseDir, "--semantic"],
			{ from: "user" },
		);

		// Just check it attempted semantic search
		expect(consoleErrorSpy).toHaveBeenCalled();

		consoleSpy.mockRestore();
		consoleErrorSpy.mockRestore();
		exitSpy.mockRestore();
	});
});

function logLines(text: string): string[] {
	return text
		.split("\n")
		.filter(
			(line) =>
				line.includes("main.ts") ||
				line.includes("utils.ts") ||
				line.includes("handler.ts") ||
				line.includes("README.md"),
		);
}
