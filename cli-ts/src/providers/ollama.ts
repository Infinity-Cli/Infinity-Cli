import { type ChatMessage, type ChatOptions, Provider, ProviderError } from "./base.js";

export interface OllamaConfig {
	baseUrl?: string;
	model?: string;
}

export class OllamaProvider extends Provider {
	readonly name = "ollama";

	private readonly baseUrl: string;
	private readonly model: string;

	constructor(config: OllamaConfig) {
		super();
		this.baseUrl = config.baseUrl ?? "http://localhost:11434";
		this.model = config.model ?? "qwen2.5-coder:7b";
	}

	async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
		const model = options?.model ?? this.model;
		const body: Record<string, unknown> = {
			model,
			messages,
			stream: false,
		};
		if (options?.temperature !== undefined) {
			body.options = { temperature: options.temperature };
		}

		const response = await fetch(`${this.baseUrl}/api/chat`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			const text = await response.text().catch(() => "Unknown error");
			throw new ProviderError(`Ollama request failed (${response.status}): ${text}`, this.name);
		}

		const data = (await response.json()) as {
			message?: { content?: string };
		};
		const content = data.message?.content;
		if (typeof content !== "string") {
			throw new ProviderError("Ollama response missing content", this.name);
		}
		return content;
	}
}
