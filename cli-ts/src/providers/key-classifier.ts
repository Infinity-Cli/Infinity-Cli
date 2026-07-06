export type ProviderId =
	| "openai"
	| "anthropic"
	| "gemini"
	| "groq"
	| "openrouter"
	| "ollama"
	| "nvidia";

export interface ProviderKeySpec {
	id: ProviderId;
	name: string;
	patterns: RegExp[];
	defaultModel: string;
	baseUrl: string;
}

export const PROVIDER_KEY_SPECS: ProviderKeySpec[] = [
	{
		id: "openrouter",
		name: "OpenRouter",
		patterns: [/^sk-or-[a-zA-Z0-9_\-]+$/i],
		defaultModel: "openai/gpt-4o-mini",
		baseUrl: "https://openrouter.ai/api/v1",
	},
	{
		id: "anthropic",
		name: "Anthropic",
		patterns: [/^sk-ant-[a-zA-Z0-9_\-]{32,}$/i],
		defaultModel: "claude-3-5-sonnet-20240620",
		baseUrl: "https://api.anthropic.com/v1",
	},
	{
		id: "groq",
		name: "Groq",
		patterns: [/^gsk_[a-zA-Z0-9]{32,}$/i],
		defaultModel: "mixtral-8x7b-32768",
		baseUrl: "https://api.groq.com/openai/v1",
	},
	{
		id: "gemini",
		name: "Google Gemini",
		patterns: [/^AIza[a-zA-Z0-9_\-]{35,}$/],
		defaultModel: "gemini-1.5-flash",
		baseUrl: "https://generativelanguage.googleapis.com/v1beta",
	},
	{
		id: "openai",
		name: "OpenAI",
		patterns: [
			/^sk-proj-[a-zA-Z0-9_\-]+$/i,
			/^sk-test-[a-zA-Z0-9_\-]+$/i,
			/^sk-[a-zA-Z0-9]{20,}$/i,
		],
		defaultModel: "gpt-4o-mini",
		baseUrl: "https://api.openai.com/v1",
	},
	{
		id: "nvidia",
		name: "NVIDIA",
		patterns: [/^nvapi-[a-zA-Z0-9_\-]+$/i],
		defaultModel: "meta/llama3-70b-instruct",
		baseUrl: "https://integrate.api.nvidia.com/v1",
	},
];

function findSpecOrThrow(id: ProviderId): ProviderKeySpec {
	const spec = PROVIDER_KEY_SPECS.find((s) => s.id === id);
	if (!spec) {
		throw new Error(`Missing key spec for provider: ${id}`);
	}
	return spec;
}

export const PROVIDER_KEY_SPEC_BY_ID: Record<ProviderId, ProviderKeySpec> = {
	openai: findSpecOrThrow("openai"),
	anthropic: findSpecOrThrow("anthropic"),
	gemini: findSpecOrThrow("gemini"),
	groq: findSpecOrThrow("groq"),
	openrouter: findSpecOrThrow("openrouter"),
	nvidia: findSpecOrThrow("nvidia"),
	ollama: {
		id: "ollama",
		name: "Ollama",
		patterns: [],
		defaultModel: "qwen2.5-coder:7b",
		baseUrl: "http://localhost:11434",
	},
};

export function validateKeyFormat(key: string, providerId: ProviderId): boolean {
	const spec = PROVIDER_KEY_SPEC_BY_ID[providerId];
	if (!spec) {
		return false;
	}
	if (providerId === "ollama") {
		return true;
	}
	return spec.patterns.some((pattern) => pattern.test(key));
}

export function classifyApiKey(key: string): ProviderId | null {
	const trimmed = key.trim();
	if (!trimmed) {
		return null;
	}
	for (const spec of PROVIDER_KEY_SPECS) {
		if (spec.patterns.some((pattern) => pattern.test(trimmed))) {
			return spec.id;
		}
	}
	return null;
}

export function getDefaultModel(providerId: ProviderId): string {
	return PROVIDER_KEY_SPEC_BY_ID[providerId]?.defaultModel ?? "gpt-4o-mini";
}

export function getBaseUrl(providerId: ProviderId): string {
	return PROVIDER_KEY_SPEC_BY_ID[providerId]?.baseUrl ?? "https://api.openai.com/v1";
}

/**
 * Classification result with confidence score (0-1).
 */
export interface ClassificationResult {
	provider: ProviderId;
	confidence: number;
}

/**
 * Classify an API key string, returning the most likely provider and a
 * confidence score (0-1). Returns null when no known pattern matches.
 * Uses more specific patterns (e.g. sk-proj- before sk-) and length hints.
 */
export function classifyProvider(apiKey: string): ClassificationResult | null {
	const trimmed = apiKey.trim();
	if (!trimmed) {
		return null;
	}

	const candidates: Array<{ provider: ProviderId; matchStrength: number }> = [];

	for (const spec of PROVIDER_KEY_SPECS) {
		for (const pattern of spec.patterns) {
			const match = trimmed.match(pattern);
			if (match) {
				const fullMatch = match[0];
				const matchRatio = fullMatch.length / Math.max(trimmed.length, 1);

				let confidence = matchRatio;
				// Lower confidence for generic sk- patterns
				if (spec.id === "openai" && pattern.source.includes("sk-")) {
					confidence = Math.min(confidence, 0.85);
				}
				candidates.push({ provider: spec.id, matchStrength: confidence });
			}
		}
	}

	if (candidates.length === 0) {
		return null;
	}

	candidates.sort((a, b) => b.matchStrength - a.matchStrength);
	const best = candidates[0];

	return {
		provider: best.provider,
		confidence: Math.min(Math.round(best.matchStrength * 100) / 100, 1.0),
	};
}

/**
 * Default model name per provider. Used during onboarding when the
 * user hasn't explicitly chosen a model.
 */
export const PROVIDER_DEFAULT_MODELS: Record<ProviderId, string> = {
	openai: "gpt-4o-mini",
	anthropic: "claude-3-5-sonnet-20240620",
	gemini: "gemini-1.5-flash",
	groq: "mixtral-8x7b-32768",
	openrouter: "openai/gpt-4o-mini",
	ollama: "qwen2.5-coder:7b",
	nvidia: "meta/llama3-70b-instruct",
};
