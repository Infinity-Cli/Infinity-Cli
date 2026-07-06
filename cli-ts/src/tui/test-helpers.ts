import { PassThrough } from "node:stream";
import { type Instance, type RenderOptions, render } from "ink";
import type { ReactNode } from "react";

const ESC = String.fromCharCode(0x1b);
const ANSI_SEQUENCE = new RegExp(`${ESC}\\[[0-9;?]*[a-zA-Z]`, "g");

export function renderTui(tree: ReactNode, options: RenderOptions = {}): Instance {
	return render(tree, {
		debug: true,
		exitOnCtrlC: false,
		patchConsole: false,
		...options,
	});
}

export function stripAnsi(input: string): string {
	return input.replace(ANSI_SEQUENCE, "");
}

export function createFakeStdin(): NodeJS.ReadStream & {
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

export function createFakeStdout(): NodeJS.WriteStream & {
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

export async function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getLastFrame(stdout: ReturnType<typeof createFakeStdout>): string {
	for (let i = stdout.output.length - 1; i >= 0; i--) {
		const frame = stripAnsi(stdout.output[i] ?? "").trim();
		if (frame.length > 0) {
			return frame;
		}
	}
	return "";
}

export async function waitForOutput(
	stdout: ReturnType<typeof createFakeStdout>,
	predicate: (screen: string) => boolean,
	timeoutMs = 5000,
): Promise<string> {
	const start = Date.now();
	let screen = stdout.output.join("");
	while (!predicate(screen) && Date.now() - start < timeoutMs) {
		await delay(20);
		screen = stdout.output.join("");
	}
	return screen;
}

export async function waitForFrame(
	stdout: ReturnType<typeof createFakeStdout>,
	predicate: (frame: string) => boolean,
	timeoutMs = 5000,
): Promise<string> {
	const start = Date.now();
	let frame = getLastFrame(stdout);
	while (!predicate(frame) && Date.now() - start < timeoutMs) {
		await delay(20);
		frame = getLastFrame(stdout);
	}
	return frame;
}
