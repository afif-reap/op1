/**
 * @op1/code-intel - Semantic Code Intelligence Plugin for OpenCode
 *
 * Semantic code graph engine with AST chunking, LSP relationships,
 * and vector embeddings for intelligent code navigation and search.
 *
 * Tools provided:
 * - smart_query: Hybrid vector + BM25 + graph retrieval
 * - symbol_impact: Change impact analysis ("What happens if I change X?")
 * - call_graph: Caller/callee visualization
 * - symbol_search: BM25 symbol search by name
 * - repo_map: File importance rankings via PageRank
 * - code_intel_status: Index statistics
 * - code_intel_rebuild: Force full reindex
 * - code_intel_refresh: Incremental update
 *
 * Features:
 * - Hybrid retrieval: Vector similarity + BM25 keyword search + RRF fusion
 * - Graph expansion: Traverse callers/callees for context
 * - Token-budget aware: Respects LLM context limits
 * - Branch-aware indexing: Separate indices per git branch
 * - Lazy initialization: Only builds index on first use
 */

// Export plugin (default export for OpenCode plugin loader)
export { CodeIntelPlugin } from "./plugin";
export { default } from "./plugin";

// Re-export types only (no classes that could be mistakenly called as functions)
// IMPORTANT: OpenCode plugin loader iterates all exports and tries to call them.
// Exporting classes at the top level causes "Cannot call a class constructor without |new|" errors.
export type {
	SymbolType,
	SymbolNode,
	EdgeType,
	EdgeOrigin,
	SymbolEdge,
	FileStatus,
	FileRecord,
	RepoMapEntry,
	IndexLifecycleState,
	IndexStatus,
	RerankMode,
	QueryOptions,
	QueryResult,
	RiskLevel,
	ImpactAnalysis,
	CodeIntelConfig,
} from "./types";

export type { IndexManager, IndexManagerConfig } from "./indexing/index-manager";
export type { SmartQuery, SmartQueryOptions } from "./query/smart-query";
export type { ImpactAnalyzer, ImpactAnalysisOptions } from "./query/impact-analysis";
export type {
	GraphExpander,
	GraphExpansionOptions,
	GraphExpansionResult,
	GraphNode,
} from "./query/graph-expander";
