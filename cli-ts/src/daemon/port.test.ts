import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { rmdir, unlink } from "node:fs/promises";
import { type Server, createServer } from "node:net";
import { dirname } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getPortFile } from "./paths.js";
import { DEFAULT_PORT, findFreePort, isPortInUse, readReservedPort, reservePort } from "./port.js";

/**
 * Helper: create a temporary server bound to a specific port.
 * Returns a promise that resolves once the server is listening.
 */
function bindTestServer(port: number): Promise<Server> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.once("listening", () => resolve(server));
		server.listen(port, "127.0.0.1");
	});
}

describe("port", () => {
	const dataDir = dirname(getPortFile());

	// Ensure the data dir exists before each test
	beforeEach(async () => {
		if (!existsSync(dataDir)) {
			mkdirSync(dataDir, { recursive: true });
		}
	});

	afterEach(async () => {
		// Clean up any port file left over
		try {
			if (existsSync(getPortFile())) {
				unlinkSync(getPortFile());
			}
		} catch {
			// ignore
		}
	});

	describe("DEFAULT_PORT", () => {
		it("should be a value well outside common ephemeral ranges", () => {
			expect(DEFAULT_PORT).toBe(17381);
			expect(Number.isInteger(DEFAULT_PORT)).toBe(true);
			expect(DEFAULT_PORT).toBeGreaterThan(0);
			expect(DEFAULT_PORT).toBeLessThan(65536);
			// 17381 is NOT in the 3000-3999, 5000-5999, 8000-8999, or 9000-9999 ranges
			// It's greater than 10000, so just verify it's well above typical ephemeral ranges
			expect(DEFAULT_PORT).toBeGreaterThan(10000);
		});
	});

	describe("isPortInUse", () => {
		it("should return false for a known-free port", async () => {
			// Use a very high ephemeral port that should be free
			const free = await isPortInUse(48901);
			expect(free).toBe(false);
		});

		it("should return true when a server is bound to the port", async () => {
			const server = await bindTestServer(48902);
			try {
				const inUse = await isPortInUse(48902);
				expect(inUse).toBe(true);
			} finally {
				server.close();
				await new Promise<void>((r) => server.once("close", r));
			}
		});
	});

	describe("findFreePort", () => {
		it("should return a port >= DEFAULT_PORT", async () => {
			const port = await findFreePort();
			expect(port).toBeGreaterThanOrEqual(DEFAULT_PORT);
			// It should be a valid port
			expect(port).toBeLessThan(65536);
		});

		it("should skip an occupied port and return the next free one", async () => {
			// Bind a server to DEFAULT_PORT so it's in use
			const server = await bindTestServer(DEFAULT_PORT);
			try {
				const freePort = await findFreePort(DEFAULT_PORT, 10);
				// Should be the first free port after DEFAULT_PORT
				expect(freePort).toBe(DEFAULT_PORT + 1);
				expect(freePort).toBeGreaterThan(DEFAULT_PORT);
			} finally {
				server.close();
				await new Promise<void>((r) => server.once("close", r));
			}
		});

		it("should reject if all ports in the range are occupied", async () => {
			// Bind a bunch of servers to a small range to force exhaustion
			const occupiedPorts: Server[] = [];
			const startPort = 48990;
			const range = 5;
			try {
				for (let i = 0; i < range; i++) {
					const server = await bindTestServer(startPort + i);
					occupiedPorts.push(server);
				}
				await expect(findFreePort(startPort, range)).rejects.toThrow("No free port found");
			} finally {
				// Clean up all bound servers
				for (const s of occupiedPorts) {
					s.close();
					await new Promise<void>((r) => s.once("close", r));
				}
			}
		}, 15000);
	});

	describe("reservePort / readReservedPort", () => {
		it("should round-trip write and read a port", async () => {
			await reservePort(17381);
			const read = await readReservedPort();
			expect(read).toBe(17381);
		});

		it("should return null when no port file exists", async () => {
			// Ensure no port file exists
			try {
				if (existsSync(getPortFile())) {
					unlinkSync(getPortFile());
				}
			} catch {
				// ignore
			}
			const result = await readReservedPort();
			expect(result).toBeNull();
		});

		it("should return null for an empty port file", async () => {
			// Write an empty file
			const { writeFile } = await import("node:fs/promises");
			await writeFile(getPortFile(), "", "utf-8");
			const result = await readReservedPort();
			expect(result).toBeNull();
		});

		it("should return null for invalid content", async () => {
			const { writeFile } = await import("node:fs/promises");
			await writeFile(getPortFile(), "not-a-number", "utf-8");
			const result = await readReservedPort();
			expect(result).toBeNull();
		});

		it("should accept a custom file path", async () => {
			const { writeFile } = await import("node:fs/promises");
			const { join } = await import("node:path");
			const { tmpdir } = await import("node:os");
			const customPath = join(tmpdir(), "infinity-cli-test-port.txt");
			try {
				await reservePort(9999, customPath);
				const result = await readReservedPort(customPath);
				expect(result).toBe(9999);
			} finally {
				try {
					await unlink(customPath);
				} catch {
					// ignore
				}
			}
		});

		it("should use getPortFile() as default path", async () => {
			// Default path should match getPortFile()
			await reservePort(17381);
			const result = await readReservedPort();
			expect(result).toBe(17381);
			expect(existsSync(getPortFile())).toBe(true);
		});
	});
});
