/**
 * Embedder
 *
 * Abstract embedder interface with OpenAI-compatible implementation.
 * Users can provide their own embedder or use the built-in one.
 * Includes LRU cache for embedding deduplication.
 */

import type { Embedder } from "./types";

/**
 * Simple LRU cache for embeddings
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

/**
 * OpenAI-compatible embedder with caching
 * Works with OpenAI API, Azure OpenAI, and compatible APIs (Ollama, etc.)
 */
export class OpenAIEmbedder implements Embedder {
	private apiKey: string;
	private baseUrl: string;
	private model: string;
	readonly dimension: number;
	private cache: EmbeddingCache;
	private maxBatchSize: number;

	constructor(options: {
		apiKey?: string;
		baseUrl?: string;
		model?: string;
		dimension?: number;
		cacheSize?: number;
		maxBatchSize?: number;
	} = {}) {
		this.apiKey = options.apiKey || process.env.OPENAI_API_KEY || "";
		this.baseUrl = options.baseUrl || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
		this.model = options.model || "text-embedding-3-small";
		this.dimension = options.dimension || 768;
		this.cache = new EmbeddingCache(options.cacheSize || 1000);
		this.maxBatchSize = options.maxBatchSize || 100; // Increased from 20 to 100
	}

	async embed(text: string): Promise<number[]> {
		// Check cache first
		const cached = this.cache.get(text);
		if (cached) return cached;

		const embeddings = await this.embedBatch([text]);
		return embeddings[0];
	}

	async embedBatch(texts: string[]): Promise<number[][]> {
		if (!this.apiKey) {
			throw new Error("OpenAI API key not configured. Set OPENAI_API_KEY environment variable.");
		}

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

		// Process uncached texts in batches of maxBatchSize
		for (let i = 0; i < uncachedTexts.length; i += this.maxBatchSize) {
			const batchTexts = uncachedTexts.slice(i, i + this.maxBatchSize);
			const batchIndices = uncachedIndices.slice(i, i + this.maxBatchSize);

			const response = await fetch(`${this.baseUrl}/embeddings`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Authorization": `Bearer ${this.apiKey}`,
				},
				body: JSON.stringify({
					model: this.model,
					input: batchTexts,
					dimensions: this.dimension,
				}),
			});

			if (!response.ok) {
				const error = await response.text();
				throw new Error(`Embedding API error: ${response.status} - ${error}`);
			}

			const data = await response.json() as {
				data: Array<{ embedding: number[]; index: number }>;
			};

			// Sort by index to maintain order
			const sorted = data.data.sort((a, b) => a.index - b.index);

			// Store results and cache
			for (let j = 0; j < sorted.length; j++) {
				const embedding = sorted[j].embedding;
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
}

/**
 * Mock embedder for testing (generates random vectors)
 */
export class MockEmbedder implements Embedder {
	readonly dimension: number;

	constructor(dimension: number = 768) {
		this.dimension = dimension;
	}

	async embed(text: string): Promise<number[]> {
		// Generate deterministic pseudo-random vector based on text hash
		const hash = this.simpleHash(text);
		const vector: number[] = [];
		for (let i = 0; i < this.dimension; i++) {
			vector.push(Math.sin(hash + i) * 0.5 + 0.5);
		}
		return vector;
	}

	async embedBatch(texts: string[]): Promise<number[][]> {
		return Promise.all(texts.map((t) => this.embed(t)));
	}

	private simpleHash(str: string): number {
		let hash = 0;
		for (let i = 0; i < str.length; i++) {
			const char = str.charCodeAt(i);
			hash = ((hash << 5) - hash) + char;
			hash = hash & hash;
		}
		return hash;
	}
}
