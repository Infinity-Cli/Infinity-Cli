export type PermissionLevel = "allow" | "deny" | "prompt";

export interface PermissionRequest {
	tool: string;
	operation: string;
	description: string;
	path?: string;
	destructive: boolean;
}

export interface PermissionDecision {
	allowed: boolean;
	reason?: string;
}

export interface PermissionRule {
	tool?: string;
	operation?: string;
	pathPattern?: string;
	destructive?: boolean;
	decision: PermissionLevel;
}
