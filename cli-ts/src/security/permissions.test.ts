import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionError, PermissionManager } from "./permissions.js";
import type { PermissionRequest, PermissionRule } from "./types.js";

describe("PermissionManager", () => {
	let manager: PermissionManager;
	let mockPromptFn: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		mockPromptFn = vi.fn();
		manager = new PermissionManager({ promptFn: mockPromptFn });
	});

	describe("allow rule permits destructive file delete", () => {
		it("should allow destructive delete when rule matches", async () => {
			const rules: PermissionRule[] = [
				{ tool: "file", operation: "delete", destructive: true, decision: "allow" },
			];
			manager.loadRules(rules);

			const request: PermissionRequest = {
				tool: "file",
				operation: "delete",
				description: "Delete a file",
				path: "/tmp/test.txt",
				destructive: true,
			};

			const decision = await manager.requestPermission(request);
			expect(decision.allowed).toBe(true);
		});
	});

	describe("deny rule rejects destructive operation", () => {
		it("should deny when deny rule matches", async () => {
			const rules: PermissionRule[] = [
				{ tool: "file", operation: "delete", destructive: true, decision: "deny" },
			];
			manager.loadRules(rules);

			const request: PermissionRequest = {
				tool: "file",
				operation: "delete",
				description: "Delete a file",
				path: "/tmp/test.txt",
				destructive: true,
			};

			const decision = await manager.requestPermission(request);
			expect(decision.allowed).toBe(false);
			expect(decision.reason).toContain("Denied by rule");
		});
	});

	describe("prompt rule calls promptFn and returns its result", () => {
		it("should call promptFn and return true when promptFn returns true", async () => {
			mockPromptFn.mockResolvedValue(true);
			const rules: PermissionRule[] = [
				{ tool: "shell", operation: "exec", destructive: true, decision: "prompt" },
			];
			manager.loadRules(rules);

			const request: PermissionRequest = {
				tool: "shell",
				operation: "exec",
				description: "Run a command",
				destructive: true,
			};

			const decision = await manager.requestPermission(request);
			expect(mockPromptFn).toHaveBeenCalledWith(request);
			expect(decision.allowed).toBe(true);
		});

		it("should call promptFn and return false when promptFn returns false", async () => {
			mockPromptFn.mockResolvedValue(false);
			const rules: PermissionRule[] = [
				{ tool: "shell", operation: "exec", destructive: true, decision: "prompt" },
			];
			manager.loadRules(rules);

			const request: PermissionRequest = {
				tool: "shell",
				operation: "exec",
				description: "Run a command",
				destructive: true,
			};

			const decision = await manager.requestPermission(request);
			expect(mockPromptFn).toHaveBeenCalledWith(request);
			expect(decision.allowed).toBe(false);
			expect(decision.reason).toBe("User denied permission");
		});
	});

	describe("no matching rules uses defaultDecision", () => {
		it("should deny by default when no rules match", async () => {
			manager = new PermissionManager({ defaultDecision: "deny" });

			const request: PermissionRequest = {
				tool: "unknown",
				operation: "operation",
				description: "Unknown operation",
				destructive: false,
			};

			const decision = await manager.requestPermission(request);
			expect(decision.allowed).toBe(false);
			expect(decision.reason).toBe("No matching rule, default deny");
		});

		it("should allow by default when defaultDecision is allow", async () => {
			manager = new PermissionManager({ defaultDecision: "allow" });

			const request: PermissionRequest = {
				tool: "unknown",
				operation: "operation",
				description: "Unknown operation",
				destructive: false,
			};

			const decision = await manager.requestPermission(request);
			expect(decision.allowed).toBe(true);
		});

		it("should deny when defaultDecision is prompt but no promptFn", async () => {
			manager = new PermissionManager({ defaultDecision: "prompt" });

			const request: PermissionRequest = {
				tool: "unknown",
				operation: "operation",
				description: "Unknown operation",
				destructive: false,
			};

			const decision = await manager.requestPermission(request);
			expect(decision.allowed).toBe(false);
			expect(decision.reason).toBe("Prompt required but no prompt function available");
		});
	});

	describe("pathPattern matching with * and **", () => {
		it("should match * for single path segment", async () => {
			const rules: PermissionRule[] = [{ tool: "file", pathPattern: "/tmp/*", decision: "allow" }];
			manager.loadRules(rules);

			const request: PermissionRequest = {
				tool: "file",
				operation: "read",
				description: "Read a file",
				path: "/tmp/test.txt",
				destructive: false,
			};

			const decision = await manager.requestPermission(request);
			expect(decision.allowed).toBe(true);
		});

		it("should not match * across path separators", async () => {
			const rules: PermissionRule[] = [{ tool: "file", pathPattern: "/tmp/*", decision: "allow" }];
			manager.loadRules(rules);

			const request: PermissionRequest = {
				tool: "file",
				operation: "read",
				description: "Read a file",
				path: "/tmp/subdir/test.txt",
				destructive: false,
			};

			const decision = await manager.requestPermission(request);
			expect(decision.allowed).toBe(false);
		});

		it("should match ** for multiple path segments", async () => {
			const rules: PermissionRule[] = [
				{ tool: "file", pathPattern: "/home/**", decision: "allow" },
			];
			manager.loadRules(rules);

			const request: PermissionRequest = {
				tool: "file",
				operation: "read",
				description: "Read a file",
				path: "/home/user/projects/file.txt",
				destructive: false,
			};

			const decision = await manager.requestPermission(request);
			expect(decision.allowed).toBe(true);
		});

		it("should match ** for exact path", async () => {
			const rules: PermissionRule[] = [
				{ tool: "file", pathPattern: "/home/**", decision: "allow" },
			];
			manager.loadRules(rules);

			const request: PermissionRequest = {
				tool: "file",
				operation: "read",
				description: "Read a file",
				path: "/home/user",
				destructive: false,
			};

			const decision = await manager.requestPermission(request);
			expect(decision.allowed).toBe(true);
		});

		it("should handle Windows-style paths with backslashes", async () => {
			const rules: PermissionRule[] = [
				{ tool: "file", pathPattern: "C:/Users/**", decision: "allow" },
			];
			manager.loadRules(rules);

			const request: PermissionRequest = {
				tool: "file",
				operation: "read",
				description: "Read a file",
				path: "C:\\Users\\test\\file.txt",
				destructive: false,
			};

			const decision = await manager.requestPermission(request);
			expect(decision.allowed).toBe(true);
		});
	});

	describe("PermissionError thrown by withPermission", () => {
		it("should throw PermissionError when permission denied", async () => {
			const rules: PermissionRule[] = [{ tool: "file", operation: "delete", decision: "deny" }];
			manager.loadRules(rules);

			const request: PermissionRequest = {
				tool: "file",
				operation: "delete",
				description: "Delete a file",
				path: "/tmp/test.txt",
				destructive: true,
			};

			await expect(manager.withPermission(request, async () => "result")).rejects.toThrow(
				PermissionError,
			);
		});

		it("should include request in PermissionError", async () => {
			const rules: PermissionRule[] = [{ tool: "file", operation: "delete", decision: "deny" }];
			manager.loadRules(rules);

			const request: PermissionRequest = {
				tool: "file",
				operation: "delete",
				description: "Delete a file",
				path: "/tmp/test.txt",
				destructive: true,
			};

			try {
				await manager.withPermission(request, async () => "result");
			} catch (error) {
				expect(error).toBeInstanceOf(PermissionError);
				expect((error as PermissionError).request).toEqual(request);
			}
		});

		it("should return fn result when permission allowed", async () => {
			const rules: PermissionRule[] = [{ tool: "file", operation: "read", decision: "allow" }];
			manager.loadRules(rules);

			const request: PermissionRequest = {
				tool: "file",
				operation: "read",
				description: "Read a file",
				path: "/tmp/test.txt",
				destructive: false,
			};

			const result = await manager.withPermission(request, async () => "success");
			expect(result).toBe("success");
		});
	});

	describe("Rule ordering (first match wins)", () => {
		it("should use first matching rule", async () => {
			const rules: PermissionRule[] = [
				{ tool: "file", operation: "delete", decision: "allow" },
				{ tool: "file", operation: "delete", decision: "deny" },
			];
			manager.loadRules(rules);

			const request: PermissionRequest = {
				tool: "file",
				operation: "delete",
				description: "Delete a file",
				path: "/tmp/test.txt",
				destructive: true,
			};

			const decision = await manager.requestPermission(request);
			expect(decision.allowed).toBe(true);
		});

		it("should skip non-matching rules and use later matching rule", async () => {
			const rules: PermissionRule[] = [
				{ tool: "shell", operation: "exec", decision: "deny" },
				{ tool: "file", operation: "delete", decision: "allow" },
			];
			manager.loadRules(rules);

			const request: PermissionRequest = {
				tool: "file",
				operation: "delete",
				description: "Delete a file",
				path: "/tmp/test.txt",
				destructive: true,
			};

			const decision = await manager.requestPermission(request);
			expect(decision.allowed).toBe(true);
		});
	});

	describe("addRule", () => {
		it("should append rule to existing rules", async () => {
			manager.loadRules([{ tool: "file", operation: "read", decision: "allow" }]);
			manager.addRule({ tool: "file", operation: "write", decision: "allow" });

			const readRequest: PermissionRequest = {
				tool: "file",
				operation: "read",
				description: "Read",
				destructive: false,
			};
			const writeRequest: PermissionRequest = {
				tool: "file",
				operation: "write",
				description: "Write",
				destructive: true,
			};

			expect((await manager.requestPermission(readRequest)).allowed).toBe(true);
			expect((await manager.requestPermission(writeRequest)).allowed).toBe(true);
		});
	});

	describe("loadRules replaces current rules", () => {
		it("should replace all rules", async () => {
			manager.loadRules([{ tool: "file", operation: "read", decision: "allow" }]);
			manager.loadRules([{ tool: "file", operation: "write", decision: "allow" }]);

			const readRequest: PermissionRequest = {
				tool: "file",
				operation: "read",
				description: "Read",
				destructive: false,
			};
			const writeRequest: PermissionRequest = {
				tool: "file",
				operation: "write",
				description: "Write",
				destructive: true,
			};

			expect((await manager.requestPermission(readRequest)).allowed).toBe(false);
			expect((await manager.requestPermission(writeRequest)).allowed).toBe(true);
		});
	});
});
