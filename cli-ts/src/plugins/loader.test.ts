import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPlugins } from "./loader.js";

function safeRemove(dir: string): void {
	for (let i = 0; i < 5; i++) {
		try {
			rmSync(dir, { recursive: true, force: true });
			return;
		} catch {
			if (i < 4) {
				const start = Date.now();
				while (Date.now() - start < 200) {
					/* spin */
				}
			}
		}
	}
}

function createFakeTool(name: string) {
	return {
		name,
		description: `Tool ${name}`,
		inputSchema: {
			safeParse: (input: unknown) => ({ success: true, data: input }),
		},
		execute: async (input: unknown) => ({ success: true, output: String(input) }),
	};
}

describe("loadPlugins", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "plugin-loader-test-"));
	});

	afterEach(() => {
		safeRemove(tempDir);
	});

	it("returns empty result when no pluginsDir is provided", async () => {
		const result = await loadPlugins();
		expect(result.tools).toEqual([]);
		expect(result.providers).toEqual([]);
	});

	it("returns empty result when pluginsDir does not exist", async () => {
		const result = await loadPlugins({ pluginsDir: join(tempDir, "missing") });
		expect(result.tools).toEqual([]);
		expect(result.providers).toEqual([]);
	});

	it("loads a tool from a default export plugin file", async () => {
		const pluginPath = join(tempDir, "demo.mjs");
		writeFileSync(
			pluginPath,
			`export default {
  name: 'demo',
  tools: [{
    name: 'demo.echo',
    description: 'Echo input',
    inputSchema: { safeParse: (input) => ({ success: true, data: input }) },
    execute: async (input) => ({ success: true, output: String(input?.message ?? '') }),
  }],
};`,
		);

		const result = await loadPlugins({ pluginsDir: tempDir });
		expect(result.tools).toHaveLength(1);
		expect(result.tools[0].name).toBe("demo.echo");
	});

	it("loads a plugin from a directory index.js", async () => {
		const pluginDir = join(tempDir, "my-plugin");
		mkdirSync(pluginDir);
		writeFileSync(
			join(pluginDir, "index.js"),
			`export default {
  name: 'my-plugin',
  tools: [{
    name: 'my-plugin.greet',
    description: 'Greet',
    inputSchema: { safeParse: (input) => ({ success: true, data: input }) },
    execute: async () => ({ success: true, output: 'hello' }),
  }],
};`,
		);

		const result = await loadPlugins({ pluginsDir: tempDir });
		expect(result.tools).toHaveLength(1);
		expect(result.tools[0].name).toBe("my-plugin.greet");
	});

	it("loads providers from named plugin export", async () => {
		const pluginPath = join(tempDir, "providers.mjs");
		writeFileSync(
			pluginPath,
			`export const plugin = {
  name: 'provider-pack',
  providers: [{ name: 'mock-provider', async chat() { return 'ok'; } }],
};`,
		);

		const result = await loadPlugins({ pluginsDir: tempDir });
		expect(result.providers).toHaveLength(1);
		expect(result.providers[0].name).toBe("mock-provider");
	});

	it("skips invalid plugin files without throwing", async () => {
		writeFileSync(join(tempDir, "broken.mjs"), 'throw new Error("bad plugin");');
		writeFileSync(
			join(tempDir, "good.mjs"),
			`export const tools = [{ name: 'good.tool', description: 'Good', inputSchema: { safeParse: (i) => ({ success: true, data: i }) }, execute: async () => ({ success: true }) }];`,
		);

		const result = await loadPlugins({ pluginsDir: tempDir });
		expect(result.tools).toHaveLength(1);
		expect(result.tools[0].name).toBe("good.tool");
	});

	it("loads multiple plugins", async () => {
		writeFileSync(
			join(tempDir, "a.mjs"),
			`export default { name: 'a', tools: [${JSON.stringify(createFakeTool("a.tool"))}] };`,
		);
		writeFileSync(
			join(tempDir, "b.mjs"),
			`export default { name: 'b', tools: [${JSON.stringify(createFakeTool("b.tool"))}] };`,
		);

		const result = await loadPlugins({ pluginsDir: tempDir });
		expect(result.tools).toHaveLength(2);
		expect(result.tools.map((t) => t.name).sort()).toEqual(["a.tool", "b.tool"]);
	});
});
