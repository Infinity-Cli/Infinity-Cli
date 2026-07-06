import { readConfig } from "./config.js";
import { MemoryManager } from "./memory/index.js";
import { createProvider, resolveProvider } from "./providers/factory.js";

export class AskEngineError extends Error {
	constructor(
		message: string,
		public readonly code: string,
		public readonly providerId?: string,
	) {
		super(message);
		this.name = "AskEngineError";
	}
}

export async function askOnce(
	prompt: string,
	options: { provider?: string; model?: string; session?: string; dryRun?: boolean },
): Promise<{ response: string; providerId: string; model: string }> {
	const config = readConfig();
	const memory = new MemoryManager();
	let session = memory.getSession(options.session ?? "default");
	if (!session) {
		session = memory.createSession(options.session ?? "default");
	}
	memory.addMessage(session.id, "user", prompt);

	let providerId = options.provider;
	let providerConfig: Record<string, unknown> = {};

	if (providerId) {
		if (providerId !== "ollama") {
			const apiKey = config.apiKeys[providerId];
			if (!apiKey) {
				throw new AskEngineError(
					`API key not set for provider '${providerId}'`,
					"API_KEY_MISSING",
					providerId,
				);
			}
			providerConfig.apiKey = apiKey;
		}
	} else {
		const resolved = resolveProvider(config);
		providerId = resolved.id;
		providerConfig = resolved.config as Record<string, unknown>;
	}

	const model = options.model ?? config.model;

	if (options.dryRun) {
		return { response: "", providerId, model };
	}

	const provider = createProvider(providerId, providerConfig);
	const history = memory.getMessages(session.id).map((m) => ({
		role: m.role,
		content: m.content,
	}));
	const response = await provider.chat(history, { model });
	memory.addMessage(session.id, "assistant", response);

	return { response, providerId, model };
}
