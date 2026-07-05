import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Plan, Task, TaskStatus } from "./types.js";

export type TaskEvent = "started" | "completed" | "failed" | "skipped";

export interface SchedulerOptions {
	executor?: (task: Task) => Promise<void>;
	concurrency?: number;
	maxRetries?: number;
	retryDelayMs?: number;
	checkpointDir?: string;
	continueOnError?: boolean;
	onTaskUpdate?: (task: Task, event: TaskEvent) => void;
}

export interface RunOptions {
	concurrency?: number;
	maxRetries?: number;
	retryDelayMs?: number;
	continueOnError?: boolean;
}

interface CheckpointData {
	plan: Plan;
	updatedAt: string;
}

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 0;
const DEFAULT_CHECKPOINT_DIR = join(homedir(), ".infinity", "checkpoints");

export class Scheduler {
	private plan: Plan;
	private readonly options: Required<SchedulerOptions>;
	private runningCount = 0;
	private stopped = false;

	constructor(plan: Plan, options: SchedulerOptions = {}) {
		this.plan = { ...plan, tasks: plan.tasks.map((t) => ({ ...t })) };
		this.options = {
			executor: options.executor ?? (async () => {}),
			concurrency: options.concurrency ?? DEFAULT_CONCURRENCY,
			maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
			retryDelayMs: options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
			checkpointDir: options.checkpointDir ?? DEFAULT_CHECKPOINT_DIR,
			continueOnError: options.continueOnError ?? false,
			onTaskUpdate: options.onTaskUpdate ?? (() => {}),
		};
	}

	getPlan(): Plan {
		return { ...this.plan, tasks: this.plan.tasks.map((t) => ({ ...t })) };
	}

	async run(runOptions: RunOptions = {}): Promise<Plan> {
		const concurrency = runOptions.concurrency ?? this.options.concurrency;
		const maxRetries = runOptions.maxRetries ?? this.options.maxRetries;
		const retryDelayMs = runOptions.retryDelayMs ?? this.options.retryDelayMs;
		const continueOnError = runOptions.continueOnError ?? this.options.continueOnError;

		this.stopped = false;

		while (true) {
			if (this.stopped) break;

			const readyTasks = this.getReadyTasks();

			if (readyTasks.length === 0) {
				const hasRunning = this.plan.tasks.some((t) => t.status === "running");
				const hasPending = this.plan.tasks.some((t) => t.status === "pending");
				if (!hasRunning && !hasPending) break;
				if (!hasRunning && hasPending) {
					// Remaining pending tasks are blocked by failed/skipped dependencies.
					await this.skipRemainingTasks();
					break;
				}
				await this.waitForTaskCompletion();
				continue;
			}

			const tasksToRun = readyTasks.slice(0, concurrency - this.runningCount);
			if (tasksToRun.length === 0) {
				await this.waitForTaskCompletion();
				continue;
			}

			for (const task of tasksToRun) {
				if (this.stopped) break;
				this.executeTask(task, maxRetries, retryDelayMs, continueOnError);
			}

			await this.waitForTaskCompletion();
		}

		return this.getPlan();
	}

	private async executeTask(
		task: Task,
		maxRetries: number,
		retryDelayMs: number,
		continueOnError: boolean,
	): Promise<void> {
		this.runningCount++;
		this.updateTaskStatus(task.id, "running");
		const runningTask = this.getTask(task.id);
		if (!runningTask) {
			this.runningCount--;
			return;
		}
		this.options.onTaskUpdate(runningTask, "started");
		await this.saveCheckpoint();

		let lastError: Error | undefined;
		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			if (this.stopped) break;

			if (attempt > 0) {
				const currentTask = this.getTask(task.id);
				if (currentTask) {
					currentTask.retryCount = attempt;
					currentTask.updatedAt = new Date();
					this.options.onTaskUpdate(currentTask, "started");
					await this.saveCheckpoint();
				}
				if (retryDelayMs > 0) {
					await this.sleep(retryDelayMs);
				}
			}

			try {
				await this.options.executor(runningTask);
				this.updateTaskStatus(task.id, "completed");
				const completedTask = this.getTask(task.id);
				if (completedTask) {
					this.options.onTaskUpdate(completedTask, "completed");
				}
				await this.saveCheckpoint();
				this.runningCount--;
				return;
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));
			}
		}

		this.updateTaskStatus(task.id, "failed");
		const failedTask = this.getTask(task.id);
		if (failedTask) {
			this.options.onTaskUpdate(failedTask, "failed");
		}
		await this.saveCheckpoint();
		this.runningCount--;

		if (!continueOnError) {
			this.stopped = true;
			await this.skipRemainingTasks();
		}
	}

	private getReadyTasks(): Task[] {
		const completedIds = new Set(
			this.plan.tasks.filter((t) => t.status === "completed").map((t) => t.id),
		);
		const failedOrSkippedIds = new Set(
			this.plan.tasks
				.filter((t) => t.status === "failed" || t.status === "skipped")
				.map((t) => t.id),
		);

		return this.plan.tasks.filter((task) => {
			if (task.status !== "pending") return false;
			if (task.dependencies.some((depId) => failedOrSkippedIds.has(depId))) {
				return false;
			}
			return task.dependencies.every((depId) => completedIds.has(depId));
		});
	}

	private async skipRemainingTasks(): Promise<void> {
		for (const task of this.plan.tasks) {
			if (task.status === "pending") {
				this.updateTaskStatus(task.id, "skipped");
				this.options.onTaskUpdate(task, "skipped");
			}
		}
		await this.saveCheckpoint();
	}

	private updateTaskStatus(taskId: string, status: TaskStatus): void {
		const taskIndex = this.plan.tasks.findIndex((t) => t.id === taskId);
		if (taskIndex !== -1) {
			this.plan.tasks[taskIndex] = {
				...this.plan.tasks[taskIndex],
				status,
				updatedAt: new Date(),
			};
		}
	}

	private getTask(taskId: string): Task | undefined {
		return this.plan.tasks.find((t) => t.id === taskId);
	}

	private async waitForTaskCompletion(): Promise<void> {
		while (this.runningCount > 0 && !this.stopped) {
			await this.sleep(50);
		}
	}

	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	private async saveCheckpoint(): Promise<void> {
		await mkdir(this.options.checkpointDir, { recursive: true });
		const checkpointPath = join(this.options.checkpointDir, `${this.plan.id}.json`);
		const data: CheckpointData = {
			plan: this.getPlan(),
			updatedAt: new Date().toISOString(),
		};
		await writeFile(checkpointPath, JSON.stringify(data, null, 2), "utf-8");
	}

	static async loadCheckpoint(planId: string, checkpointDir?: string): Promise<Plan | null> {
		const dir = checkpointDir ?? DEFAULT_CHECKPOINT_DIR;
		const checkpointPath = join(dir, `${planId}.json`);

		try {
			const content = await readFile(checkpointPath, "utf-8");
			const data = JSON.parse(content) as CheckpointData;

			const plan: Plan = {
				...data.plan,
				tasks: data.plan.tasks.map((t) => ({
					...t,
					createdAt: new Date(t.createdAt),
					updatedAt: new Date(t.updatedAt),
				})),
				createdAt: new Date(data.plan.createdAt),
			};

			return plan;
		} catch {
			return null;
		}
	}
}
