import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BridgeClient, BridgeError, createBridgeClient } from "./index.js";

describe("BridgeClient", () => {
	const baseUrl = "http://127.0.0.1:8000";
	let fetchSpy: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchSpy = vi.spyOn(globalThis, "fetch") as unknown as ReturnType<typeof vi.fn>;
	});

	afterEach(() => {
		fetchSpy.mockRestore();
	});

	function mockResponse(body: unknown, status = 200) {
		fetchSpy.mockResolvedValueOnce({
			ok: status >= 200 && status < 300,
			status,
			text: async () => JSON.stringify(body),
			json: async () => body,
		} as Response);
	}

	it("checks server health", async () => {
		mockResponse({ status: "ok" });
		const client = createBridgeClient(baseUrl);
		const result = await client.health();
		expect(result).toEqual({ status: "ok" });
		expect(fetchSpy).toHaveBeenCalledWith(`${baseUrl}/health`, {
			method: "GET",
			headers: { "Content-Type": "application/json" },
		});
	});

	it("runs a goal and returns summary", async () => {
		mockResponse({
			success: true,
			goal: "test goal",
			completed: ["agent1"],
			failed: ["agent2"],
		});
		const client = createBridgeClient(baseUrl);
		const result = await client.run("test goal", { maxAgents: 5 });
		expect(result.success).toBe(true);
		expect(result.goal).toBe("test goal");
		expect(result.completed).toEqual(["agent1"]);
		expect(result.failed).toEqual(["agent2"]);
		expect(fetchSpy).toHaveBeenCalledWith(
			`${baseUrl}/run`,
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ goal: "test goal", maxAgents: 5 }),
			}),
		);
	});

	it("asks a question and returns the response", async () => {
		mockResponse({ response: "hello back" });
		const client = createBridgeClient(baseUrl);
		const result = await client.ask("hello", { provider: "ollama" });
		expect(result).toBe("hello back");
		expect(fetchSpy).toHaveBeenCalledWith(
			`${baseUrl}/ask`,
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ prompt: "hello", provider: "ollama" }),
			}),
		);
	});

	it("throws BridgeError on HTTP errors", async () => {
		mockResponse({ detail: "bad request" }, 400);
		const client = createBridgeClient(baseUrl);
		await expect(client.health()).rejects.toBeInstanceOf(BridgeError);
	});

	it("throws when fetch fails", async () => {
		fetchSpy.mockRejectedValueOnce(new Error("network error"));
		const client = createBridgeClient(baseUrl);
		await expect(client.health()).rejects.toThrow("network error");
	});
});
