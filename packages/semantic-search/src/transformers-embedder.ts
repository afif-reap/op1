/**
 * TransformersEmbedder
 *
 * Local embedding generation using @huggingface/transformers.
 * Runs entirely on-device without requiring external API keys.
 * 
 * Recommended models:
 * - Xenova/all-MiniLM-L6-v2: 384 dims, ~80MB, fastest
 * - Xenova/bge-small-en-v1.5: 384 dims, ~130MB, better accuracy
 * - Xenova/all-mpnet-base-v2: 768 dims, ~400MB, best accuracy
 */

import type { Embedder } from "./types";

// Lazy-loaded pipeline to avoid startup cost
let pipelineInstance: any = null;
let pipelinePromise: Promise<any> | null = null;

/**
 * Simple LRU cache for embeddings (shared with OpenAIEmbedder pattern)
 */
class EmbeddingCache {
	private cache: Map<string, number[]> = new Map();
	private maxSize: number;

	constructor(maxSize = 1000) {
		this.maxSize = maxSize;
	}

	get(key: string): number[] | undefined {
		const value = this.cache.get(key);
		if (value) {
			// Move to end (most recently used)
			this.cache.delete(key);
			this.cache.set(key, value);
		}
		return value;
	}

	set(key: string, value: number[]): void {
		// Evict oldest if at capacity
		if (this.cache.size >= this.maxSize) {
			const firstKey = this.cache.keys().next().value;
			if (firstKey) this.cache.delete(firstKey);
		}
		this.cache.set(key, value);
	}

	has(key: string): boolean {
		return this.cache.has(key);
	}

	clear(): void {
		this.cache.clear();
	}

	size(): number {
		return this.cache.size;
	}
}

export interface TransformersEmbedderOptions {
	/**
	 * Model to use for embeddings.
	 * @default "Xenova/all-MiniLM-L6-v2"
	 */
	model?: string;
	/**
	 * Embedding dimension (must match model output).
	 * - all-MiniLM-L6-v2: 384
	 * - bge-small-en-v1.5: 384
	 * - all-mpnet-base-v2: 768
	 * @default 384
	 */
	dimension?: number;
	/**
	 * Use quantized model for faster inference.
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
 * Local embedder using Hugging Face Transformers.js
 * 
 * Runs entirely on-device without external API calls.
 * First run downloads the model (~80MB for MiniLM).
 */
export class TransformersEmbedder implements Embedder {
	readonly dimension: number;
	private model: string;
	private quantized: boolean;
	private cache: EmbeddingCache;
	private onProgress?: TransformersEmbedderOptions["onProgress"];
	private extractor: any = null;

	constructor(options: TransformersEmbedderOptions = {}) {
		this.model = options.model || "Xenova/all-MiniLM-L6-v2";
		this.dimension = options.dimension || 384;
		this.quantized = options.quantized ?? true;
		this.cache = new EmbeddingCache(options.cacheSize || 1000);
		this.onProgress = options.onProgress;
	}

	/**
	 * Initialize the transformer pipeline (lazy-loaded).
	 * This downloads the model on first use.
	 */
	private async getExtractor(): Promise<any> {
		if (this.extractor) {
			return this.extractor;
		}

		// Use singleton pattern to avoid loading model multiple times
		if (pipelineInstance && pipelinePromise === null) {
			this.extractor = pipelineInstance;
			return this.extractor;
		}

		if (pipelinePromise) {
			this.extractor = await pipelinePromise;
			return this.extractor;
		}

		pipelinePromise = this.loadPipeline();
		this.extractor = await pipelinePromise;
		pipelineInstance = this.extractor;
		pipelinePromise = null;

		return this.extractor;
	}

	private async loadPipeline(): Promise<any> {
		try {
			// Dynamic import to avoid bundling issues
			const { pipeline, env } = await import("@huggingface/transformers");

			// Configure cache directory (uses ~/.cache/huggingface by default)
			// env.cacheDir = "./.opencode/transformers-cache";

			// Disable remote model loading if we want offline-only
			// env.allowRemoteModels = true;

			const extractor = await pipeline("feature-extraction", this.model, {
				quantized: this.quantized,
				progress_callback: this.onProgress,
				dtype: "fp32", // Explicitly set to suppress warning
			});

			return extractor;
		} catch (error) {
			const err = error as Error;
			if (err.message?.includes("Cannot find package")) {
				throw new Error(
					"@huggingface/transformers is not installed. Run: bun add @huggingface/transformers"
				);
			}
			throw error;
		}
	}

	async embed(text: string): Promise<number[]> {
		// Check cache first
		const cached = this.cache.get(text);
		if (cached) return cached;

		const extractor = await this.getExtractor();

		const output = await extractor(text, {
			pooling: "mean",
			normalize: true,
		});

		// Convert Tensor to array
		const embedding = Array.from(output.data as Float32Array).slice(0, this.dimension);

		// Cache the result
		this.cache.set(text, embedding);

		return embedding;
	}

	async embedBatch(texts: string[]): Promise<number[][]> {
		// Separate cached and uncached texts
		const results: (number[] | null)[] = new Array(texts.length).fill(null);
		const uncachedIndices: number[] = [];
		const uncachedTexts: string[] = [];

		for (let i = 0; i < texts.length; i++) {
			const cached = this.cache.get(texts[i]);
			if (cached) {
				results[i] = cached;
			} else {
				uncachedIndices.push(i);
				uncachedTexts.push(texts[i]);
			}
		}

		// If all cached, return immediately
		if (uncachedTexts.length === 0) {
			return results as number[][];
		}

		const extractor = await this.getExtractor();

		// Process in batches to avoid memory issues
		const batchSize = 32; // Smaller batch for local processing
		for (let i = 0; i < uncachedTexts.length; i += batchSize) {
			const batchTexts = uncachedTexts.slice(i, i + batchSize);
			const batchIndices = uncachedIndices.slice(i, i + batchSize);

			const output = await extractor(batchTexts, {
				pooling: "mean",
				normalize: true,
			});

			// Output shape is [batch_size, dimension]
			const data = output.data as Float32Array;
			const embeddingDim = output.dims[1];

			for (let j = 0; j < batchTexts.length; j++) {
				const start = j * embeddingDim;
				const end = start + this.dimension;
				const embedding = Array.from(data.slice(start, end));

				const originalIndex = batchIndices[j];
				results[originalIndex] = embedding;

				// Cache the embedding
				this.cache.set(texts[originalIndex], embedding);
			}
		}

		return results as number[][];
	}

	/**
	 * Get cache statistics
	 */
	getCacheStats(): { size: number; maxSize: number } {
		return {
			size: this.cache.size(),
			maxSize: 1000,
		};
	}

	/**
	 * Clear the embedding cache
	 */
	clearCache(): void {
		this.cache.clear();
	}

	/**
	 * Check if the model is loaded
	 */
	isLoaded(): boolean {
		return this.extractor !== null;
	}

	/**
	 * Get model information
	 */
	getModelInfo(): { model: string; dimension: number; quantized: boolean } {
		return {
			model: this.model,
			dimension: this.dimension,
			quantized: this.quantized,
		};
	}
}

/**
 * Check if Transformers.js is available
 */
export async function isTransformersAvailable(): Promise<boolean> {
	try {
		await import("@huggingface/transformers");
		return true;
	} catch {
		return false;
	}
}

/**
 * Recommended model configurations
 */
export const TRANSFORMERS_MODELS = {
	/** Fastest, smallest - good for most use cases */
	MINI_LM: {
		model: "Xenova/all-MiniLM-L6-v2",
		dimension: 384,
	},
	/** Better accuracy, still fast */
	BGE_SMALL: {
		model: "Xenova/bge-small-en-v1.5",
		dimension: 384,
	},
	/** Best accuracy, larger model */
	MPNET: {
		model: "Xenova/all-mpnet-base-v2",
		dimension: 768,
	},
} as const;
