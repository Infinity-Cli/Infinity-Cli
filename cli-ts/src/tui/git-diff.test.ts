import { execFile } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { execGitDiff } from "./git-diff.js";

vi.mock("node:child_process", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:child_process")>();
	return {
		...actual,
		execFile: vi.fn((...args: unknown[]) => {
			const callback = args.find((arg) => typeof arg === "function");
			if (typeof callback === "function") {
				(callback as (err: Error | null, stdout: string, stderr: string) => void)(
					null,
					"sample diff output",
					"",
				);
			}
		}),
	};
});

describe("execGitDiff", () => {
	it("returns stdout from git diff", async () => {
		const result = await execGitDiff("src/foo.ts");
		expect(result).toBe("sample diff output");
		expect(execFile).toHaveBeenCalledWith(
			"git",
			["diff", "--", "src/foo.ts"],
			expect.any(Function),
		);
	});
});
