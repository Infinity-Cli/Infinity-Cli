import { describe, expect, it } from "vitest";
import {
	PROVIDER_DEFAULT_MODELS,
	classifyApiKey,
	classifyProvider,
	getDefaultModel,
} from "./key-classifier.js";

describe("classifyProvider", () => {
	it("detects OpenAI key (sk-prefix, 51+ chars)", () => {
		const key = `sk-${"a".repeat(55)}${"B".repeat(5)}`;
		expect(key.length).toBeGreaterThanOrEqual(61);
		const result = classifyProvider(key);
		expect(result).not.toBeNull();
		expect(result?.provider).toBe("openai");
		expect(result?.confidence).toBeGreaterThanOrEqual(0.8);
	});

	it("detects OpenAI project key (sk-proj- prefix)", () => {
		const key = `sk-proj-${"a".repeat(30)}`;
		const result = classifyProvider(key);
		expect(result).not.toBeNull();
		expect(result?.provider).toBe("openai");
	});

	it("detects OpenAI test key (sk-test- prefix)", () => {
		const key = `sk-test-${"a".repeat(30)}`;
		const result = classifyProvider(key);
		expect(result).not.toBeNull();
		expect(result?.provider).toBe("openai");
	});

	it("detects Anthropic key (sk-ant- prefix)", () => {
		const key = `sk-ant-${"a".repeat(32)}${"b".repeat(8)}`;
		expect(key.length).toBeGreaterThanOrEqual(41);
		const result = classifyProvider(key);
		expect(result).not.toBeNull();
		expect(result?.provider).toBe("anthropic");
		expect(result?.confidence).toBeGreaterThanOrEqual(0.8);
	});

	it("detects Gemini key (AIza prefix, ~39 chars)", () => {
		const key = `AIza${"a".repeat(35)}`;
		expect(key.length).toBeGreaterThanOrEqual(39);
		const result = classifyProvider(key);
		expect(result).not.toBeNull();
		expect(result?.provider).toBe("gemini");
		expect(result?.confidence).toBeGreaterThanOrEqual(0.8);
	});

	it("detects Groq key (gsk_ prefix)", () => {
		const key = `gsk_${"a".repeat(32)}${"b".repeat(4)}`;
		expect(key.length).toBeGreaterThanOrEqual(37);
		const result = classifyProvider(key);
		expect(result).not.toBeNull();
		expect(result?.provider).toBe("groq");
		expect(result?.confidence).toBeGreaterThanOrEqual(0.8);
	});

	it("detects OpenRouter key (sk-or- prefix)", () => {
		const key = `sk-or-${"a".repeat(25)}`;
		const result = classifyProvider(key);
		expect(result).not.toBeNull();
		expect(result?.provider).toBe("openrouter");
		expect(result?.confidence).toBeGreaterThanOrEqual(0.8);
	});

	it("detects NVIDIA key (nvapi- prefix)", () => {
		const key = `nvapi-${"a".repeat(32)}`;
		const result = classifyProvider(key);
		expect(result).not.toBeNull();
		expect(result?.provider).toBe("nvidia");
		expect(result?.confidence).toBeGreaterThanOrEqual(0.8);
	});

	it("returns null for empty string", () => {
		expect(classifyProvider("")).toBeNull();
		expect(classifyProvider("   ")).toBeNull();
	});

	it("returns null for unrecognised key", () => {
		const result = classifyProvider("abc-def-12345");
		expect(result).toBeNull();
	});

	it("returns null for a very short key", () => {
		const result = classifyProvider("sk-abc");
		expect(result).toBeNull();
	});
});

describe("PROVIDER_DEFAULT_MODELS", () => {
	it("has a default model for every provider", () => {
		const providers = [
			"openai",
			"anthropic",
			"gemini",
			"groq",
			"openrouter",
			"ollama",
			"nvidia",
		] as const;
		for (const p of providers) {
			expect(PROVIDER_DEFAULT_MODELS[p]).toBeTypeOf("string");
			expect(PROVIDER_DEFAULT_MODELS[p].length).toBeGreaterThan(0);
		}
	});

	it("all default models are non-empty", () => {
		for (const model of Object.values(PROVIDER_DEFAULT_MODELS)) {
			expect(model.length).toBeGreaterThan(0);
		}
	});
});

describe("classifyProvider edge cases", () => {
	it("handles keys with surrounding whitespace", () => {
		const key = `  sk-${"n".repeat(51)}  `;
		const result = classifyProvider(key);
		expect(result).not.toBeNull();
		expect(result?.provider).toBe("openai");
	});

	it("prefers more specific pattern over generic (sk-proj- over sk-)", () => {
		// This key matches both sk-proj- and sk- patterns
		const key = `sk-proj-${"a".repeat(30)}`;
		const result = classifyProvider(key);
		expect(result).not.toBeNull();
		// sk-proj- is listed first so it should match that
		expect(result?.provider).toBe("openai");
	});
});

describe("classifyApiKey", () => {
	it("detects openai key", () => {
		expect(classifyApiKey(`sk-${"a".repeat(51)}`)).toBe("openai");
	});

	it("detects anthropic key", () => {
		expect(classifyApiKey(`sk-ant-${"a".repeat(32)}`)).toBe("anthropic");
	});

	it("detects nvidia key", () => {
		expect(classifyApiKey(`nvapi-${"a".repeat(32)}`)).toBe("nvidia");
	});

	it("returns null for empty input", () => {
		expect(classifyApiKey("")).toBeNull();
	});
});

describe("getDefaultModel", () => {
	it("returns a model for known providers", () => {
		expect(getDefaultModel("openai")).toBe("gpt-4o-mini");
		expect(getDefaultModel("anthropic")).toBe("claude-3-5-sonnet-20240620");
		expect(getDefaultModel("nvidia")).toBe("meta/llama3-70b-instruct");
	});

	it("falls back for unknown provider", () => {
		// @ts-expect-error - testing fallback with invalid id
		expect(getDefaultModel("unknown")).toBe("gpt-4o-mini");
	});
});
