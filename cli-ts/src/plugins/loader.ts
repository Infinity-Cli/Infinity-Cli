import { readdirSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { LoadedPlugins, Plugin } from "./types.js";

export interface PluginLoaderOptions {
	pluginsDir?: string;
}

export async function loadPlugins(options: PluginLoaderOptions = {}): Promise<LoadedPlugins> {
	const pluginsDir = options.pluginsDir;
	const result: LoadedPlugins = { tools: [], providers: [] };

	if (!pluginsDir) {
		return result;
	}

	const absoluteDir = resolve(pluginsDir);
	let entries: string[];
	try {
		entries = readdirSync(absoluteDir);
	} catch {
		// Directory does not exist or is unreadable; treat as no plugins.
		return result;
	}

	for (const entry of entries) {
		const fullPath = join(absoluteDir, entry);
		const stat = statSync(fullPath);
		if (!stat.isDirectory() && !isPluginFile(entry)) {
			continue;
		}

		const importPath = stat.isDirectory() ? join(fullPath, "index.js") : fullPath;

		try {
			const module = (await import(pathToFileURL(importPath).href)) as {
				default?: Plugin;
				plugin?: Plugin;
				tools?: Plugin["tools"];
				providers?: Plugin["providers"];
			};

			const plugin = normalizePlugin(module);
			if (plugin) {
				if (plugin.tools) result.tools.push(...plugin.tools);
				if (plugin.providers) result.providers.push(...plugin.providers);
			}
		} catch {
			// Skip malformed or unloadable plugins.
		}
	}

	return result;
}

function isPluginFile(name: string): boolean {
	const ext = extname(name);
	return ext === ".js" || ext === ".mjs" || ext === ".cjs";
}

function normalizePlugin(module: {
	default?: Plugin;
	plugin?: Plugin;
	tools?: Plugin["tools"];
	providers?: Plugin["providers"];
}): Plugin | undefined {
	if (module.default && typeof module.default === "object") {
		return module.default;
	}
	if (module.plugin && typeof module.plugin === "object") {
		return module.plugin;
	}
	if (module.tools || module.providers) {
		return {
			name: "anonymous",
			tools: module.tools,
			providers: module.providers,
		};
	}
	return undefined;
}
