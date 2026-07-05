import type { Config } from "../config.js";
import { ProviderError } from "./base.js";
import { PROVIDER_REGISTRY } from "./registry.js";

export function createProvider(id: string, config: unknown) {
	const ProviderClass = PROVIDER_REGISTRY[id];
	if (!ProviderClass) {
		throw new ProviderError(`Unknown provider: ${id}`);
	}
	return new ProviderClass(config as Record<string, unknown>);
}

export function resolveProvider(settings: Config): { id: string; config: unknown } {
	const providers = settings.apiKeys ? Object.keys(settings.apiKeys) : [];
	const defaultProvider = settings.defaultProvider ?? "openai";

	if (providers.length === 0) {
		return { id: defaultProvider, config: {} };
	}

	if (providers.includes(defaultProvider)) {
		return { id: defaultProvider, config: { apiKey: settings.apiKeys[defaultProvider] } };
	}

	const first = providers[0];
	return { id: first, config: { apiKey: settings.apiKeys[first] } };
}
