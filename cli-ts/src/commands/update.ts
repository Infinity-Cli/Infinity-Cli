import { execSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import chalk from "chalk";
import { Command } from "commander";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Release {
	tag_name: string;
	html_url: string;
	body: string;
}

interface CompareResult {
	latest: string;
	release: Release;
	isNewer: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read the current version from the CLI's own package.json.
 * Uses ESM-compatible URL resolution at runtime.
 */
function readOwnVersion(): string {
	const url = new URL("../../package.json", import.meta.url);
	const pkg = JSON.parse(readFileSync(url, "utf-8")) as { version: string };
	return pkg.version;
}

/**
 * Fetch the latest release metadata from GitHub.
 */
async function fetchLatestRelease(): Promise<Release> {
	const response = await fetch(
		"https://api.github.com/repos/Infinity-Cli/Infinity-Cli/releases/latest",
		{
			headers: {
				Accept: "application/vnd.github.v3+json",
				"User-Agent": "Infinity-Cli",
			},
		},
	);

	if (!response.ok) {
		throw new Error(`GitHub API responded with ${response.status} ${response.statusText}`);
	}

	return (await response.json()) as Release;
}

/**
 * Strip leading `v` and parse a version string into numeric parts.
 * Returns `[major, minor, patch]` or `[major, minor, 0]` if patch is missing.
 * Throws if the string cannot be parsed.
 */
function parseVersion(raw: string): number[] {
	const s = raw.replace(/^v/i, "");
	const parts = s.split(".");
	const nums: number[] = [];
	for (const p of parts) {
		const n = Number(p);
		if (Number.isNaN(n)) {
			throw new Error(`Cannot parse version part "${p}" from "${raw}"`);
		}
		nums.push(n);
	}
	// Normalise to at least 3 components
	while (nums.length < 3) {
		nums.push(0);
	}
	return nums;
}

/**
 * Compare two version arrays component-wise.
 * Returns:
 *   1  if `a` > `b`
 *   0  if `a` === `b`
 *  -1  if `a` < `b`
 */
function compareVersions(a: number[], b: number[]): number {
	for (let i = 0; i < 3; i++) {
		const diff = a[i] - b[i];
		if (diff !== 0) return diff > 0 ? 1 : -1;
	}
	return 0;
}

// ---------------------------------------------------------------------------
// Installer
// ---------------------------------------------------------------------------

type Platform = NodeJS.Platform;

/**
 * Build the platform-specific install command string.
 */
function buildInstallCommand(dryRun: boolean): string {
	const isWin = process.platform === "win32";

	if (isWin) {
		return [
			"powershell.exe",
			"-NoProfile",
			"-ExecutionPolicy",
			"Bypass",
			"-Command",
			`"irm https://raw.githubusercontent.com/Infinity-Cli/Infinity-Cli/main/install.ps1 | iex"`,
		].join(" ");
	}

	return [
		"bash",
		"-c",
		`"curl -fsSL https://raw.githubusercontent.com/Infinity-Cli/Infinity-Cli/main/install.sh | sh"`,
	].join(" ");
}

/**
 * Run the installer command. Returns the exit code, or 0 on success.
 */
function runInstaller(): number {
	const isWin = process.platform === "win32";

	if (isWin) {
		const result = spawnSync(
			"powershell.exe",
			[
				"-NoProfile",
				"-ExecutionPolicy",
				"Bypass",
				"-Command",
				"irm https://raw.githubusercontent.com/Infinity-Cli/Infinity-Cli/main/install.ps1 | iex",
			],
			{
				stdio: "inherit",
				timeout: 120_000,
			},
		);
		return result.status ?? 1;
	}

	const result = spawnSync(
		"bash",
		[
			"-c",
			"curl -fsSL https://raw.githubusercontent.com/Infinity-Cli/Infinity-Cli/main/install.sh | sh",
		],
		{
			stdio: "inherit",
			timeout: 120_000,
		},
	);
	return result.status ?? 1;
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export const updateCommand = new Command("update")
	.description("Check for updates and install the latest version")
	.option("--dry-run", "Print the install command without executing it")
	.action(async (options: { dryRun?: boolean }) => {
		const dryRun = options.dryRun ?? false;

		try {
			const current = readOwnVersion();
			const release = await fetchLatestRelease();
			const latestTag = release.tag_name;

			// Strip leading "v" from both before compare
			const currentParsed = parseVersion(current);
			const latestParsed = parseVersion(latestTag);

			const cmp = compareVersions(currentParsed, latestParsed);

			if (cmp >= 0) {
				console.log(chalk.green(`You are already on the latest version (${current}).`));
				process.exitCode = 0;
				return;
			}

			// We have a newer version available
			console.log(chalk.cyan("A new version is available!"));
			console.log(chalk.bold(`  Current:  ${current}`));
			console.log(chalk.bold(`  Latest:   ${latestTag}`));
			console.log();

			if (release.body) {
				// Print first ~10 lines of release notes
				const lines = release.body.split("\n").slice(0, 10);
				console.log(chalk.underline("Release notes:"));
				for (const line of lines) {
					if (line.trim()) console.log(`  ${line}`);
				}
				console.log();
			}

			const cmd = buildInstallCommand(dryRun);

			if (dryRun) {
				console.log(chalk.yellow("--dry-run: install command would be:"));
				console.log(`  ${cmd}`);
				process.exitCode = 0;
				return;
			}

			console.log(chalk.blue("Running installer..."));
			const exitCode = runInstaller();

			if (exitCode !== 0) {
				console.error(
					chalk.red(`Installer exited with code ${exitCode}. Installation may have failed.`),
				);
				process.exitCode = 1;
				return;
			}

			console.log(chalk.green("Update completed successfully."));
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : "Unknown error";
			console.error(chalk.red(`Update failed: ${message}`));
			process.exitCode = 1;
		}
	});
