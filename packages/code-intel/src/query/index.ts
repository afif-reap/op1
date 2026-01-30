/**
 * Query module exports
 */

export {
	createGraphExpander,
	type GraphExpander,
	type GraphExpansionOptions,
	type GraphExpansionResult,
	type GraphNode,
} from "./graph-expander";

export {
	createImpactAnalyzer,
	type ImpactAnalyzer,
	type ImpactAnalysisOptions,
} from "./impact-analysis";

export {
	createBranchDiffer,
	type BranchDiffer,
	type BranchDiffResult,
	type BranchDiffOptions,
	type SymbolDiff,
	type EdgeDiff,
	type DiffStatus,
} from "./branch-diff";
