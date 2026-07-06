import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AskEngineError, askOnce } from "./ask-engine.js";

const { readConfigMock, createProviderMock, resolveProviderMock } = vi.hoisted(() => ({
	readConfigMock: vi.fn(),
	createProviderMock: vi.fn(),
	resolveProviderMock: vi.fn(),
}));

vi.mock("./config.js", () => ({
	readConfig: readConfigMock,
}));

vi.mock("./providers/factory.js", () => ({
	createProvider: createProviderMock,
	resolveProvider: resolveProviderMock,
}));

const { addMessageMock, getMessagesMock, getSessionMock, createSessionMock } = vi.hoisted(() => ({
	addMessageMock: vi.fn(),
	getMessagesMock: vi.fn(),
	getSessionMock: vi.fn(),
	createSessionMock: vi.fn(),
}));

vi.mock("./memory/index.js", () => ({
	MemoryManager: vi.fn(() => ({
		addMessage: addMessageMock,
		getMessages: getMessagesMock,
		getSession: getSessionMock,
		createSession: createSessionMock,
	})),
}));

describe("askOnce", () => {
	const session = { id: "session-1" };

	beforeEach(() => {
		getSessionMock.mockReturnValue(session);
		resolveProviderMock.mockReturnValue({ id: "openai", config: { apiKey: "sk-test" } });

		const messages: Array<{ role: "user" | "assistant" | "system"; content: string }> = [];
		addMessageMock.mockImplementation((_sessionId, role, content) => {
			messages.push({ role, content });
		});
		getMessagesMock.mockImplementation(() => messages);
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("uses provider override when supplied", async () => {
		readConfigMock.mockReturnValue({
			provider: "openai",
			model: "gpt-4o-mini",
			apiKeys: { anthropic: "sk-ant" },
			providers: [],
			defaultProvider: "openai",
			serverUrl: "http://127.0.0.1:8000",
		});
		createProviderMock.mockReturnValue({
			chat: vi.fn().mockResolvedValue("hello"),
		});

		const result = await askOnce("test prompt", { provider: "anthropic" });

		expect(createProviderMock).toHaveBeenCalledWith("anthropic", { apiKey: "sk-ant" });
		expect(result.providerId).toBe("anthropic");
		expect(result.response).toBe("hello");
	});

	it("uses model override when supplied", async () => {
		readConfigMock.mockReturnValue({
			provider: "openai",
			model: "gpt-4o-mini",
			apiKeys: { openai: "sk-test" },
			providers: [],
			defaultProvider: "openai",
			serverUrl: "http://127.0.0.1:8000",
		});
		const chatMock = vi.fn().mockResolvedValue("ok");
		createProviderMock.mockReturnValue({ chat: chatMock });

		const result = await askOnce("test prompt", { model: "custom-model" });

		expect(result.model).toBe("custom-model");
		expect(chatMock).toHaveBeenCalledWith([{ role: "user", content: "test prompt" }], {
			model: "custom-model",
		});
	});

	it("throws when provider override requires an API key but none is configured", async () => {
		readConfigMock.mockReturnValue({
			provider: "openai",
			model: "gpt-4o-mini",
			apiKeys: {},
			providers: [],
			defaultProvider: "openai",
			serverUrl: "http://127.0.0.1:8000",
		});

		await expect(askOnce("test prompt", { provider: "openai" })).rejects.toThrow(
			new AskEngineError("API key not set for provider 'openai'", "API_KEY_MISSING", "openai"),
		);
		expect(createProviderMock).not.toHaveBeenCalled();
	});

	it("allows ollama without an API key", async () => {
		readConfigMock.mockReturnValue({
			provider: "ollama",
			model: "qwen2.5-coder:7b",
			apiKeys: {},
			providers: [],
			defaultProvider: "ollama",
			serverUrl: "http://127.0.0.1:8000",
		});
		createProviderMock.mockReturnValue({
			chat: vi.fn().mockResolvedValue("ollama response"),
		});

		const result = await askOnce("test prompt", { provider: "ollama" });

		expect(createProviderMock).toHaveBeenCalledWith("ollama", {});
		expect(result.providerId).toBe("ollama");
		expect(result.response).toBe("ollama response");
	});

	it("returns empty response and does not call provider in dry-run mode", async () => {
		readConfigMock.mockReturnValue({
			provider: "openai",
			model: "gpt-4o-mini",
			apiKeys: { openai: "sk-test" },
			providers: [],
			defaultProvider: "openai",
			serverUrl: "http://127.0.0.1:8000",
		});

		const result = await askOnce("test prompt", { dryRun: true, provider: "openai" });

		expect(createProviderMock).not.toHaveBeenCalled();
		expect(result.response).toBe("");
		expect(result.providerId).toBe("openai");
		expect(result.model).toBe("gpt-4o-mini");
	});

	it("creates a session when one does not exist", async () => {
		getSessionMock.mockReturnValue(undefined);
		createSessionMock.mockReturnValue(session);
		readConfigMock.mockReturnValue({
			provider: "openai",
			model: "gpt-4o-mini",
			apiKeys: { openai: "sk-test" },
			providers: [],
			defaultProvider: "openai",
			serverUrl: "http://127.0.0.1:8000",
		});
		createProviderMock.mockReturnValue({
			chat: vi.fn().mockResolvedValue("hello"),
		});

		await askOnce("test prompt", { session: "new-session" });

		expect(createSessionMock).toHaveBeenCalledWith("new-session");
		expect(addMessageMock).toHaveBeenCalledWith("session-1", "assistant", "hello");
	});

	it("passes the full session history to the provider", async () => {
		readConfigMock.mockReturnValue({
			provider: "openai",
			model: "gpt-4o-mini",
			apiKeys: { openai: "sk-test" },
			providers: [],
			defaultProvider: "openai",
			serverUrl: "http://127.0.0.1:8000",
		});
		const chatMock = vi.fn().mockResolvedValue("follow-up answer");
		createProviderMock.mockReturnValue({ chat: chatMock });

		addMessageMock("session-1", "user", "first question");
		addMessageMock("session-1", "assistant", "first answer");

		const result = await askOnce("follow-up", {});

		expect(addMessageMock).toHaveBeenCalledWith("session-1", "user", "follow-up");
		expect(chatMock).toHaveBeenCalledWith(
			[
				{ role: "user", content: "first question" },
				{ role: "assistant", content: "first answer" },
				{ role: "user", content: "follow-up" },
			],
			{ model: "gpt-4o-mini" },
		);
		expect(result.response).toBe("follow-up answer");
	});
});
