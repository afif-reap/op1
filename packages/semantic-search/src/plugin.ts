/**
 * Semantic Search Plugin
 *
 * OpenCode plugin for semantic code search.
 */

import type { Plugin } from "@opencode-ai/plugin";
import { SemanticSearchIndex } from "./index-manager";
import {
	search_semantic,
	find_similar,
	semantic_status,
	semantic_reindex,
	setSearchIndex,
} from "./tools";

/**
 * Semantic Search Plugin for OpenCode
 *
 * Provides semantic code search using embeddings:
 * - search_semantic: Natural language code search
 * - find_similar: Find similar code snippets
 * - semantic_status: Index status
 * - semantic_reindex: Rebuild index
 */
export const SemanticSearchPlugin: Plugin = async (ctx) => {
	const { directory } = ctx;

	// Initialize the search index
	const index = new SemanticSearchIndex(directory);
	await index.initialize();

	// Set the global index for tools
	setSearchIndex(index);

	// Cleanup on exit
	const cleanup = () => {
		index.close();
	};
	process.on("exit", cleanup);

	return {
		name: "@op1/semantic-search",
		tool: {
			search_semantic,
			find_similar,
			semantic_status,
			semantic_reindex,
		},
	};
};

export default SemanticSearchPlugin;
