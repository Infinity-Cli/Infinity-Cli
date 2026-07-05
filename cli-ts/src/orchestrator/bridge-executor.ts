import { type RunOptions, type RunResult, createBridgeClient } from "../bridge/client.js";
import type { StreamingUI } from "../ui/streaming.js";
import type { Task } from "./types.js";

export class BridgeError extends Error {
	constructor(
		message: string,
		public readonly status?: number,
		public readonly body?: string,
	) {
		super(message);
		this.name = "BridgeError";
	}
}

export interface BridgeExecutorOptions {
	baseUrl: string;
	maxAgents?: number;
	timeout?: number;
	enableSync?: boolean;
	syncBaseUrl?: string;
	ui?: StreamingUI;
}

export function createBridgeExecutor(
	options: BridgeExecutorOptions,
): (task: Task) => Promise<void> {
	const client = createBridgeClient(options.baseUrl);

	return async (task: Task): Promise<void> => {
		const message = `Delegating to runtime: ${task.role} - ${task.description}`;
		if (options.ui) {
			options.ui.log("info", message);
		} else {
			// eslint-disable-next-line no-console
			console.log(message);
		}

		const runOptions: RunOptions = {
			maxAgents: options.maxAgents ?? 1,
			timeout: options.timeout ?? 600,
			enableSync: options.enableSync,
			syncBaseUrl: options.syncBaseUrl,
		};

		try {
			const result: RunResult = await client.run(task.description, runOptions);

			if (!result.success) {
				throw new BridgeError(`Task failed: ${task.role}`, undefined, JSON.stringify(result));
			}
		} catch (error) {
			if (error instanceof BridgeError) {
				throw error;
			}
			// Network errors or other fetch errors - rethrow so scheduler can retry
			throw error;
		}
	};
}
