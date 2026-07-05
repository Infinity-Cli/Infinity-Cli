import { relative, resolve, sep } from "node:path";

const BUILTIN_DANGEROUS_PATTERNS = [
	"rm -rf /",
	":(){ :|:& };:",
	"> /dev/sda",
	"mkfs",
	"dd if=/dev/zero of=/dev/sda",
	"curl .*\\|.*bash",
	"wget .*\\|.*bash",
	"format ",
	"del /f /s /q",
	"rd /s /q",
	":(){",
];

export class SandboxError extends Error {
	public readonly code: "SANDBOX_PATH" | "SANDBOX_COMMAND";

	constructor(message: string, code: "SANDBOX_PATH" | "SANDBOX_COMMAND") {
		super(message);
		this.name = "SandboxError";
		this.code = code;
	}
}

function normalizePath(path: string): string {
	return path.replace(/\\/g, "/");
}

function matchesPattern(command: string, pattern: string): boolean {
	const lowerCommand = command.toLowerCase();
	const lowerPattern = pattern.toLowerCase();

	// Treat patterns containing regex metacharacters as regular expressions.
	if (pattern.includes(".*") || pattern.includes("\\|") || pattern.includes("\\s")) {
		try {
			const regex = new RegExp(pattern, "i");
			return regex.test(command);
		} catch {
			return lowerCommand.includes(lowerPattern);
		}
	}

	return lowerCommand.includes(lowerPattern);
}

function isDescendantOrEqual(parent: string, child: string): boolean {
	const normalizedParent = normalizePath(parent);
	const normalizedChild = normalizePath(child);

	if (normalizedChild === normalizedParent) {
		return true;
	}

	const relativePath = relative(normalizedParent, normalizedChild);
	return !relativePath.startsWith("..") && !relativePath.startsWith(".");
}

export interface SandboxPolicyOptions {
	workspace: string;
	allowedPaths?: string[];
	blockedPatterns?: string[];
	allowAll?: boolean;
}

export class SandboxPolicy {
	private workspace: string;
	private allowedPaths: string[];
	private blockedPatterns: string[];
	private allowAll: boolean;

	constructor(options: SandboxPolicyOptions) {
		this.workspace = resolve(options.workspace);
		this.allowedPaths = (options.allowedPaths ?? []).map((p) => resolve(this.workspace, p));
		this.blockedPatterns = options.blockedPatterns ?? [];
		this.allowAll = options.allowAll ?? false;
	}

	isPathAllowed(targetPath: string): boolean {
		if (this.allowAll) {
			return true;
		}

		const resolvedTarget = resolve(this.workspace, targetPath);
		const normalizedTarget = normalizePath(resolvedTarget);
		const normalizedWorkspace = normalizePath(this.workspace);

		// Check if path is within workspace
		if (isDescendantOrEqual(normalizedWorkspace, normalizedTarget)) {
			return true;
		}

		// Check if path is within any allowedPaths
		for (const allowedPath of this.allowedPaths) {
			const normalizedAllowed = normalizePath(allowedPath);
			if (isDescendantOrEqual(normalizedAllowed, normalizedTarget)) {
				return true;
			}
		}

		return false;
	}

	assertPathAllowed(targetPath: string): void {
		if (!this.isPathAllowed(targetPath)) {
			throw new SandboxError(`Path not allowed by sandbox policy: ${targetPath}`, "SANDBOX_PATH");
		}
	}

	isShellCommandAllowed(command: string): boolean {
		if (this.allowAll) {
			return true;
		}

		const lowerCommand = command.toLowerCase();

		// Check built-in dangerous patterns (case-insensitive substring/regex match)
		for (const pattern of BUILTIN_DANGEROUS_PATTERNS) {
			if (matchesPattern(command, pattern)) {
				return false;
			}
		}

		// Check custom blocked patterns (substring match)
		for (const pattern of this.blockedPatterns) {
			if (command.toLowerCase().includes(pattern.toLowerCase())) {
				return false;
			}
		}

		return true;
	}

	assertShellCommandAllowed(command: string): void {
		if (!this.isShellCommandAllowed(command)) {
			throw new SandboxError(
				`Shell command blocked by sandbox policy: ${command}`,
				"SANDBOX_COMMAND",
			);
		}
	}
}
