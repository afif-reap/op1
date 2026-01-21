/**
 * Semantic Search Tools
 *
 * OpenCode tool definitions for semantic code search.
 */

import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool";
import { SemanticSearchIndex } from "./index-manager";
import type { SearchResult } from "./types";

// Singleton index instance (initialized by plugin)
let searchIndex: SemanticSearchIndex | null = null;

export function setSearchIndex(index: SemanticSearchIndex): void {
	searchIndex = index;
}

function getIndex(): SemanticSearchIndex {
	if (!searchIndex) {
		throw new Error("Semantic search index not initialized. Ensure @op1/semantic-search plugin is configured.");
	}
	return searchIndex;
}

function formatSearchResult(result: SearchResult): string {
	const { chunk, score } = result;
	const location = `${chunk.filePath}:${chunk.startLine}-${chunk.endLine}`;
	const symbol = chunk.symbolName ? ` (${chunk.chunkType}: ${chunk.symbolName})` : "";
	const preview = chunk.content.split("\n").slice(0, 5).join("\n");
	const truncated = chunk.content.split("\n").length > 5 ? "\n  ..." : "";

	return `**${location}**${symbol} [score: ${score.toFixed(3)}]\n\`\`\`${chunk.language}\n${preview}${truncated}\n\`\`\``;
}

/**
 * Search for code using natural language
 */
export const search_semantic: ToolDefinition = tool({
	description: "Search code using natural language. Find implementations, patterns, or concepts.",
	args: {
		query: tool.schema.string().describe("Natural language query (e.g., 'function that validates email')"),
		limit: tool.schema.number().optional().describe("Max results (default 10)"),
		filePath: tool.schema.string().optional().describe("Limit search to specific file"),
	},
	execute: async (args) => {
		try {
			const index = getIndex();
			const results = await index.search(args.query, {
				limit: args.limit ?? 10,
				filePath: args.filePath,
			});

			if (results.length === 0) {
				return "No matching code found. Try:\n- Different keywords\n- More general terms\n- Check if index is built: use `semantic_status` tool";
			}

			const formatted = results.map(formatSearchResult).join("\n\n---\n\n");
			return `Found ${results.length} result(s):\n\n${formatted}`;
		} catch (e) {
			return `Error: ${e instanceof Error ? e.message : String(e)}`;
		}
	},
});

/**
 * Find code similar to a given snippet
 */
export const find_similar: ToolDefinition = tool({
	description: "Find code similar to a given snippet or file location.",
	args: {
		code: tool.schema.string().optional().describe("Code snippet to find similar code for"),
		filePath: tool.schema.string().optional().describe("File path to find similar code to"),
		line: tool.schema.number().optional().describe("Line number in file (1-based)"),
		limit: tool.schema.number().optional().describe("Max results (default 5)"),
	},
	execute: async (args) => {
		try {
			if (!args.code && !args.filePath) {
				return "Error: Provide either 'code' snippet or 'filePath' to find similar code.";
			}

			const index = getIndex();
			let results: SearchResult[];

			if (args.code) {
				results = await index.findSimilar(args.code, { limit: args.limit ?? 5 });
			} else if (args.filePath && args.line) {
				results = await index.findSimilarToLocation(args.filePath, args.line, {
					limit: args.limit ?? 5,
				});
			} else {
				// Find similar to entire file
				const content = await Bun.file(args.filePath!).text();
				results = await index.findSimilar(content.slice(0, 2000), { limit: args.limit ?? 5 });
			}

			if (results.length === 0) {
				return "No similar code found.";
			}

			const formatted = results.map(formatSearchResult).join("\n\n---\n\n");
			return `Found ${results.length} similar code snippet(s):\n\n${formatted}`;
		} catch (e) {
			return `Error: ${e instanceof Error ? e.message : String(e)}`;
		}
	},
});

/**
 * Get semantic search index status
 */
export const semantic_status: ToolDefinition = tool({
	description: "Get status of the semantic search index.",
	args: {},
	execute: async () => {
		try {
			const index = getIndex();
			const status = index.getStatus();

			const lines = [
				"## Semantic Search Index Status",
				"",
				`- **Files indexed:** ${status.fileCount}`,
				`- **Code chunks:** ${status.chunkCount}`,
				`- **Database size:** ${(status.dbSizeBytes / 1024 / 1024).toFixed(2)} MB`,
				`- **Last updated:** ${status.lastUpdated?.toISOString() ?? "Never"}`,
				`- **Indexing:** ${status.isIndexing ? "In progress" : "Idle"}`,
				`- **File watcher:** ${index.isWatching() ? "Active" : "Disabled"}`,
			];

			return lines.join("\n");
		} catch (e) {
			return `Error: ${e instanceof Error ? e.message : String(e)}`;
		}
	},
});

/**
 * Rebuild semantic search index
 */
export const semantic_reindex: ToolDefinition = tool({
	description: "Rebuild the semantic search index. Use when files have changed significantly.",
	args: {
		force: tool.schema.boolean().optional().describe("Force full reindex (default: incremental)"),
	},
	execute: async (args) => {
		try {
			const index = getIndex();
			
			if (args.force) {
				await index.rebuildIndex();
				return "Full reindex complete.";
			} else {
				await index.updateIndex();
				return "Incremental index update complete.";
			}
		} catch (e) {
			return `Error: ${e instanceof Error ? e.message : String(e)}`;
		}
	},
});
