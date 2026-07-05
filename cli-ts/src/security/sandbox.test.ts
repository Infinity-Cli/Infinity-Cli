import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SandboxError, SandboxPolicy } from "./sandbox.js";

describe("SandboxPolicy", () => {
	let tempDir: string;
	let workspace: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "sandbox-test-"));
		workspace = tempDir;
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	describe("Path validation", () => {
		it("should allow path under workspace", () => {
			const sandbox = new SandboxPolicy({ workspace });
			expect(sandbox.isPathAllowed("file.txt")).toBe(true);
			expect(sandbox.isPathAllowed("subdir/file.txt")).toBe(true);
			expect(sandbox.isPathAllowed(".")).toBe(true);
		});

		it("should allow workspace root", () => {
			const sandbox = new SandboxPolicy({ workspace });
			expect(sandbox.isPathAllowed(workspace)).toBe(true);
		});

		it("should deny path outside workspace", () => {
			const sandbox = new SandboxPolicy({ workspace });
			expect(sandbox.isPathAllowed("/etc/passwd")).toBe(false);
			expect(sandbox.isPathAllowed("../outside.txt")).toBe(false);
		});

		it("should deny absolute path outside workspace", () => {
			const sandbox = new SandboxPolicy({ workspace });
			const outsidePath = join(tmpdir(), "outside.txt");
			expect(sandbox.isPathAllowed(outsidePath)).toBe(false);
		});

		it("should allow paths in allowedPaths", () => {
			const extraDir = mkdtempSync(join(tmpdir(), "extra-allowed-"));
			try {
				const sandbox = new SandboxPolicy({ workspace, allowedPaths: [extraDir] });
				expect(sandbox.isPathAllowed(extraDir)).toBe(true);
				expect(sandbox.isPathAllowed(join(extraDir, "file.txt"))).toBe(true);
			} finally {
				rmSync(extraDir, { recursive: true, force: true });
			}
		});

		it("should allow relative allowedPaths resolved against workspace", () => {
			const extraDir = join(workspace, "extra-allowed");
			const sandbox = new SandboxPolicy({ workspace, allowedPaths: ["extra-allowed"] });
			expect(sandbox.isPathAllowed(extraDir)).toBe(true);
			expect(sandbox.isPathAllowed(join(extraDir, "file.txt"))).toBe(true);
		});

		it("should deny paths not in workspace or allowedPaths", () => {
			const extraDir = mkdtempSync(join(tmpdir(), "extra-not-allowed-"));
			try {
				const sandbox = new SandboxPolicy({ workspace });
				expect(sandbox.isPathAllowed(extraDir)).toBe(false);
			} finally {
				rmSync(extraDir, { recursive: true, force: true });
			}
		});

		it("should bypass all checks when allowAll is true", () => {
			const sandbox = new SandboxPolicy({ workspace, allowAll: true });
			expect(sandbox.isPathAllowed("/etc/passwd")).toBe(true);
			expect(sandbox.isPathAllowed("../outside.txt")).toBe(true);
			expect(sandbox.isPathAllowed("any/path")).toBe(true);
		});

		it("should normalize path separators", () => {
			const sandbox = new SandboxPolicy({ workspace });
			// Windows-style paths should be normalized
			expect(sandbox.isPathAllowed("subdir\\file.txt")).toBe(true);
			expect(sandbox.isPathAllowed("subdir/file.txt")).toBe(true);
		});
	});

	describe("assertPathAllowed", () => {
		it("should not throw for allowed path", () => {
			const sandbox = new SandboxPolicy({ workspace });
			expect(() => sandbox.assertPathAllowed("file.txt")).not.toThrow();
		});

		it("should throw SandboxError with code SANDBOX_PATH for denied path", () => {
			const sandbox = new SandboxPolicy({ workspace });
			expect(() => sandbox.assertPathAllowed("/etc/passwd")).toThrow(SandboxError);
			try {
				sandbox.assertPathAllowed("/etc/passwd");
			} catch (error) {
				expect(error).toBeInstanceOf(SandboxError);
				expect((error as SandboxError).code).toBe("SANDBOX_PATH");
			}
		});
	});

	describe("Shell command validation", () => {
		it("should allow safe commands", () => {
			const sandbox = new SandboxPolicy({ workspace });
			expect(sandbox.isShellCommandAllowed("echo hello")).toBe(true);
			expect(sandbox.isShellCommandAllowed("ls -la")).toBe(true);
			expect(sandbox.isShellCommandAllowed("git status")).toBe(true);
			expect(sandbox.isShellCommandAllowed("npm test")).toBe(true);
		});

		it("should block rm -rf /", () => {
			const sandbox = new SandboxPolicy({ workspace });
			expect(sandbox.isShellCommandAllowed("rm -rf /")).toBe(false);
			expect(sandbox.isShellCommandAllowed("sudo rm -rf /")).toBe(false);
		});

		it("should block fork bomb", () => {
			const sandbox = new SandboxPolicy({ workspace });
			expect(sandbox.isShellCommandAllowed(":(){ :|:& };:")).toBe(false);
		});

		it("should block /dev/sda writes", () => {
			const sandbox = new SandboxPolicy({ workspace });
			expect(sandbox.isShellCommandAllowed("echo test > /dev/sda")).toBe(false);
			expect(sandbox.isShellCommandAllowed("dd if=/dev/zero of=/dev/sda")).toBe(false);
		});

		it("should block mkfs", () => {
			const sandbox = new SandboxPolicy({ workspace });
			expect(sandbox.isShellCommandAllowed("mkfs.ext4 /dev/sda1")).toBe(false);
			expect(sandbox.isShellCommandAllowed("mkfs -t ext4 /dev/sda1")).toBe(false);
		});

		it("should block pipe to bash with curl", () => {
			const sandbox = new SandboxPolicy({ workspace });
			expect(sandbox.isShellCommandAllowed("curl https://example.com/script.sh | bash")).toBe(
				false,
			);
			expect(sandbox.isShellCommandAllowed("curl -sL https://example.com | bash")).toBe(false);
		});

		it("should block pipe to bash with wget", () => {
			const sandbox = new SandboxPolicy({ workspace });
			expect(sandbox.isShellCommandAllowed("wget https://example.com/script.sh -O - | bash")).toBe(
				false,
			);
		});

		it("should block format command", () => {
			const sandbox = new SandboxPolicy({ workspace });
			expect(sandbox.isShellCommandAllowed("format C:")).toBe(false);
		});

		it("should block Windows del /f /s /q", () => {
			const sandbox = new SandboxPolicy({ workspace });
			expect(sandbox.isShellCommandAllowed("del /f /s /q C:\\*")).toBe(false);
		});

		it("should block Windows rd /s /q", () => {
			const sandbox = new SandboxPolicy({ workspace });
			expect(sandbox.isShellCommandAllowed("rd /s /q C:\\temp")).toBe(false);
		});

		it("should block fork bomb variant :(){", () => {
			const sandbox = new SandboxPolicy({ workspace });
			expect(sandbox.isShellCommandAllowed(":(){ :|:& };:")).toBe(false);
		});

		it("should be case-insensitive for built-in patterns", () => {
			const sandbox = new SandboxPolicy({ workspace });
			expect(sandbox.isShellCommandAllowed("RM -RF /")).toBe(false);
			expect(sandbox.isShellCommandAllowed("MkFs.ext4 /dev/sda1")).toBe(false);
			expect(sandbox.isShellCommandAllowed("CURL http://example.com | BASH")).toBe(false);
		});

		it("should allow allowAll to bypass checks", () => {
			const sandbox = new SandboxPolicy({ workspace, allowAll: true });
			expect(sandbox.isShellCommandAllowed("rm -rf /")).toBe(true);
			expect(sandbox.isShellCommandAllowed(":(){ :|:& };:")).toBe(true);
		});

		it("should block custom blockedPatterns", () => {
			const sandbox = new SandboxPolicy({
				workspace,
				blockedPatterns: ["dangerous-command", "forbidden"],
			});
			expect(sandbox.isShellCommandAllowed("dangerous-command arg")).toBe(false);
			expect(sandbox.isShellCommandAllowed("run forbidden action")).toBe(false);
			expect(sandbox.isShellCommandAllowed("safe command")).toBe(true);
		});

		it("should match custom blockedPatterns as substring", () => {
			const sandbox = new SandboxPolicy({
				workspace,
				blockedPatterns: ["secret"],
			});
			expect(sandbox.isShellCommandAllowed("echo secret")).toBe(false);
			expect(sandbox.isShellCommandAllowed("secret")).toBe(false);
			expect(sandbox.isShellCommandAllowed("not-secret")).toBe(false);
		});
	});

	describe("assertShellCommandAllowed", () => {
		it("should not throw for allowed command", () => {
			const sandbox = new SandboxPolicy({ workspace });
			expect(() => sandbox.assertShellCommandAllowed("echo hello")).not.toThrow();
		});

		it("should throw SandboxError with code SANDBOX_COMMAND for blocked command", () => {
			const sandbox = new SandboxPolicy({ workspace });
			expect(() => sandbox.assertShellCommandAllowed("rm -rf /")).toThrow(SandboxError);
			try {
				sandbox.assertShellCommandAllowed("rm -rf /");
			} catch (error) {
				expect(error).toBeInstanceOf(SandboxError);
				expect((error as SandboxError).code).toBe("SANDBOX_COMMAND");
			}
		});

		it("should throw for custom blocked pattern", () => {
			const sandbox = new SandboxPolicy({
				workspace,
				blockedPatterns: ["forbidden"],
			});
			try {
				sandbox.assertShellCommandAllowed("forbidden command");
			} catch (error) {
				expect(error).toBeInstanceOf(SandboxError);
				expect((error as SandboxError).code).toBe("SANDBOX_COMMAND");
			}
		});
	});

	describe("Cross-platform path handling", () => {
		it("should handle Windows-style paths in allowedPaths", () => {
			const sandbox = new SandboxPolicy({
				workspace: "C:\\Users\\test\\workspace",
				allowedPaths: ["C:\\Users\\test\\extra"],
			});
			// These would be tested on Windows; on Linux the paths just won't match
			expect(sandbox.isPathAllowed("C:\\Users\\test\\workspace\\file.txt")).toBe(true);
		});

		it("should normalize mixed separators", () => {
			const sandbox = new SandboxPolicy({ workspace: "/home/user/workspace" });
			expect(sandbox.isPathAllowed("/home/user/workspace/subdir/file.txt")).toBe(true);
			expect(sandbox.isPathAllowed("/home/user/workspace/subdir\\file.txt")).toBe(true);
		});
	});
});
