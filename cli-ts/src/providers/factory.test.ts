import { describe, expect, it } from "vitest";
import { createProvider, resolveProvider } from "./factory.js";
import { OllamaProvider } from "./ollama.js";
import { OpenAIProvider } from "./openai.js";

describe("createProvider", () => {
	it("creates an OpenAI provider", () => {
		const provider = createProvider("openai", { apiKey: "sk-test" });
		expect(provider).toBeInstanceOf(OpenAIProvider);
	});

	it("creates an Ollama provider", () => {
		const provider = createProvider("ollama", {});
		expect(provider).toBeInstanceOf(OllamaProvider);
	});

	it("throws for unknown providers", () => {
		expect(() => createProvider("unknown", {})).toThrow("Unknown provider: unknown");
	});
});

describe("resolveProvider", () => {
	it("returns the default provider when no keys are configured", () => {
		const resolved = resolveProvider({
			provider: "openai",
			model: "gpt-4o-mini",
			apiKeys: {},
			providers: [],
			defaultProvider: "openai",
			serverUrl: "http://127.0.0.1:8000",
		});
		expect(resolved.id).toBe("openai");
	});

	it("prefers the configured default provider", () => {
		const resolved = resolveProvider({
			provider: "anthropic",
			model: "claude-3",
			apiKeys: { anthropic: "sk-ant", openai: "sk-test" },
			providers: [],
			defaultProvider: "anthropic",
			serverUrl: "http://127.0.0.1:8000",
		});
		expect(resolved.id).toBe("anthropic");
		expect(resolved.config).toEqual({ apiKey: "sk-ant" });
	});

	it("falls back to the first configured provider", () => {
		const resolved = resolveProvider({
			provider: "openai",
			model: "gpt-4o-mini",
			apiKeys: { ollama: "" },
			providers: [],
			defaultProvider: "openai",
			serverUrl: "http://127.0.0.1:8000",
		});
		expect(resolved.id).toBe("ollama");
	});
});
