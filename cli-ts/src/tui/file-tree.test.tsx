import fs from "node:fs";
import { readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { render } from "ink";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileTree, buildFileTree } from "./file-tree.js";

vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return { ...actual, readdir: vi.fn(actual.readdir) };
});

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
	timeoutMs = 3000,
): Promise<string> {
	const start = Date.now();
	let screen = stdout.output.join("");
	while (!predicate(screen) && Date.now() - start < timeoutMs) {
		await delay(20);
		screen = stdout.output.join("");
	}
	return screen;
}

describe("FileTree", () => {
	let tmpDir: string;

	afterEach(() => {
		if (tmpDir) {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("renders file tree", async () => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "file-tree-test-"));
		fs.mkdirSync(path.join(tmpDir, "src"));
		fs.writeFileSync(path.join(tmpDir, "readme.md"), "# readme");
		fs.writeFileSync(path.join(tmpDir, "src", "index.ts"), "export {};");

		const stdout = createFakeStdout();
		const stdin = createFakeStdin();
		const instance = render(
			<FileTree cwd={tmpDir} onSelect={() => {}} initialExpandedIds={[path.join(tmpDir, "src")]} />,
			{
				stdout,
				stdin,
			},
		);

		const screen = await waitForOutput(
			stdout,
			(s) => s.includes("readme.md") && s.includes("src") && s.includes("index.ts"),
			3000,
		);
		expect(screen).toContain("readme.md");
		expect(screen).toContain("src");
		expect(screen).toContain("index.ts");

		instance.unmount();
	});

	it("navigates with arrow keys", async () => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "file-tree-nav-test-"));
		fs.mkdirSync(path.join(tmpDir, "alpha"));
		fs.mkdirSync(path.join(tmpDir, "beta"));
		fs.writeFileSync(path.join(tmpDir, "root.txt"), "root");
		fs.writeFileSync(path.join(tmpDir, "alpha", "a.txt"), "a");
		fs.writeFileSync(path.join(tmpDir, "beta", "b.txt"), "b");

		const stdout = createFakeStdout();
		const stdin = createFakeStdin();
		const instance = render(<FileTree cwd={tmpDir} onSelect={() => {}} />, {
			stdout,
			stdin,
		});

		let screen = stripAnsi(await waitForOutput(stdout, (s) => stripAnsi(s).includes("> 📁 alpha")));
		expect(screen).toContain("> 📁 alpha");

		stdout.output.length = 0;
		stdin.write("\x1b[B");
		screen = stripAnsi(await waitForOutput(stdout, (s) => stripAnsi(s).includes("> 📁 beta")));
		expect(screen).toContain("> 📁 beta");

		stdout.output.length = 0;
		stdin.write("\x1b[B");
		screen = stripAnsi(await waitForOutput(stdout, (s) => stripAnsi(s).includes("> 📄 root.txt")));
		expect(screen).toContain("> 📄 root.txt");

		stdout.output.length = 0;
		stdin.write("\x1b[A");
		screen = stripAnsi(
			await waitForOutput(
				stdout,
				(s) => stripAnsi(s).includes("> 📁 beta") && !stripAnsi(s).includes("> 📄 root.txt"),
			),
		);
		expect(screen).toContain("> 📁 beta");
		expect(screen).not.toContain("> 📄 root.txt");

		instance.unmount();
	});

	it("buildFileTree returns sorted directories and files", async () => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "file-tree-build-test-"));
		fs.mkdirSync(path.join(tmpDir, "z-dir"));
		fs.mkdirSync(path.join(tmpDir, "a-dir"));
		fs.writeFileSync(path.join(tmpDir, "z-file.txt"), "z");
		fs.writeFileSync(path.join(tmpDir, "a-file.txt"), "a");

		const tree = await buildFileTree(tmpDir);
		const names = tree.map((node) => node.name);
		expect(names).toEqual(["a-dir", "z-dir", "a-file.txt", "z-file.txt"]);
		expect(tree[0]?.isDirectory).toBe(true);
		expect(tree[2]?.isDirectory).toBe(false);
	});
});

describe("buildFileTree with mocked node:fs", () => {
	afterEach(() => {
		vi.mocked(readdir).mockRestore();
	});

	it("returns expected tree without touching the real filesystem", async () => {
		const cwd = path.join("workspace");
		const srcDir = path.join(cwd, "src");
		const indexPath = path.join(srcDir, "index.ts");
		const readmePath = path.join(cwd, "readme.md");

		const treeMap = new Map<string, { name: string; isDirectory: boolean }[]>([
			[
				cwd,
				[
					{ name: "src", isDirectory: true },
					{ name: "readme.md", isDirectory: false },
				],
			],
			[srcDir, [{ name: "index.ts", isDirectory: false }]],
		]);

		const mockedReaddir = vi.mocked(readdir);
		mockedReaddir.mockImplementation(async (dirPath) => {
			const key = typeof dirPath === "string" ? dirPath : dirPath.toString();
			const entries = treeMap.get(key) ?? [];
			return entries.map((entry) => ({
				name: entry.name,
				isDirectory: () => entry.isDirectory,
			})) as unknown as Awaited<ReturnType<typeof readdir>>;
		});

		const tree = await buildFileTree(cwd);

		expect(tree).toHaveLength(2);
		expect(tree[0]).toMatchObject({
			id: srcDir,
			name: "src",
			fullPath: srcDir,
			isDirectory: true,
			indent: 0,
		});
		expect(tree[0]?.children).toEqual([
			{
				id: indexPath,
				name: "index.ts",
				fullPath: indexPath,
				isDirectory: false,
				indent: 1,
				children: [],
			},
		]);
		expect(tree[1]).toMatchObject({
			id: readmePath,
			name: "readme.md",
			fullPath: readmePath,
			isDirectory: false,
			indent: 0,
		});
		expect(mockedReaddir).toHaveBeenCalledWith(cwd, { withFileTypes: true });
		expect(mockedReaddir).toHaveBeenCalledWith(srcDir, { withFileTypes: true });
	});
});
