export type AgentRole = "planner" | "code" | "reviewer" | "documentation" | "security";

export type TaskEvent = "started" | "completed" | "failed" | "skipped";

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface Task {
	id: string;
	description: string;
	role: AgentRole;
	status: TaskStatus;
	dependencies: string[];
	artifacts: string[];
	toolPermissions: string[];
	retryCount: number;
	maxRetries: number;
	createdAt: Date;
	updatedAt: Date;
}

export interface Plan {
	id: string;
	goal: string;
	tasks: Task[];
	rootTaskIds: string[];
	createdAt: Date;
}

export interface PlannerResult {
	plan: Plan;
	summary: string;
}

export interface PlannerOptions {
	defaultAgent?: AgentRole;
	maxRetries?: number;
}
