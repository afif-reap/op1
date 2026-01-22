/**
 * Embedder Factory
 *
 * Auto-detects and creates the best available embedder:
 * 1. Transformers.js (local, no API key needed) - PREFERRED
 * 2. OpenAI-compatible (requires OPENAI_API_KEY or custom baseUrl)
 * 
 * Priority:
 * - If OPENAI_API_KEY is set → use OpenAI (user explicitly configured)
 * - If @huggingface/transformers is installed → use local Transformers
 * - Otherwise → throw error with instructions
 */

import type { Embedder } from "./types";
import { OpenAIEmbedder } from "./embedder";
import { TransformersEmbedder, isTransformersAvailable, TRANSFORMERS_MODELS } from "./transformers-embedder";

export type EmbedderType = "transformers" | "openai" | "auto";

export interface EmbedderFactoryOptions {
	/**
	 * Force a specific embedder type.
	 * @default "auto"
	 */
	type?: EmbedderType;
	/**
	 * Embedding dimension. Must match the model.
	 * - Transformers MiniLM/BGE: 384
	 * - Transformers MPNet: 768
	 * - OpenAI text-embedding-3-small: 768 (configurable)
	 * @default 384 for transformers, 768 for openai
	 */
	dimension?: number;
	/**
	 * Model to use.
	 * - Transformers: "Xenova/all-MiniLM-L6-v2", "Xenova/bge-small-en-v1.5", etc.
	 * - OpenAI: "text-embedding-3-small", "text-embedding-ada-002", etc.
	 */
	model?: string;
	/**
	 * OpenAI API key (for openai type).
	 */
	apiKey?: string;
	/**
	 * OpenAI base URL (for openai type, e.g., Ollama endpoint).
	 */
	baseUrl?: string;
	/**
	 * Use quantized models for Transformers.js.
	 * @default true
	 */
	quantized?: boolean;
	/**
	 * Cache size for embeddings.
	 * @default 1000
	 */
	cacheSize?: number;
	/**
	 * Progress callback for model download.
	 */
	onProgress?: (progress: { status: string; progress?: number; file?: string }) => void;
}

/**
 * Detected embedder configuration
 */
export interface EmbedderConfig {
	type: "transformers" | "openai";
	model: string;
	dimension: number;
	reason: string;
}

/**
 * Detect which embedder to use based on environment
 */
export async function detectEmbedder(): Promise<EmbedderConfig> {
	const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
	const hasCustomBaseUrl = !!process.env.OPENAI_BASE_URL;

	// If user has explicitly set OpenAI credentials, prefer that
	if (hasOpenAIKey) {
		return {
			type: "openai",
			model: "text-embedding-3-small",
			dimension: 768,
			reason: "OPENAI_API_KEY environment variable is set",
		};
	}

	// Check if Transformers.js is available
	const transformersAvailable = await isTransformersAvailable();
	if (transformersAvailable) {
		return {
			type: "transformers",
			model: TRANSFORMERS_MODELS.MINI_LM.model,
			dimension: TRANSFORMERS_MODELS.MINI_LM.dimension,
			reason: "@huggingface/transformers is installed (local embeddings)",
		};
	}

	// If custom base URL is set (e.g., Ollama), try OpenAI-compatible
	if (hasCustomBaseUrl) {
		return {
			type: "openai",
			model: "nomic-embed-text", // Common Ollama model
			dimension: 768,
			reason: "OPENAI_BASE_URL is set (assuming Ollama or compatible API)",
		};
	}

	// No embedder available
	throw new Error(
		`No embedding provider available. Options:\n` +
		`  1. Install local embeddings: bun add @huggingface/transformers\n` +
		`  2. Set OPENAI_API_KEY environment variable\n` +
		`  3. Set OPENAI_BASE_URL for Ollama (e.g., http://localhost:11434/v1)`
	);
}

/**
 * Create an embedder based on configuration
 */
export async function createEmbedder(options: EmbedderFactoryOptions = {}): Promise<Embedder> {
	const type = options.type || "auto";

	if (type === "openai") {
		return new OpenAIEmbedder({
			apiKey: options.apiKey,
			baseUrl: options.baseUrl,
			model: options.model,
			dimension: options.dimension || 768,
			cacheSize: options.cacheSize,
		});
	}

	if (type === "transformers") {
		const transformersAvailable = await isTransformersAvailable();
		if (!transformersAvailable) {
			throw new Error(
				"Transformers.js is not installed. Run: bun add @huggingface/transformers"
			);
		}
		return new TransformersEmbedder({
			model: options.model || TRANSFORMERS_MODELS.MINI_LM.model,
			dimension: options.dimension || TRANSFORMERS_MODELS.MINI_LM.dimension,
			quantized: options.quantized,
			cacheSize: options.cacheSize,
			onProgress: options.onProgress,
		});
	}

	// Auto-detect
	const config = await detectEmbedder();

	if (config.type === "transformers") {
		return new TransformersEmbedder({
			model: options.model || config.model,
			dimension: options.dimension || config.dimension,
			quantized: options.quantized,
			cacheSize: options.cacheSize,
			onProgress: options.onProgress,
		});
	}

	return new OpenAIEmbedder({
		apiKey: options.apiKey,
		baseUrl: options.baseUrl,
		model: options.model || config.model,
		dimension: options.dimension || config.dimension,
		cacheSize: options.cacheSize,
	});
}

/**
 * Get embedder info without creating it
 */
export async function getEmbedderInfo(): Promise<EmbedderConfig> {
	return detectEmbedder();
}
