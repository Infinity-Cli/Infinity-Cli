import { type OpenAIConfig, OpenAIProvider } from "./openai.js";

export interface NvidiaConfig extends OpenAIConfig {}

export class NvidiaProvider extends OpenAIProvider {
	override readonly name: string = "nvidia";

	constructor(config: NvidiaConfig) {
		super({
			...config,
			baseUrl: config.baseUrl ?? "https://integrate.api.nvidia.com/v1",
			model: config.model ?? "meta/llama3-70b-instruct",
		});
	}
}
