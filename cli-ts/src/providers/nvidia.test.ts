import { describe, expect, it, vi } from "vitest";
import { NvidiaProvider } from "./nvidia.js";

describe("NvidiaProvider", () => {
	it("returns assistant content from a successful response", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				choices: [{ message: { content: "Hello from NVIDIA" } }],
			}),
		});
		vi.stubGlobal("fetch", fetchMock);

		const provider = new NvidiaProvider({ apiKey: "nvapi-test" });
		const response = await provider.chat([{ role: "user", content: "hi" }]);

		expect(response).toBe("Hello from NVIDIA");
		expect(provider.name).toBe("nvidia");
		expect(fetchMock).toHaveBeenCalledWith(
			"https://integrate.api.nvidia.com/v1/chat/completions",
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({
					Authorization: "Bearer nvapi-test",
				}),
			}),
		);
		const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
		expect(body.model).toBe("meta/llama3-70b-instruct");
		expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
	});

	it("uses custom baseUrl and model when provided", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				choices: [{ message: { content: "Custom" } }],
			}),
		});
		vi.stubGlobal("fetch", fetchMock);

		const provider = new NvidiaProvider({
			apiKey: "nvapi-test",
			baseUrl: "https://custom.nvidia.com/v1",
			model: "custom-model",
		});
		await provider.chat([{ role: "user", content: "hi" }]);

		expect(fetchMock).toHaveBeenCalledWith(
			"https://custom.nvidia.com/v1/chat/completions",
			expect.anything(),
		);
		const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
		expect(body.model).toBe("custom-model");
	});

	it("throws on API error", async () => {
		vi.stubGlobal("fetch", async () => ({
			ok: false,
			text: async () => "Unauthorized",
		}));

		const provider = new NvidiaProvider({ apiKey: "bad" });
		await expect(provider.chat([{ role: "user", content: "hi" }])).rejects.toThrow(
			"OpenAI request failed",
		);
	});
});
