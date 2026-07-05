export interface MCPRequest {
	jsonrpc: "2.0";
	id: number | string;
	method: string;
	params?: unknown;
}

export interface MCPResponse {
	jsonrpc: "2.0";
	id: number | string;
	result?: unknown;
	error?: {
		code: number;
		message: string;
		data?: unknown;
	};
}

export interface MCPTool {
	name: string;
	description?: string;
	inputSchema?: unknown;
}

export interface MCPCallToolResult {
	content?: Array<{
		type: string;
		text?: string;
	}>;
	isError?: boolean;
}

export interface MCPInitializeParams {
	protocolVersion: string;
	capabilities: Record<string, unknown>;
	clientInfo: {
		name: string;
		version: string;
	};
}

export interface MCPInitializeResult {
	protocolVersion: string;
	capabilities: Record<string, unknown>;
	serverInfo: {
		name: string;
		version: string;
	};
}

export interface MCPListToolsResult {
	tools: MCPTool[];
}

export interface MCPCallToolParams {
	name: string;
	arguments: unknown;
}
