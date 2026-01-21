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
 */

// Re-export all modules
export * from "./types";
export * from "./chunker";
export * from "./embedder";
export * from "./vector-store";
export * from "./index-manager";
export * from "./merkle-cache";
export * from "./watcher";
export * from "./benchmark";
export * from "./tools";

// Export plugin
export { SemanticSearchPlugin } from "./plugin";
