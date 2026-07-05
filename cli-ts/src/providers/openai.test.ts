import { describe, expect, it, vi } from "vitest";
import { OpenAIProvider } from "./openai.js";

describe("OpenAIProvider", () => {
	it("returns assistant content from a successful response", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				choices: [{ message: { content: "Hello from OpenAI" } }],
			}),
		});
		vi.stubGlobal("fetch", fetchMock);

		const provider = new OpenAIProvider({ apiKey: "sk-test" });
		const response = await provider.chat([{ role: "user", content: "hi" }]);

		expect(response).toBe("Hello from OpenAI");
		expect(fetchMock).toHaveBeenCalledWith(
			"https://api.openai.com/v1/chat/completions",
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({
					Authorization: "Bearer sk-test",
				}),
			}),
		);
		const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
		expect(body.model).toBe("gpt-4o-mini");
		expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
	});

	it("throws on API error", async () => {
		vi.stubGlobal("fetch", async () => ({
			ok: false,
			text: async () => "Unauthorized",
		}));

		const provider = new OpenAIProvider({ apiKey: "bad" });
		await expect(provider.chat([{ role: "user", content: "hi" }])).rejects.toThrow(
			"OpenAI request failed",
		);
	});
});
