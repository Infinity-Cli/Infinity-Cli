export interface ChatMessage {
	role: string;
	content: string;
}

export interface ChatOptions {
	model?: string;
	temperature?: number;
	maxTokens?: number;
}

export abstract class Provider {
	abstract readonly name: string;

	abstract chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;
}

export class ProviderError extends Error {
	constructor(
		message: string,
		public readonly provider?: string,
		public readonly cause?: unknown,
	) {
		super(message);
		this.name = "ProviderError";
	}
}
