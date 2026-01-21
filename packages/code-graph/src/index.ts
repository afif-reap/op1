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

// Re-export all modules
export * from "./types";
export * from "./parser";
export * from "./graph-store";
export * from "./index-manager";
export * from "./tools";

// Export plugin
export { CodeGraphPlugin } from "./plugin";
