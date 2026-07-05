import type { McpTransport } from "./transport.js";

export interface McpTool {
	name: string;
	description?: string;
	inputSchema?: unknown;
}

export interface McpCallResult {
	content: Array<{ type: string; text?: string }>;
	isError?: boolean;
}

export interface McpClientOptions {
	name: string;
	transport: McpTransport;
}

interface JsonRpcMessage {
	jsonrpc: "2.0";
	id?: number;
	method?: string;
	params?: unknown;
	result?: unknown;
	error?: { message: string; code?: number; data?: unknown };
}

export class McpClient {
	name: string;
	private transport: McpTransport;
	private nextId = 0;
	private pending = new Map<
		number,
		{ resolve: (value: unknown) => void; reject: (reason: Error) => void }
	>();

	constructor(options: McpClientOptions) {
		this.name = options.name;
		this.transport = options.transport;
	}

	async connect(): Promise<void> {
		this.transport.onMessage((message) => this.handleMessage(message));
		await this.transport.connect();
	}

	async listTools(): Promise<McpTool[]> {
		const result = (await this.request("tools/list", {})) as { tools?: McpTool[] } | undefined;
		return result?.tools ?? [];
	}

	async callTool(name: string, input: unknown): Promise<McpCallResult> {
		return (await this.request("tools/call", {
			name,
			arguments: input,
		})) as McpCallResult;
	}

	async close(): Promise<void> {
		await this.transport.close();
		for (const { reject } of this.pending.values()) {
			reject(new Error("MCP client closed"));
		}
		this.pending.clear();
	}

	private request(method: string, params: unknown): Promise<unknown> {
		return new Promise((resolve, reject) => {
			const id = ++this.nextId;
			this.pending.set(id, { resolve, reject });
			const message: JsonRpcMessage = { jsonrpc: "2.0", id, method, params };
			try {
				this.transport.send(message);
			} catch (error) {
				this.pending.delete(id);
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	private handleMessage(message: unknown): void {
		const msg = message as JsonRpcMessage;
		if (typeof msg.id !== "number" || !this.pending.has(msg.id)) {
			return;
		}
		const entry = this.pending.get(msg.id);
		if (!entry) {
			return;
		}
		const { resolve, reject } = entry;
		this.pending.delete(msg.id);
		if (msg.error) {
			reject(new Error(msg.error.message ?? "MCP error"));
		} else {
			resolve(msg.result);
		}
	}
}
