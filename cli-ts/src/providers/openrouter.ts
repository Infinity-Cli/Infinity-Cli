import { type ChatMessage, type ChatOptions, Provider, ProviderError } from "./base.js";

export interface OpenRouterConfig {
	apiKey: string;
	baseUrl?: string;
	model?: string;
	referer?: string;
	title?: string;
}

export class OpenRouterProvider extends Provider {
	readonly name = "openrouter";

	private readonly baseUrl: string;
	private readonly apiKey: string;
	private readonly model: string;
	private readonly referer?: string;
	private readonly title?: string;

	constructor(config: OpenRouterConfig) {
		super();
		this.baseUrl = config.baseUrl ?? "https://openrouter.ai/api/v1";
		this.apiKey = config.apiKey;
		this.model = config.model ?? "openai/gpt-4o-mini";
		this.referer = config.referer;
		this.title = config.title;
	}

	async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
		const model = options?.model ?? this.model;
		const body: Record<string, unknown> = {
			model,
			messages,
		};
		if (options?.temperature !== undefined) {
			body.temperature = options.temperature;
		}
		if (options?.maxTokens !== undefined) {
			body.max_tokens = options.maxTokens;
		}

		const headers: Record<string, string> = {
			Authorization: `Bearer ${this.apiKey}`,
			"Content-Type": "application/json",
		};
		if (this.referer) {
			headers["HTTP-Referer"] = this.referer;
		}
		if (this.title) {
			headers["X-Title"] = this.title;
		}

		const response = await fetch(`${this.baseUrl}/chat/completions`, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			const text = await response.text().catch(() => "Unknown error");
			throw new ProviderError(`OpenRouter request failed (${response.status}): ${text}`, this.name);
		}

		const data = (await response.json()) as {
			choices?: Array<{ message?: { content?: string } }>;
		};
		const content = data.choices?.[0]?.message?.content;
		if (typeof content !== "string") {
			throw new ProviderError("OpenRouter response missing content", this.name);
		}
		return content;
	}
}
