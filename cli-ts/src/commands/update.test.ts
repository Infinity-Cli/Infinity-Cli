import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock external modules before importing the command-under-test
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
const mockSpawnSync = vi.fn();

vi.mock("node:child_process", () => ({
	execSync: vi.fn(),
	spawnSync: (...args: unknown[]) => mockSpawnSync(...args),
}));

// Override global fetch
vi.stubGlobal("fetch", mockFetch);

// ---------------------------------------------------------------------------
// Import the command after mocks are in place
// ---------------------------------------------------------------------------

import { updateCommand } from "./update.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockRelease(
	tag: string,
	body: string,
): {
	ok: boolean;
	status: number;
	json: () => Promise<{ tag_name: string; html_url: string; body: string }>;
} {
	return {
		ok: true,
		status: 200,
		json: async () => ({
			tag_name: tag,
			html_url: `https://github.com/Infinity-Cli/Infinity-Cli/releases/tag/${tag}`,
			body,
		}),
	};
}

function mockFailedResponse(
	status: number,
	statusText: string,
): {
	ok: boolean;
	status: number;
	statusText: string;
	json: () => never;
} {
	return {
		ok: false,
		status,
		statusText,
		json: () => {
			throw new Error("Not called");
		},
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("update command", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
		mockFetch.mockReset();
		mockSpawnSync.mockReset();
		process.exitCode = undefined;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		process.exitCode = undefined;
	});

	it('exports a command named "update"', () => {
		expect(updateCommand.name()).toBe("update");
	});

	it("has the correct description", () => {
		expect(updateCommand.description()).toBe("Check for updates and install the latest version");
	});

	it("has a --dry-run option", () => {
		const option = updateCommand.options.find((o) => o.long === "--dry-run");
		expect(option).toBeDefined();
	});

	it("exits 0 when already on the latest version", async () => {
		const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

		mockFetch.mockResolvedValueOnce(mockRelease("v0.1.0", ""));

		await updateCommand.parseAsync([], { from: "user" });

		expect(consoleLog).toHaveBeenCalledWith(
			expect.stringContaining("already on the latest version"),
		);
		expect(process.exitCode).toBe(0);

		consoleLog.mockRestore();
		consoleError.mockRestore();
	});

	it("exits 0 with --dry-run and prints the install command", async () => {
		const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		const originalPlatform = process.platform;
		Object.defineProperty(process, "platform", { value: "linux" });

		mockFetch.mockResolvedValueOnce(
			mockRelease("v9.9.9", "## Major release notes\n- New feature A\n- New feature B"),
		);

		await updateCommand.parseAsync(["--dry-run"], { from: "user" });

		expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining("--dry-run"));
		expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining("install.sh"));
		expect(process.exitCode).toBe(0);

		consoleLog.mockRestore();
		consoleError.mockRestore();
		Object.defineProperty(process, "platform", { value: originalPlatform });
	});

	it("uses PowerShell for win32 platform", async () => {
		const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		const originalPlatform = process.platform;
		Object.defineProperty(process, "platform", { value: "win32" });

		mockFetch.mockResolvedValueOnce(mockRelease("v9.9.9", "## Major release"));

		await updateCommand.parseAsync(["--dry-run"], { from: "user" });

		expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining("powershell.exe"));
		expect(process.exitCode).toBe(0);

		consoleLog.mockRestore();
		consoleError.mockRestore();
		Object.defineProperty(process, "platform", { value: originalPlatform });
	});

	it("handles GitHub API network failure gracefully", async () => {
		const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

		mockFetch.mockRejectedValueOnce(new Error("Network failure: ENOTFOUND"));

		await updateCommand.parseAsync([], { from: "user" });

		expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("Update failed"));
		expect(process.exitCode).toBe(1);

		consoleLog.mockRestore();
		consoleError.mockRestore();
	});

	it("handles non-OK GitHub API response", async () => {
		const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

		mockFetch.mockResolvedValueOnce(mockFailedResponse(403, "Forbidden"));

		await updateCommand.parseAsync([], { from: "user" });

		expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("Update failed"));
		expect(process.exitCode).toBe(1);

		consoleLog.mockRestore();
		consoleError.mockRestore();
	});
});
