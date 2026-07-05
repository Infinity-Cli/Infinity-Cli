import { type ChatMessage, type ChatOptions, Provider, ProviderError } from "./base.js";

export interface OpenAIConfig {
	apiKey: string;
	baseUrl?: string;
	model?: string;
}

export class OpenAIProvider extends Provider {
	readonly name: string = "openai";

	private readonly baseUrl: string;
	private readonly apiKey: string;
	private readonly model: string;

	constructor(config: OpenAIConfig) {
		super();
		this.baseUrl = config.baseUrl ?? "https://api.openai.com/v1";
		this.apiKey = config.apiKey;
		this.model = config.model ?? "gpt-4o-mini";
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

		const response = await fetch(`${this.baseUrl}/chat/completions`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			const text = await response.text().catch(() => "Unknown error");
			throw new ProviderError(`OpenAI request failed (${response.status}): ${text}`, this.name);
		}

		const data = (await response.json()) as {
			choices?: Array<{ message?: { content?: string } }>;
		};
		const content = data.choices?.[0]?.message?.content;
		if (typeof content !== "string") {
			throw new ProviderError("OpenAI response missing content", this.name);
		}
		return content;
	}
}
