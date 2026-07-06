import { AnthropicProvider } from "./anthropic.js";
import type { Provider } from "./base.js";
import { GeminiProvider } from "./gemini.js";
import { GroqProvider } from "./groq.js";
import { NvidiaProvider } from "./nvidia.js";
import { OllamaProvider } from "./ollama.js";
import { OpenAIProvider } from "./openai.js";
import { OpenRouterProvider } from "./openrouter.js";

// biome-ignore lint/suspicious/noExplicitAny: registry unifies heterogeneous provider configs
export type ProviderConstructor = new (config: any) => Provider;

export const PROVIDER_REGISTRY: Record<string, ProviderConstructor> = {
	openai: OpenAIProvider,
	anthropic: AnthropicProvider,
	gemini: GeminiProvider,
	ollama: OllamaProvider,
	groq: GroqProvider,
	openrouter: OpenRouterProvider,
	nvidia: NvidiaProvider,
};

export function registerProvider(id: string, cls: ProviderConstructor): void {
	PROVIDER_REGISTRY[id] = cls;
}
