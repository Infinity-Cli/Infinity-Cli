import fs from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { render } from "ink";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiffPanel, colorizeDiff } from "./diff-panel.js";
import { execGitDiff } from "./git-diff.js";

vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return { ...actual, readFile: vi.fn(actual.readFile) };
});

vi.mock("./git-diff.js", () => ({
	execGitDiff: vi.fn(),
}));

function createFakeStdin(): NodeJS.ReadStream & {
	isTTY: boolean;
	isRawModeSupported: boolean;
	setRawMode: (mode: boolean) => unknown;
	ref: () => void;
	unref: () => void;
} {
	const stdin = Object.assign(new PassThrough(), {
		isTTY: true,
		isRawModeSupported: true,
		setRawMode: () => stdin,
		pause: () => stdin,
		resume: () => stdin,
		ref: () => {},
		unref: () => {},
	}) as unknown as NodeJS.ReadStream & {
		isTTY: boolean;
		isRawModeSupported: boolean;
		setRawMode: (mode: boolean) => unknown;
		ref: () => void;
		unref: () => void;
	};
	return stdin;
}

function createFakeStdout(): NodeJS.WriteStream & {
	columns: number;
	rows: number;
	isTTY: boolean;
	output: string[];
} {
	const output: string[] = [];
	const stdout = Object.assign(new PassThrough(), {
		columns: 120,
		rows: 40,
		isTTY: true,
		output,
	}) as unknown as NodeJS.WriteStream & {
		columns: number;
		rows: number;
		isTTY: boolean;
		output: string[];
	};
	(stdout as unknown as { write: NodeJS.WriteStream["write"] }).write = ((
		chunk: string | Uint8Array,
		encodingOrCb?: BufferEncoding | ((err?: Error | null) => void),
		cb?: (err?: Error | null) => void,
	) => {
		output.push(chunk.toString());
		const callback = typeof encodingOrCb === "function" ? encodingOrCb : cb;
		if (typeof callback === "function") {
			callback();
		}
		return true;
	}) as NodeJS.WriteStream["write"];
	return stdout;
}

async function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

const ESC = String.fromCharCode(0x1b);
const ANSI_SEQUENCE = new RegExp(`${ESC}\\[[0-9;?]*[a-zA-Z]`, "g");

function stripAnsi(input: string): string {
	return input.replace(ANSI_SEQUENCE, "");
}

async function waitForOutput(
	stdout: ReturnType<typeof createFakeStdout>,
	predicate: (screen: string) => boolean,
	timeoutMs = 1000,
): Promise<string> {
	const start = Date.now();
	let screen = stdout.output.join("");
	while (!predicate(screen) && Date.now() - start < timeoutMs) {
		await delay(20);
		screen = stdout.output.join("");
	}
	return screen;
}

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
		const instance = render(<DiffPanel diff={diff} height={10} />, { stdout, stdin });

		const screen = stripAnsi(await waitForOutput(stdout, (s) => s.includes("@@ -1,3 +1,3 @@")));
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
		const instance = render(<DiffPanel filePath={file} height={10} />, { stdout, stdin });

		const screen = stripAnsi(await waitForOutput(stdout, (s) => s.includes("beta")));
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
		const instance = render(<DiffPanel filePath={file} height={5} />, { stdout, stdin });

		let screen = stripAnsi(await waitForOutput(stdout, (s) => s.includes("line 1")));
		expect(screen).toContain("line 1");
		expect(screen).not.toContain("line 10");

		stdout.output.length = 0;
		stdin.write("\x1b[B");
		screen = stripAnsi(await waitForOutput(stdout, (s) => stripAnsi(s).includes("line 2")));
		expect(screen).toContain("line 2");
		expect(screen).not.toContain("line 1");

		stdout.output.length = 0;
		stdin.write("\x1b[A");
		screen = stripAnsi(await waitForOutput(stdout, (s) => stripAnsi(s).includes("line 1")));
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
		const instance = render(<DiffPanel filePath={file} height={10} />, { stdout, stdin });

		const screen = stripAnsi(await waitForOutput(stdout, (s) => s.includes("beta")));
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
		const instance = render(<DiffPanel gitDiffForPath="src/foo.ts" height={10} />, {
			stdout,
			stdin,
		});

		const screen = stripAnsi(await waitForOutput(stdout, (s) => s.includes("@@ -1,3 +1,3 @@")));
		instance.unmount();

		expect(screen).toContain("Git diff: src/foo.ts");
		expect(screen).toContain("-line two");
		expect(screen).toContain("+line two updated");
		expect(mockedExecGitDiff).toHaveBeenCalledWith("src/foo.ts");
	});
});
