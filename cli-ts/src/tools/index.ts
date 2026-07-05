export * from "./types.js";
export { fileTool } from "./file.js";
export { gitTool } from "./git.js";
export { shellTool } from "./shell.js";
export { testingTool } from "./testing.js";
export { browserTool } from "./browser.js";
export { ToolExecutor, type ToolExecutorOptions } from "./executor.js";
export { createToolBridgeHandler, type ToolBridgeRequest } from "./bridge.js";

import { browserTool } from "./browser.js";
import { fileTool } from "./file.js";
import { gitTool } from "./git.js";
import { shellTool } from "./shell.js";
import { testingTool } from "./testing.js";
import { ToolRegistry } from "./types.js";

export function createBuiltinTools(): ToolRegistry {
	const registry = new ToolRegistry();
	registry.register(fileTool);
	registry.register(gitTool);
	registry.register(shellTool);
	registry.register(testingTool);
	registry.register(browserTool);
	return registry;
}
