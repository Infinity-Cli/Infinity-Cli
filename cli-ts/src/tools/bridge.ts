import type { ToolExecutor } from "./executor.js";
import type { ToolResult } from "./types.js";

export interface ToolBridgeRequest {
	tool: string;
	input: unknown;
}

export function createToolBridgeHandler(executor: ToolExecutor) {
	return async function handleToolCall(request: ToolBridgeRequest): Promise<ToolResult> {
		return executor.execute(request.tool, request.input);
	};
}
