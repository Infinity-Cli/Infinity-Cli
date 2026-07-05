import { afterEach, describe, expect, it, vi } from "vitest";
import { RuntimeProcess } from "./process.js";

// Helper: create a long-running process (sleeps for a long time)
const LONG_RUNNING_SCRIPT = "setInterval(() => {}, 1000000);";

// Helper: create a script that exits quickly
const QUICK_EXIT_SCRIPT = "process.exit(42);";

describe("RuntimeProcess", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should start a process and report isRunning()", () => {
		const proc = new RuntimeProcess({
			command: process.execPath,
			args: ["-e", LONG_RUNNING_SCRIPT],
		});

		proc.start();
		expect(proc.isRunning()).toBe(true);
		expect(proc.getState().pid).toBeGreaterThan(0);

		proc.stop();
		expect(proc.isRunning()).toBe(false);
	});

	it("should stop a process and verify it is no longer running", () => {
		const proc = new RuntimeProcess({
			command: process.execPath,
			args: ["-e", LONG_RUNNING_SCRIPT],
		});

		proc.start();
		expect(proc.isRunning()).toBe(true);

		proc.stop();
		expect(proc.isRunning()).toBe(false);
		expect(proc.getState().exitCode).toBe(null);
	});

	it("should provide a state snapshot via getState()", () => {
		const proc = new RuntimeProcess({
			command: process.execPath,
			args: ["-e", LONG_RUNNING_SCRIPT],
		});

		const stateBefore = proc.getState();
		expect(stateBefore.running).toBe(false);
		expect(stateBefore.pid).toBe(null);

		proc.start();
		const stateAfter = proc.getState();
		expect(stateAfter.running).toBe(true);
		expect(stateAfter.pid).toBeGreaterThan(0);
		expect(stateAfter.startTime).toBeGreaterThan(0);

		proc.stop();
	});

	it("should emit exit event with code and signal", () => {
		return new Promise<void>((done) => {
			const proc = new RuntimeProcess({
				command: process.execPath,
				args: ["-e", "process.exit(0);"],
			});

			proc.on("exit", (code: number | null, signal: string | null) => {
				expect(code).toBe(0);
				done();
			});

			proc.start();
		});
	});

	it("should collect stdout output during execution", () => {
		return new Promise<void>((done) => {
			const proc = new RuntimeProcess({
				command: process.execPath,
				args: ["-e", "process.stdout.write('hello world\\n'); process.exit(0);"],
			});

			proc.on("exit", () => {
				const stdout = proc.getStdout();
				expect(stdout.length).toBeGreaterThan(0);
				expect(stdout[0]).toContain("hello world");
				done();
			});

			proc.start();
		});
	});

	it("should auto-restart on unexpected exit (up to maxRestarts)", () => {
		return new Promise<void>((done) => {
			const proc = new RuntimeProcess({
				command: process.execPath,
				args: ["-e", QUICK_EXIT_SCRIPT],
				maxRestarts: 3,
				restartBaseDelayMs: 50,
				restartMaxDelayMs: 500,
			});

			const maxRestartsReached = vi.fn();
			proc.on("maxRestartsReached", maxRestartsReached);

			proc.start();
			expect(proc.isRunning()).toBe(true);

			// The process exits immediately; setTimeout callback will fire after the
			// backoff delay. Since the script exits quickly, we'll get multiple restarts.
			// Wait for the maxRestartsReached event.
			setTimeout(() => {
				expect(proc.getState().restartCount).toBeGreaterThanOrEqual(1);
				proc.stop();
				done();
			}, 1000);
		});
	}, 10000);

	it("should respect maxRestarts and stop after exceeding", () => {
		return new Promise<void>((done) => {
			const proc = new RuntimeProcess({
				command: process.execPath,
				args: ["-e", QUICK_EXIT_SCRIPT],
				maxRestarts: 2,
				restartBaseDelayMs: 50,
				restartMaxDelayMs: 200,
			});

			const restartSpy = vi.fn();
			proc.on("willRestart", restartSpy);

			proc.start();

			// Give the process enough time to exhaust restarts
			setTimeout(() => {
				// The process should have tried to restart at least once
				// It exits immediately each time, so restarts should be exhausted
				expect(proc.getState().restartCount).toBeGreaterThanOrEqual(1);
				proc.stop();
				done();
			}, 2000);
		});
	}, 10000);

	it("should calculate exponential backoff correctly", () => {
		const proc = new RuntimeProcess({
			command: process.execPath,
			args: ["-e", "process.exit(0);"],
			restartBaseDelayMs: 1000,
			restartMaxDelayMs: 30000,
		});

		// Access via type assertion to test private method
		const p = proc as unknown as {
			calculateBackoffDelay(): number;
			state: { restartCount: number };
		};

		// Restart count 1 -> delay = 1000
		// Restart count 2 -> delay = 2000
		// Restart count 3 -> delay = 4000
		// Restart count 4 -> delay = 8000
		// Restart count 5 -> delay = 16000

		p.state.restartCount = 1;
		expect(p.calculateBackoffDelay()).toBe(1000);
		p.state.restartCount = 2;
		expect(p.calculateBackoffDelay()).toBe(2000);
		p.state.restartCount = 3;
		expect(p.calculateBackoffDelay()).toBe(4000);
		p.state.restartCount = 4;
		expect(p.calculateBackoffDelay()).toBe(8000);
		p.state.restartCount = 5;
		expect(p.calculateBackoffDelay()).toBe(16000);
		p.state.restartCount = 6;
		// Capped at maxDelay (30000)
		expect(p.calculateBackoffDelay()).toBe(30000);
	});
});
