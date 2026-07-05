import { McpClient } from "./client.js";
import { StdioTransport } from "./transport.js";

export interface McpServerConfig {
	command: string;
	args?: string[];
	env?: Record<string, string>;
	cwd?: string;
}

export function createStdioClient(name: string, config: McpServerConfig): McpClient {
	return new McpClient({
		name,
		transport: new StdioTransport(config),
	});
}

export function createFilesystemServer(root: string): McpClient {
	return createStdioClient("filesystem", {
		command: "npx",
		args: ["-y", "@modelcontextprotocol/server-filesystem", root],
	});
}

export function createBrowserServer(): McpClient {
	return createStdioClient("browser", {
		command: "npx",
		args: ["-y", "@modelcontextprotocol/server-browser"],
	});
}

export function createGitHubServer(): McpClient {
	return createStdioClient("github", {
		command: "npx",
		args: ["-y", "@modelcontextprotocol/server-github"],
	});
}

export async function loadMcpServers(
	config: Record<string, McpServerConfig>,
): Promise<Record<string, McpClient>> {
	const clients: Record<string, McpClient> = {};
	for (const [name, serverConfig] of Object.entries(config)) {
		clients[name] = createStdioClient(name, serverConfig);
	}
	return clients;
}
