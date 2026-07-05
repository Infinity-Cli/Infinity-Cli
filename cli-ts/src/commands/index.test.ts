import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { indexCommand } from "./index.js";

describe("index command", () => {
	let testDir: string;
	let repoDir: string;
	let indexBaseDir: string;
	let originalEnv: NodeJS.ProcessEnv;

	beforeEach(async () => {
		testDir = await mkdtemp(join(tmpdir(), "infinity-index-test-"));
		repoDir = join(testDir, "test-repo");
		indexBaseDir = join(testDir, "index");
		await mkdir(repoDir, { recursive: true });
		await mkdir(indexBaseDir, { recursive: true });

		originalEnv = { ...process.env };
		process.env.HOME = testDir;
		process.env.USERPROFILE = testDir;
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
`,
		);

		await mkdir(join(repoDir, "src"), { recursive: true });
		await writeFile(
			join(repoDir, "src", "utils.ts"),
			`export function add(a: number, b: number): number {
	return a + b;
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

	it('exports an index command named "index"', () => {
		expect(indexCommand.name()).toBe("index");
	});

	it("has the correct description", () => {
		expect(indexCommand.description()).toBe("Build a searchable index of the repository");
	});

	it("has --index-dir option with default", () => {
		const option = indexCommand.options.find((o) => o.long === "--index-dir");
		expect(option).toBeDefined();
		expect(option?.defaultValue).toContain(join(".infinity", "index"));
	});

	it("has --chunk-size option with default", () => {
		const option = indexCommand.options.find((o) => o.long === "--chunk-size");
		expect(option).toBeDefined();
		expect(option?.defaultValue).toBe("500");
	});

	it("has --embeddings flag", () => {
		const option = indexCommand.options.find((o) => o.long === "--embeddings");
		expect(option).toBeDefined();
		expect(option?.defaultValue).toBe(false);
	});

	it("has --model option with default", () => {
		const option = indexCommand.options.find((o) => o.long === "--model");
		expect(option).toBeDefined();
		expect(option?.defaultValue).toBe("nomic-embed-text");
	});

	it("builds index successfully for a test repository", async () => {
		await createTestRepo();

		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

		await indexCommand.parseAsync([repoDir], { from: "user" });

		expect(consoleErrorSpy).not.toHaveBeenCalled();
		expect(exitSpy).not.toHaveBeenCalled();
		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Index Summary"));
		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Files indexed:"));
		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Chunks created:"));
		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Index directory:"));

		consoleSpy.mockRestore();
		consoleErrorSpy.mockRestore();
		exitSpy.mockRestore();
	});

	it("uses custom index directory when provided", async () => {
		await createTestRepo();
		const customIndexDir = join(testDir, "custom-index");

		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

		await indexCommand.parseAsync([repoDir, "--index-dir", customIndexDir], { from: "user" });

		expect(consoleErrorSpy).not.toHaveBeenCalled();
		expect(exitSpy).not.toHaveBeenCalled();
		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining(customIndexDir));

		consoleSpy.mockRestore();
		consoleErrorSpy.mockRestore();
		exitSpy.mockRestore();
	});

	it("uses custom chunk size when provided", async () => {
		await createTestRepo();

		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

		await indexCommand.parseAsync([repoDir, "--chunk-size", "100"], { from: "user" });

		expect(consoleErrorSpy).not.toHaveBeenCalled();
		expect(exitSpy).not.toHaveBeenCalled();
		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Chunks created:"));

		consoleSpy.mockRestore();
		consoleErrorSpy.mockRestore();
		exitSpy.mockRestore();
	});

	it("exits with error for non-existent repository path", async () => {
		const nonExistentPath = join(testDir, "does-not-exist");

		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

		await indexCommand.parseAsync([nonExistentPath], { from: "user" });

		expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Error:"));
		expect(exitSpy).toHaveBeenCalledWith(1);

		consoleErrorSpy.mockRestore();
		exitSpy.mockRestore();
	});

	it("shows embeddings as skipped when --embeddings not used", async () => {
		await createTestRepo();

		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

		await indexCommand.parseAsync([repoDir], { from: "user" });

		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Embeddings generated:"));
		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("skipped"));

		consoleSpy.mockRestore();
		consoleErrorSpy.mockRestore();
		exitSpy.mockRestore();
	});
});
