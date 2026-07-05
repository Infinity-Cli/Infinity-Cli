import type { Provider } from "../providers/base.js";
import type { Tool } from "../tools/types.js";

export interface Plugin {
	name: string;
	tools?: Tool[];
	providers?: Provider[];
}

export interface LoadedPlugins {
	tools: Tool[];
	providers: Provider[];
}
