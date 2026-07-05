import { OpenAIProvider } from "./openai.js";

export interface GroqConfig {
	apiKey: string;
	baseUrl?: string;
	model?: string;
}

export class GroqProvider extends OpenAIProvider {
	readonly name = "groq";

	constructor(config: GroqConfig) {
		super({
			apiKey: config.apiKey,
			baseUrl: config.baseUrl ?? "https://api.groq.com/openai/v1",
			model: config.model ?? "mixtral-8x7b-32768",
		});
	}
}
