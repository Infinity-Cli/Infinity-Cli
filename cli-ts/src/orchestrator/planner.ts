import { randomUUID } from "node:crypto";
import type { AgentRole, Plan, PlannerOptions, Task, TaskStatus } from "./types.js";

function createTask(
	id: string,
	description: string,
	role: AgentRole,
	dependencies: string[],
	toolPermissions: string[],
	maxRetries: number,
): Task {
	const now = new Date();
	return {
		id,
		description,
		role,
		status: "pending",
		dependencies,
		artifacts: [],
		toolPermissions,
		retryCount: 0,
		maxRetries,
		createdAt: now,
		updatedAt: now,
	};
}

export class Planner {
	private readonly defaultAgent: AgentRole;
	private readonly maxRetries: number;

	constructor(options: PlannerOptions = {}) {
		this.defaultAgent = options.defaultAgent ?? "code";
		this.maxRetries = options.maxRetries ?? 3;
	}

	getDefaultAgent(): AgentRole {
		return this.defaultAgent;
	}

	getMaxRetries(): number {
		return this.maxRetries;
	}

	async plan(goal: string, _context?: { repoSummary?: string; query?: string }): Promise<Plan> {
		const plannerId = randomUUID();
		const codeId = randomUUID();
		const reviewerId = randomUUID();
		const documentationId = randomUUID();
		const securityId = randomUUID();

		const tasks: Task[] = [
			createTask(
				plannerId,
				"Analyze goal and plan tasks",
				"planner",
				[],
				["read", "grep", "find"],
				this.maxRetries,
			),
			createTask(
				codeId,
				"Implement the requested change",
				"code",
				[plannerId],
				["read", "write", "edit", "bash"],
				this.maxRetries,
			),
			createTask(
				reviewerId,
				"Review implementation",
				"reviewer",
				[codeId],
				["read", "grep"],
				this.maxRetries,
			),
			createTask(
				documentationId,
				"Update documentation",
				"documentation",
				[reviewerId],
				["read", "write", "edit"],
				this.maxRetries,
			),
			createTask(
				securityId,
				"Security review",
				"security",
				[reviewerId],
				["read", "grep"],
				this.maxRetries,
			),
		];

		const rootTaskIds = tasks.filter((t) => t.dependencies.length === 0).map((t) => t.id);

		return {
			id: randomUUID(),
			goal,
			tasks,
			rootTaskIds,
			createdAt: new Date(),
		};
	}

	validatePlan(plan: Plan): boolean {
		const taskIds = new Set(plan.tasks.map((t) => t.id));

		// Check all dependencies exist
		for (const task of plan.tasks) {
			for (const depId of task.dependencies) {
				if (!taskIds.has(depId)) {
					return false;
				}
			}
		}

		// Check for cycles using DFS
		const visited = new Set<string>();
		const recStack = new Set<string>();

		const taskMap = new Map(plan.tasks.map((t) => [t.id, t]));

		function hasCycle(taskId: string): boolean {
			if (recStack.has(taskId)) return true;
			if (visited.has(taskId)) return false;

			visited.add(taskId);
			recStack.add(taskId);

			const task = taskMap.get(taskId);
			if (task) {
				for (const depId of task.dependencies) {
					if (hasCycle(depId)) return true;
				}
			}

			recStack.delete(taskId);
			return false;
		}

		for (const task of plan.tasks) {
			if (hasCycle(task.id)) {
				return false;
			}
		}

		return true;
	}

	getReadyTasks(plan: Plan): Task[] {
		const completedIds = new Set(
			plan.tasks.filter((t) => t.status === "completed").map((t) => t.id),
		);

		return plan.tasks.filter((task) => {
			if (task.status !== "pending") return false;
			return task.dependencies.every((depId) => completedIds.has(depId));
		});
	}

	markTaskStatus(plan: Plan, taskId: string, status: TaskStatus): Plan {
		const taskIndex = plan.tasks.findIndex((t) => t.id === taskId);
		if (taskIndex === -1) {
			throw new Error(`Task not found: ${taskId}`);
		}

		const updatedTasks = [...plan.tasks];
		const task = { ...updatedTasks[taskIndex] };
		task.status = status;
		task.updatedAt = new Date();
		updatedTasks[taskIndex] = task;

		return {
			...plan,
			tasks: updatedTasks,
		};
	}
}
