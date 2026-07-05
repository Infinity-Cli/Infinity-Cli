import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { launchInteractive, runTask } from "./launcher.js";

// Import the logo module for direct testing
import { showSplash } from "./ui/logo.js";

describe("launcher", () => {
	describe("launchInteractive", () => {
		it("is an async function that can be imported", () => {
			expect(launchInteractive).toBeInstanceOf(Function);
			expect(launchInteractive.constructor.name).toBe("AsyncFunction");
		});

		it("resolves quickly when stdin is not a TTY", async () => {
			// Mock stdin to be non-TTY
			const origIsTTY = process.stdin.isTTY;
			const origStdoutIsTTY = process.stdout.isTTY;

			// Set both to non-TTY so no animation or interactive prompt
			Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
			Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });

			// Mock console.log to avoid side effects
			const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

			// Should resolve without hanging
			await expect(launchInteractive()).resolves.toBeUndefined();

			consoleSpy.mockRestore();
			Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
			Object.defineProperty(process.stdout, "isTTY", {
				value: origStdoutIsTTY,
				configurable: true,
			});
		});
	});

	describe("runTask", () => {
		it("is an async function", () => {
			expect(runTask).toBeInstanceOf(Function);
			expect(runTask.constructor.name).toBe("AsyncFunction");
		});
	});
});

describe("showSplash", () => {
	it("is an async function", () => {
		expect(showSplash).toBeInstanceOf(Function);
		expect(showSplash.constructor.name).toBe("AsyncFunction");
	});

	it("returns immediately when stdout is not a TTY", async () => {
		const origIsTTY = process.stdout.isTTY;
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });

		await expect(showSplash()).resolves.toBeUndefined();
		expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Infinity"));

		consoleSpy.mockRestore();
		Object.defineProperty(process.stdout, "isTTY", { value: origIsTTY, configurable: true });
	});

	it("does not write ANSI sequences when stdout is not a TTY", async () => {
		const origIsTTY = process.stdout.isTTY;
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });

		await showSplash(500);

		// Should only log the plain banner, not ANSI escape sequences
		expect(consoleSpy).toHaveBeenCalledWith(expect.not.stringContaining("\x1b["));

		consoleSpy.mockRestore();
		Object.defineProperty(process.stdout, "isTTY", { value: origIsTTY, configurable: true });
	});
});
