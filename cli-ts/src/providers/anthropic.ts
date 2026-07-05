import { type ChatMessage, type ChatOptions, Provider, ProviderError } from "./base.js";

export interface AnthropicConfig {
	apiKey: string;
	baseUrl?: string;
	model?: string;
}

export class AnthropicProvider extends Provider {
	readonly name = "anthropic";

	private readonly baseUrl: string;
	private readonly apiKey: string;
	private readonly model: string;

	constructor(config: AnthropicConfig) {
		super();
		this.baseUrl = config.baseUrl ?? "https://api.anthropic.com/v1";
		this.apiKey = config.apiKey;
		this.model = config.model ?? "claude-3-5-sonnet-20240620";
	}

	async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
		const model = options?.model ?? this.model;
		const body: Record<string, unknown> = {
			model,
			messages,
			max_tokens: options?.maxTokens ?? 4096,
		};
		if (options?.temperature !== undefined) {
			body.temperature = options.temperature;
		}

		const response = await fetch(`${this.baseUrl}/messages`, {
			method: "POST",
			headers: {
				"x-api-key": this.apiKey,
				"anthropic-version": "2023-06-01",
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			const text = await response.text().catch(() => "Unknown error");
			throw new ProviderError(`Anthropic request failed (${response.status}): ${text}`, this.name);
		}

		const data = (await response.json()) as {
			content?: Array<{ type?: string; text?: string }>;
		};
		const text = data.content?.find((c) => c.type === "text" || c.text)?.text;
		if (typeof text !== "string") {
			throw new ProviderError("Anthropic response missing content", this.name);
		}
		return text;
	}
}
