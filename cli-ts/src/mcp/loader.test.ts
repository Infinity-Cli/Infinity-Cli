import { describe, expect, it } from "vitest";
import {
	createBrowserServer,
	createFilesystemServer,
	createGitHubServer,
	createStdioClient,
	loadMcpServers,
} from "./loader.js";

describe("MCP loader", () => {
	it("creates a stdio client from config", () => {
		const client = createStdioClient("my-server", {
			command: "node",
			args: ["server.js"],
			env: { FOO: "bar" },
		});
		expect(client.name).toBe("my-server");
	});

	it("creates filesystem server client with root path", () => {
		const client = createFilesystemServer("/tmp/project");
		expect(client.name).toBe("filesystem");
	});

	it("creates browser server client", () => {
		const client = createBrowserServer();
		expect(client.name).toBe("browser");
	});

	it("creates GitHub server client", () => {
		const client = createGitHubServer();
		expect(client.name).toBe("github");
	});

	it("loads multiple MCP servers from config", async () => {
		const clients = await loadMcpServers({
			fs: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."] },
			github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] },
		});

		expect(Object.keys(clients).sort()).toEqual(["fs", "github"]);
		expect(clients.fs.name).toBe("fs");
		expect(clients.github.name).toBe("github");
	});
});
