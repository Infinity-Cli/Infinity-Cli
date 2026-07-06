import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import packageJson from "../package.json" with { type: "json" };

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const cliTsRoot = dirname(__dirname);
const cliPath = join(cliTsRoot, "dist", "index.js");

describe("infinity CLI", () => {
	beforeAll(() => {
		execFileSync(process.execPath, [join(cliTsRoot, "node_modules", "typescript", "bin", "tsc")], {
			cwd: cliTsRoot,
			stdio: "pipe",
		});
	}, 60_000);

	it("prints the version for --version", () => {
		const output = execFileSync("node", [cliPath, "--version"], { encoding: "utf-8" });
		expect(output.trim()).toBe(packageJson.version);
	});

	it("prints the version for -v", () => {
		const output = execFileSync("node", [cliPath, "-v"], { encoding: "utf-8" });
		expect(output.trim()).toBe(packageJson.version);
	});

	it("prints the branded welcome banner and help with no arguments", () => {
		const output = execFileSync("node", [cliPath], { encoding: "utf-8" });
		const normalized = output.toLowerCase();

		expect(output).toContain("Infinity CLI");
		expect(output).toContain("Usage:");
		expect(normalized).not.toContain("error:");
	});
});
