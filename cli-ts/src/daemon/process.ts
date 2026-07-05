import { type ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getDataDir, getLogDir, getPidFile, getPortFile } from "./paths.js";

export interface RuntimeProcessOptions {
	/** The command to run (e.g. "python"). */
	command: string;
	/** Arguments passed to the command. */
	args: string[];
	/** Working directory for the spawned process. */
	cwd?: string;
	/** Environment variables. */
	env?: Record<string, string>;
	/** Maximum number of auto-restart attempts (default 5). */
	maxRestarts?: number;
	/** Base delay in ms for exponential backoff (default 1000). */
	restartBaseDelayMs?: number;
	/** Maximum delay in ms for exponential backoff (default 30000). */
	restartMaxDelayMs?: number;
}

export interface RuntimeProcessState {
	pid: number | null;
	startTime: number | null;
	exitCode: number | null;
	running: boolean;
	restartCount: number;
}

const DEFAULTS: Required<RuntimeProcessOptions> = {
	command: "python",
	args: ["-m", "inf.server.server"],
	cwd: process.cwd(),
	env: process.env as Record<string, string>,
	maxRestarts: 5,
	restartBaseDelayMs: 1000,
	restartMaxDelayMs: 30000,
};

export class RuntimeProcess extends EventEmitter {
	private child: ChildProcess | null = null;
	private state: RuntimeProcessState = {
		pid: null,
		startTime: null,
		exitCode: null,
		running: false,
		restartCount: 0,
	};
	private opts: Required<RuntimeProcessOptions>;
	private manuallyStopped = false;
	private restartTimer: ReturnType<typeof setTimeout> | null = null;
	private stdoutBuffer: string[] = [];
	private stderrBuffer: string[] = [];

	constructor(opts: Partial<RuntimeProcessOptions> = {}) {
		super();
		this.opts = { ...DEFAULTS, ...opts };
	}

	/** Start the process. If already running, returns immediately. */
	start(): void {
		if (this.state.running) return;
		this.manuallyStopped = false;
		this.spawnProcess();
	}

	/** Stop the process gracefully. On Unix sends SIGTERM; on Windows calls child.kill(). */
	stop(signal: NodeJS.Signals | number = "SIGTERM"): void {
		this.manuallyStopped = true;
		if (this.restartTimer) {
			clearTimeout(this.restartTimer);
			this.restartTimer = null;
		}

		if (!this.child) return;

		if (process.platform === "win32") {
			this.child.kill();
		} else {
			this.child.kill(signal);
		}

		this.state.running = false;
	}

	/** Restart the process (stop then start). */
	async restart(): Promise<void> {
		this.stop();
		// Small delay to let the process fully terminate
		await new Promise((r) => setTimeout(r, 100));
		this.start();
	}

	/** Whether the process is currently running. */
	isRunning(): boolean {
		return this.state.running;
	}

	/** Return a snapshot of the current state. */
	getState(): RuntimeProcessState {
		return { ...this.state };
	}

	/** Return collected stdout lines. */
	getStdout(): string[] {
		return [...this.stdoutBuffer];
	}

	/** Return collected stderr lines. */
	getStderr(): string[] {
		return [...this.stderrBuffer];
	}

	/** Clear buffered output. */
	clearBuffers(): void {
		this.stdoutBuffer = [];
		this.stderrBuffer = [];
	}

	private spawnProcess(): void {
		if (this.restartTimer) {
			clearTimeout(this.restartTimer);
			this.restartTimer = null;
		}

		const child = spawn(this.opts.command, this.opts.args, {
			cwd: this.opts.cwd,
			env: this.opts.env,
			stdio: ["ignore", "pipe", "pipe"],
		});

		this.child = child;
		this.state.pid = child.pid ?? null;
		this.state.startTime = Date.now();
		this.state.running = true;
		this.state.exitCode = null;

		// Write PID file
		this.writeStateFiles();

		child.stdout?.on("data", (data: Buffer) => {
			const lines = data.toString().split("\n").filter(Boolean);
			this.stdoutBuffer.push(...lines);
			this.emit("stdout", lines);
		});

		child.stderr?.on("data", (data: Buffer) => {
			const lines = data.toString().split("\n").filter(Boolean);
			this.stderrBuffer.push(...lines);
			this.emit("stderr", lines);
		});

		child.on("error", (err: Error) => {
			this.emit("error", err);
			this.state.running = false;
			const errnoCode = (err as NodeJS.ErrnoException).code;
			const numericCode = typeof errnoCode === "string" ? Number(errnoCode) : (errnoCode ?? 1);
			this.handleExit(numericCode);
		});

		child.on("exit", (code: number | null, signal: string | null) => {
			this.state.exitCode = code ?? null;
			this.state.running = false;
			this.state.pid = null;
			this.child = null;

			this.emit("exit", code, signal);

			if (!this.manuallyStopped) {
				this.handleExit(code ?? 1);
			}
		});
	}

	private handleExit(exitCode: number | null | undefined): void {
		if (this.manuallyStopped) return;
		if (this.state.restartCount >= this.opts.maxRestarts) {
			this.emit("maxRestartsReached", exitCode);
			return;
		}

		this.state.restartCount++;
		const delay = this.calculateBackoffDelay();

		this.emit("willRestart", { attempt: this.state.restartCount, delay, exitCode });

		this.restartTimer = setTimeout(() => {
			this.spawnProcess();
		}, delay);
	}

	/** Exponential backoff: base * 2^attempt, capped at maxDelay. */
	private calculateBackoffDelay(): number {
		const delay = this.opts.restartBaseDelayMs * 2 ** (this.state.restartCount - 1);
		return Math.min(delay, this.opts.restartMaxDelayMs);
	}

	private writeStateFiles(): void {
		const dataDir = getDataDir();
		if (!existsSync(dataDir)) {
			mkdirSync(dataDir, { recursive: true });
		}

		const logDir = getLogDir();
		if (!existsSync(logDir)) {
			mkdirSync(logDir, { recursive: true });
		}

		if (this.state.pid) {
			writeFileSync(getPidFile(), String(this.state.pid), "utf-8");
		}
		if (this.state.startTime) {
			writeFileSync(getPortFile(), String(this.state.startTime), "utf-8");
		}
	}
}
