import { type ChatMessage, type ChatOptions, Provider, ProviderError } from "./base.js";

export interface GeminiConfig {
	apiKey: string;
	baseUrl?: string;
	model?: string;
}

export class GeminiProvider extends Provider {
	readonly name = "gemini";

	private readonly baseUrl: string;
	private readonly apiKey: string;
	private readonly model: string;

	constructor(config: GeminiConfig) {
		super();
		this.baseUrl = config.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
		this.apiKey = config.apiKey;
		this.model = config.model ?? "gemini-1.5-flash";
	}

	async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
		const model = options?.model ?? this.model;
		const contents = messages.map((m) => ({
			role: m.role === "assistant" ? "model" : m.role,
			parts: [{ text: m.content }],
		}));

		const body: Record<string, unknown> = { contents };
		const generationConfig: Record<string, unknown> = {};
		if (options?.temperature !== undefined) {
			generationConfig.temperature = options.temperature;
		}
		if (options?.maxTokens !== undefined) {
			generationConfig.maxOutputTokens = options.maxTokens;
		}
		if (Object.keys(generationConfig).length > 0) {
			body.generationConfig = generationConfig;
		}

		const url = new URL(`${this.baseUrl}/models/${model}:generateContent`);
		url.searchParams.set("key", this.apiKey);

		const response = await fetch(url.toString(), {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			const text = await response.text().catch(() => "Unknown error");
			throw new ProviderError(`Gemini request failed (${response.status}): ${text}`, this.name);
		}

		const data = (await response.json()) as {
			candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
		};
		const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
		if (typeof text !== "string") {
			throw new ProviderError("Gemini response missing content", this.name);
		}
		return text;
	}
}
