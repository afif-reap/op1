/**
 * @op1/semantic-search - Semantic Code Search Plugin for OpenCode
 *
 * Natural language code search using embeddings and vector similarity.
 *
 * Tools provided:
 * - search_semantic: Search code using natural language
 * - find_similar: Find code similar to a snippet
 * - semantic_status: Get index status
 * - semantic_reindex: Rebuild the search index
 *
 * Performance features:
 * - Merkle tree cache for efficient change detection
 * - Debounced file watching for automatic updates
 * - Parallel file indexing with configurable concurrency
 * - Batch embedding with LRU cache (100 chunks per request)
 * 
 * Embedding providers (auto-detected):
 * - Transformers.js (local, no API key) - PREFERRED
 * - OpenAI-compatible (requires OPENAI_API_KEY)
 */

// Export plugin (default export for OpenCode plugin loader)
export { SemanticSearchPlugin } from "./plugin";
export { default } from "./plugin";

// Re-export types only (no classes that could be mistakenly called as functions)
// IMPORTANT: OpenCode plugin loader iterates all exports and tries to call them.
// Exporting classes at the top level causes "Cannot call a class constructor without |new|" errors.
export type { SqliteVecError } from "./vector-store";
export type { EmbedderFactoryOptions, EmbedderConfig, EmbedderType } from "./embedder-factory";
export type { TransformersEmbedderOptions } from "./transformers-embedder";
export type {
	Embedder,
	CodeChunk,
	EmbeddedChunk,
	SearchResult,
	IndexConfig,
	IndexStatus,
	FileChange,
} from "./types";
