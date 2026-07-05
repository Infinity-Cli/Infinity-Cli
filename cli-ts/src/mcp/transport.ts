import { type ChildProcess, spawn } from "node:child_process";
import process from "node:process";

export interface McpTransport {
	connect(): Promise<void> | void;
	send(message: unknown): void;
	onMessage(handler: (message: unknown) => void): void;
	close(): Promise<void> | void;
}

export interface StdioTransportOptions {
	command: string;
	args?: string[];
	env?: Record<string, string>;
	cwd?: string;
}

export class StdioTransport implements McpTransport {
	private process?: ChildProcess;
	private handler?: (message: unknown) => void;

	constructor(private options: StdioTransportOptions) {}

	async connect(): Promise<void> {
		const proc = spawn(this.options.command, this.options.args ?? [], {
			env: { ...process.env, ...this.options.env },
			cwd: this.options.cwd,
			stdio: ["pipe", "pipe", "pipe"],
		});
		this.process = proc;

		proc.stdout?.on("data", (data: Buffer) => {
			const text = data.toString("utf-8");
			const lines = text.split("\n").filter((line) => line.trim().length > 0);
			for (const line of lines) {
				try {
					const message = JSON.parse(line) as unknown;
					this.handler?.(message);
				} catch {
					// Ignore non-JSON lines such as log output.
				}
			}
		});

		proc.stderr?.on("data", () => {
			// Discard stderr by default; real servers may log there.
		});

		return new Promise((resolve, reject) => {
			proc.once("spawn", () => resolve());
			proc.once("error", (err) => reject(err));
		});
	}

	send(message: unknown): void {
		const line = `${JSON.stringify(message)}\n`;
		this.process?.stdin?.write(line);
	}

	onMessage(handler: (message: unknown) => void): void {
		this.handler = handler;
	}

	async close(): Promise<void> {
		if (this.process && !this.process.killed) {
			this.process.kill();
		}
	}
}

export class InMemoryTransport implements McpTransport {
	private handler?: (message: unknown) => void;
	private other?: InMemoryTransport;

	connect(): void {
		// No-op for the in-memory transport.
	}

	send(message: unknown): void {
		// Deliver asynchronously to avoid re-entrancy issues.
		Promise.resolve().then(() => {
			this.other?.handler?.(message);
		});
	}

	onMessage(handler: (message: unknown) => void): void {
		this.handler = handler;
	}

	close(): void {
		this.handler = undefined;
	}

	static createPair(): [InMemoryTransport, InMemoryTransport] {
		const a = new InMemoryTransport();
		const b = new InMemoryTransport();
		a.other = b;
		b.other = a;
		return [a, b];
	}
}
