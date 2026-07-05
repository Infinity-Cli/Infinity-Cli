/**
 * Thin re-export of the provider key classifier from `../providers/key-classifier.js`.
 * All other onboarding code can import from this module.
 */
export {
	type ProviderId,
	type ClassificationResult,
	classifyProvider,
	PROVIDER_DEFAULT_MODELS,
} from "../providers/key-classifier.js";
