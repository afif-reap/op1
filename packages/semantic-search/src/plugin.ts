/**
 * Semantic Search Plugin
 *
 * OpenCode plugin for semantic code search.
 * Initialization is lazy - only happens when tools are first used.
 */

import type { Plugin } from "@opencode-ai/plugin";
import { SemanticSearchIndex } from "./index-manager";
import { isSqliteVecError } from "./vector-store";
import {
	search_semantic,
	find_similar,
	semantic_status,
	semantic_reindex,
	setSearchIndex,
	setEnsureIndex,
} from "./tools";

/**
 * Semantic Search Plugin for OpenCode
 *
 * Provides semantic code search using embeddings:
 * - search_semantic: Natural language code search
 * - find_similar: Find similar code snippets
 * - semantic_status: Index status
 * - semantic_reindex: Rebuild index
 *
 * Note: SQLite-vec initialization is lazy to avoid startup errors
 * when the native extension isn't available.
 */
export const SemanticSearchPlugin: Plugin = async (ctx) => {
	const { directory } = ctx;

	// Lazy initialization - only initialize when first tool is used
	let index: SemanticSearchIndex | null = null;
	let initError: Error | null = null;

	const ensureIndex = async (): Promise<SemanticSearchIndex> => {
		if (initError) {
			throw initError;
		}
		if (!index) {
			try {
				index = new SemanticSearchIndex(directory);
				await index.initialize();
				setSearchIndex(index);

				// Note: We intentionally don't register an exit handler.
				// Calling index.close() during process exit can cause C++ exceptions
				// in sqlite-vec or ONNX runtime. The OS will clean up resources.
			} catch (error) {
				// Provide actionable error messages based on error type
				if (isSqliteVecError(error)) {
					const hint = error.hint ? `\n\nHint: ${error.hint}` : "";
					initError = new Error(`Semantic search initialization failed:\n${error.message}${hint}`);
				} else {
					const message = error instanceof Error ? error.message : String(error);
					initError = new Error(
						`Semantic search initialization failed: ${message}\n\n` +
						`Troubleshooting:\n` +
						`1. Ensure sqlite-vec is installed: bun install sqlite-vec\n` +
						`2. Try reinstalling: rm -rf node_modules && bun install\n` +
						`3. Check platform support at https://github.com/asg017/sqlite-vec`
					);
				}
				throw initError;
			}
		}
		return index;
	};

	// Export the lazy initializer for tools to use
	setSearchIndex(null); // Clear any previous index
	setEnsureIndex(ensureIndex); // Wire up lazy initialization

	return {
		name: "@op1/semantic-search",
		tool: {
			search_semantic,
			find_similar,
			semantic_status,
			semantic_reindex,
		},
		// Expose lazy initializer via context
		_ensureIndex: ensureIndex,
	};
};

export default SemanticSearchPlugin;
