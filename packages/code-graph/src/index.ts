/**
 * @op1/code-graph - Dependency Graph Plugin for OpenCode
 *
 * Import/export analysis, dependency tracking, and impact analysis.
 *
 * Tools provided:
 * - find_dependents: Find what depends on a file
 * - find_dependencies: Find what a file depends on
 * - impact_analysis: Analyze change impact and risk
 * - graph_status: Get graph statistics
 * - graph_rebuild: Rebuild the dependency graph
 */

// Export plugin (default export for OpenCode plugin loader)
export { CodeGraphPlugin } from "./plugin";
export { default } from "./plugin";

// Re-export types only (no classes)
export type {
	ImportInfo,
	ExportInfo,
	GraphNode,
	GraphEdge,
	ImpactAnalysis,
	FileDependencies,
} from "./types";
