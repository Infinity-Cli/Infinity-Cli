import { beforeEach, describe, expect, it } from "vitest";
import { McpClient } from "./client.js";
import { InMemoryTransport } from "./transport.js";

function createTestPair(): { client: McpClient; server: InMemoryTransport } {
	const [clientTransport, serverTransport] = InMemoryTransport.createPair();
	const client = new McpClient({ name: "test", transport: clientTransport });
	return { client, server: serverTransport };
}

describe("McpClient", () => {
	beforeEach(() => {
		// Ensure clean state for each test.
	});

	it("connects and receives tools list", async () => {
		const { client, server } = createTestPair();

		void client.connect();

		server.onMessage((message) => {
			const msg = message as { id: number; method: string };
			if (msg.method === "tools/list") {
				server.send({
					jsonrpc: "2.0",
					id: msg.id,
					result: {
						tools: [
							{ name: "read_file", description: "Read a file" },
							{ name: "write_file", description: "Write a file" },
						],
					},
				});
			}
		});

		const tools = await client.listTools();
		expect(tools).toHaveLength(2);
		expect(tools[0].name).toBe("read_file");

		await client.close();
	});

	it("calls a tool and returns result", async () => {
		const { client, server } = createTestPair();

		void client.connect();

		server.onMessage((message) => {
			const msg = message as {
				id: number;
				method: string;
				params?: { name: string; arguments: unknown };
			};
			if (msg.method === "tools/call") {
				expect(msg.params?.name).toBe("read_file");
				server.send({
					jsonrpc: "2.0",
					id: msg.id,
					result: {
						content: [{ type: "text", text: "file contents" }],
						isError: false,
					},
				});
			}
		});

		const result = await client.callTool("read_file", { path: "foo.txt" });
		expect(result.content[0].text).toBe("file contents");
		expect(result.isError).toBe(false);

		await client.close();
	});

	it("returns empty tools list when result has no tools", async () => {
		const { client, server } = createTestPair();

		void client.connect();

		server.onMessage((message) => {
			const msg = message as { id: number; method: string };
			if (msg.method === "tools/list") {
				server.send({ jsonrpc: "2.0", id: msg.id, result: {} });
			}
		});

		const tools = await client.listTools();
		expect(tools).toEqual([]);

		await client.close();
	});

	it("rejects on JSON-RPC error", async () => {
		const { client, server } = createTestPair();

		void client.connect();

		server.onMessage((message) => {
			const msg = message as { id: number; method: string };
			if (msg.method === "tools/call") {
				server.send({
					jsonrpc: "2.0",
					id: msg.id,
					error: { message: "Tool not found", code: -32601 },
				});
			}
		});

		await expect(client.callTool("missing_tool", {})).rejects.toThrow("Tool not found");

		await client.close();
	});

	it("rejects pending requests when closed", async () => {
		const { client } = createTestPair();
		void client.connect();

		const pending = client.callTool("some_tool", {});
		await client.close();

		await expect(pending).rejects.toThrow("MCP client closed");
	});
});
