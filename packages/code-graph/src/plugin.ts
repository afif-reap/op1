/**
 * Code Graph Plugin
 *
 * OpenCode plugin for dependency graph analysis.
 */

import type { Plugin } from "@opencode-ai/plugin";
import { CodeGraphIndex } from "./index-manager";
import {
	find_dependents,
	find_dependencies,
	impact_analysis,
	graph_status,
	graph_rebuild,
	setGraphIndex,
} from "./tools";

/**
 * Code Graph Plugin for OpenCode
 *
 * Provides dependency graph analysis:
 * - find_dependents: Find what depends on a file
 * - find_dependencies: Find what a file depends on
 * - impact_analysis: Analyze change impact
 * - graph_status: Get graph statistics
 * - graph_rebuild: Rebuild the graph
 *
 * Auto-refresh is enabled by default - the graph automatically
 * checks for file changes before queries (with 30s cooldown).
 */
export const CodeGraphPlugin: Plugin = async (ctx) => {
	const { directory } = ctx;

	// Initialize the graph index
	const index = new CodeGraphIndex(directory);
	await index.initialize();

	// Set the global index for tools
	setGraphIndex(index);

	// Cleanup on exit
	const cleanup = () => {
		index.close();
	};
	process.on("exit", cleanup);

	return {
		name: "@op1/code-graph",
		tool: {
			find_dependents,
			find_dependencies,
			impact_analysis,
			graph_status,
			graph_rebuild,
		},
	};
};

export default CodeGraphPlugin;
