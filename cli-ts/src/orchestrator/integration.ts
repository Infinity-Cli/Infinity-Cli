import { type BridgeExecutorOptions, createBridgeExecutor } from "./bridge-executor.js";
import { Planner } from "./planner.js";
import { Scheduler } from "./scheduler.js";
import type { Plan, Task, TaskEvent } from "./types.js";

export interface RunWithBridgeOptions {
	baseUrl: string;
	maxAgents?: number;
	timeout?: number;
	concurrency?: number;
	maxRetries?: number;
	retryDelayMs?: number;
	checkpointDir?: string;
	onTaskUpdate?: (task: Task, event: TaskEvent) => void;
}

export async function runWithBridge(goal: string, options: RunWithBridgeOptions): Promise<Plan> {
	const plan = await new Planner({ maxRetries: 2 }).plan(goal);

	const executorOptions: BridgeExecutorOptions = {
		baseUrl: options.baseUrl,
		maxAgents: options.maxAgents,
		timeout: options.timeout,
	};

	const scheduler = new Scheduler(plan, {
		concurrency: options.concurrency ?? 3,
		maxRetries: options.maxRetries ?? 2,
		retryDelayMs: options.retryDelayMs ?? 0,
		checkpointDir: options.checkpointDir,
		onTaskUpdate: options.onTaskUpdate,
		executor: createBridgeExecutor(executorOptions),
	});

	return scheduler.run();
}
