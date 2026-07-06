import fs from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiffPanel, colorizeDiff } from "./diff-panel.js";
import { execGitDiff } from "./git-diff.js";
import {
	createFakeStdin,
	createFakeStdout,
	getLastFrame,
	renderTui,
	stripAnsi,
	waitForFrame,
	waitForOutput,
} from "./test-helpers.js";

vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return { ...actual, readFile: vi.fn(actual.readFile) };
});

vi.mock("./git-diff.js", () => ({
	execGitDiff: vi.fn(),
}));

describe("DiffPanel", () => {
	let tmpDir: string | undefined;

	afterEach(() => {
		if (tmpDir) {
			fs.rmSync(tmpDir, { recursive: true, force: true });
			tmpDir = undefined;
		}
	});

	it("renders diff content", async () => {
		const diff = `@@ -1,3 +1,3 @@
 line one
-line two
+line two updated
 line three`;
		const stdout = createFakeStdout();
		const stdin = createFakeStdin();
		const instance = renderTui(<DiffPanel diff={diff} height={10} />, { stdout, stdin });

		const screen = stripAnsi(
			await waitForOutput(stdout, (s) => stripAnsi(s).includes("@@ -1,3 +1,3 @@")),
		);
		instance.unmount();

		expect(screen).toContain("@@ -1,3 +1,3 @@");
		expect(screen).toContain("-line two");
		expect(screen).toContain("+line two updated");
	});

	it("renders selected file content", async () => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "diff-panel-test-"));
		const file = path.join(tmpDir, "sample.txt");
		fs.writeFileSync(file, "alpha\nbeta\ngamma");

		const stdout = createFakeStdout();
		const stdin = createFakeStdin();
		const instance = renderTui(<DiffPanel filePath={file} height={10} />, { stdout, stdin });

		const screen = stripAnsi(await waitForOutput(stdout, (s) => stripAnsi(s).includes("beta")));
		instance.unmount();

		expect(screen).toContain("alpha");
		expect(screen).toContain("beta");
		expect(screen).toContain("gamma");
		expect(screen).toContain(`File: ${file}`);
	});

	it("scrolls with arrow keys", async () => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "diff-panel-scroll-test-"));
		const file = path.join(tmpDir, "numbers.txt");
		const lines = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`);
		fs.writeFileSync(file, lines.join("\n"));

		const stdout = createFakeStdout();
		const stdin = createFakeStdin();
		const instance = renderTui(<DiffPanel filePath={file} height={5} />, { stdout, stdin });

		let screen = await waitForFrame(stdout, (s) => s.includes("line 1"));
		expect(screen).toContain("line 1");
		expect(screen).not.toContain("line 10");

		stdin.write("\x1b[B");
		screen = await waitForFrame(stdout, (s) => s.includes("line 2") && !s.includes("line 1"));
		expect(screen).toContain("line 2");
		expect(screen).not.toContain("line 1");

		stdin.write("\x1b[A");
		screen = await waitForFrame(stdout, (s) => s.includes("line 1") && !s.includes("line 6"));
		expect(screen).toContain("line 1");

		instance.unmount();
	});

	it("colorizeDiff returns correct colors", () => {
		const diff = "@@ -1,2 +1,2 @@\n-old\n+new\ncontext";
		const result = colorizeDiff(diff);
		expect(result).toEqual([
			{ line: "@@ -1,2 +1,2 @@", color: "yellow" },
			{ line: "-old", color: "red" },
			{ line: "+new", color: "green" },
			{ line: "context", color: "white" },
		]);
	});
});

describe("DiffPanel with mocked node:fs", () => {
	afterEach(() => {
		vi.mocked(readFile).mockRestore();
	});

	it("renders mocked file content", async () => {
		const file = "/workspace/mock.txt";
		const content = "alpha\nbeta\ngamma";
		const mockedReadFile = vi.mocked(readFile);
		mockedReadFile.mockResolvedValue(content);

		const stdout = createFakeStdout();
		const stdin = createFakeStdin();
		const instance = renderTui(<DiffPanel filePath={file} height={10} />, { stdout, stdin });

		const screen = stripAnsi(await waitForOutput(stdout, (s) => stripAnsi(s).includes("beta")));
		instance.unmount();

		expect(screen).toContain("alpha");
		expect(screen).toContain("beta");
		expect(screen).toContain("gamma");
		expect(screen).toContain(`File: ${file}`);
		expect(mockedReadFile).toHaveBeenCalledWith(file, "utf-8");
	});
});

describe("DiffPanel with mocked git output", () => {
	afterEach(() => {
		vi.mocked(execGitDiff).mockRestore();
	});

	it("renders git diff loaded for a path", async () => {
		const gitDiff = `@@ -1,3 +1,3 @@
 line one
-line two
+line two updated
 line three`;
		const mockedExecGitDiff = vi.mocked(execGitDiff);
		mockedExecGitDiff.mockResolvedValue(gitDiff);

		const stdout = createFakeStdout();
		const stdin = createFakeStdin();
		const instance = renderTui(<DiffPanel gitDiffForPath="src/foo.ts" height={10} />, {
			stdout,
			stdin,
		});

		const screen = stripAnsi(
			await waitForOutput(stdout, (s) => stripAnsi(s).includes("@@ -1,3 +1,3 @@")),
		);
		instance.unmount();

		expect(screen).toContain("Git diff: src/foo.ts");
		expect(screen).toContain("-line two");
		expect(screen).toContain("+line two updated");
		expect(mockedExecGitDiff).toHaveBeenCalledWith("src/foo.ts");
	});
});
