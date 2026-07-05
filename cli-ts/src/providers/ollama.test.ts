import { describe, expect, it, vi } from "vitest";
import { OllamaProvider } from "./ollama.js";

describe("OllamaProvider", () => {
	it("returns assistant content from a successful response", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ message: { content: "Hello from Ollama" } }),
		});
		vi.stubGlobal("fetch", fetchMock);

		const provider = new OllamaProvider({ baseUrl: "http://localhost:11434" });
		const response = await provider.chat([{ role: "user", content: "hi" }]);

		expect(response).toBe("Hello from Ollama");
		expect(fetchMock).toHaveBeenCalledWith(
			"http://localhost:11434/api/chat",
			expect.objectContaining({
				method: "POST",
				body: expect.stringContaining('"stream":false'),
			}),
		);
		const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
		expect(body.model).toBe("qwen2.5-coder:7b");
	});
});
