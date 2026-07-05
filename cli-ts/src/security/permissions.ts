import { dirname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import type {
	PermissionDecision,
	PermissionLevel,
	PermissionRequest,
	PermissionRule,
} from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class PermissionError extends Error {
	public readonly request: PermissionRequest;

	constructor(message: string, request: PermissionRequest) {
		super(message);
		this.name = "PermissionError";
		this.request = request;
	}
}

function normalizePath(path: string): string {
	return path.replace(/\\/g, "/");
}

function matchGlob(pattern: string, path: string): boolean {
	const normalizedPattern = normalizePath(pattern);
	const normalizedPath = normalizePath(path);

	// Convert glob pattern to regex
	// Escape special regex characters except * and **
	const regexPattern = normalizedPattern
		.split("**")
		.map((part) =>
			part
				.split("*")
				.map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
				.join("[^/]*"),
		)
		.join(".*");

	const regex = new RegExp(`^${regexPattern}$`);
	return regex.test(normalizedPath);
}

function ruleMatches(rule: PermissionRule, request: PermissionRequest): boolean {
	if (rule.tool !== undefined && rule.tool !== request.tool) {
		return false;
	}
	if (rule.operation !== undefined && rule.operation !== request.operation) {
		return false;
	}
	if (rule.destructive !== undefined && rule.destructive !== request.destructive) {
		return false;
	}
	if (rule.pathPattern !== undefined) {
		if (request.path === undefined) {
			return false;
		}
		if (!matchGlob(rule.pathPattern, request.path)) {
			return false;
		}
	}
	return true;
}

export interface PermissionManagerOptions {
	rules?: PermissionRule[];
	promptFn?: (request: PermissionRequest) => Promise<boolean>;
	defaultDecision?: PermissionLevel;
}

export class PermissionManager {
	private rules: PermissionRule[];
	private promptFn: ((request: PermissionRequest) => Promise<boolean>) | undefined;
	private defaultDecision: PermissionLevel;

	constructor(options: PermissionManagerOptions = {}) {
		this.rules = options.rules ? [...options.rules] : [];
		this.promptFn = options.promptFn;
		this.defaultDecision = options.defaultDecision ?? "deny";
	}

	loadRules(rules: PermissionRule[]): void {
		this.rules = [...rules];
	}

	addRule(rule: PermissionRule): void {
		this.rules.push(rule);
	}

	async requestPermission(request: PermissionRequest): Promise<PermissionDecision> {
		for (const rule of this.rules) {
			if (ruleMatches(rule, request)) {
				switch (rule.decision) {
					case "allow":
						return { allowed: true };
					case "deny":
						return { allowed: false, reason: `Denied by rule: ${JSON.stringify(rule)}` };
					case "prompt": {
						if (this.promptFn) {
							const allowed = await this.promptFn(request);
							return { allowed, reason: allowed ? undefined : "User denied permission" };
						}
						// No promptFn, fall back to defaultDecision
						if (this.defaultDecision === "allow") {
							return { allowed: true };
						}
						return { allowed: false, reason: "Prompt required but no prompt function available" };
					}
				}
			}
		}

		// No matching rule, use defaultDecision
		switch (this.defaultDecision) {
			case "allow":
				return { allowed: true };
			case "deny":
				return { allowed: false, reason: "No matching rule, default deny" };
			case "prompt": {
				if (this.promptFn) {
					const allowed = await this.promptFn(request);
					return { allowed, reason: allowed ? undefined : "User denied permission" };
				}
				return { allowed: false, reason: "Prompt required but no prompt function available" };
			}
		}
	}

	async withPermission<T>(request: PermissionRequest, fn: () => Promise<T> | T): Promise<T> {
		const decision = await this.requestPermission(request);
		if (!decision.allowed) {
			throw new PermissionError(decision.reason ?? "Permission denied", request);
		}
		return fn();
	}
}
