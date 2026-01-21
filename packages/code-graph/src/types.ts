/**
 * Code Graph Type Definitions
 */

/**
 * A node in the dependency graph (file or symbol)
 */
export interface GraphNode {
	/** Unique identifier (file path or symbol ID) */
	id: string;
	/** Type of node */
	type: NodeType;
	/** Display name */
	name: string;
	/** File path (for file nodes, or containing file for symbol nodes) */
	filePath: string;
	/** Line number (for symbol nodes) */
	line?: number;
	/** Additional metadata */
	metadata?: Record<string, unknown>;
}

/**
 * Types of graph nodes
 */
export type NodeType = 
	| "file"
	| "function"
	| "class"
	| "method"
	| "variable"
	| "interface"
	| "type"
	| "export"
	| "import";

/**
 * An edge in the dependency graph
 */
export interface GraphEdge {
	/** Source node ID */
	from: string;
	/** Target node ID */
	to: string;
	/** Type of relationship */
	type: EdgeType;
	/** Weight/importance (higher = stronger relationship) */
	weight?: number;
}

/**
 * Types of edges/relationships
 */
export type EdgeType =
	| "imports"        // File imports another file
	| "exports"        // File exports a symbol
	| "calls"          // Function calls another function
	| "extends"        // Class extends another class
	| "implements"     // Class implements an interface
	| "uses"           // Symbol uses another symbol
	| "defines"        // File defines a symbol
	| "reexports";     // File re-exports from another file

/**
 * Import/export statement information
 */
export interface ImportInfo {
	/** The import path (e.g., './utils', 'lodash') */
	source: string;
	/** Imported symbols (empty for side-effect imports) */
	symbols: ImportedSymbol[];
	/** Whether it's a type-only import */
	isTypeOnly: boolean;
	/** Line number of import statement */
	line: number;
	/** Whether it's a dynamic import */
	isDynamic: boolean;
}

/**
 * An imported symbol
 */
export interface ImportedSymbol {
	/** Original name in source module */
	name: string;
	/** Local alias (if renamed) */
	alias?: string;
	/** Whether it's the default export */
	isDefault: boolean;
	/** Whether it's a namespace import (import * as X) */
	isNamespace: boolean;
}

/**
 * Export information
 */
export interface ExportInfo {
	/** Exported symbol name */
	name: string;
	/** Whether it's the default export */
	isDefault: boolean;
	/** Whether it's a re-export */
	isReexport: boolean;
	/** Source of re-export (if applicable) */
	source?: string;
	/** Line number */
	line: number;
	/** Whether it's a type-only export */
	isTypeOnly: boolean;
}

/**
 * Dependency analysis result for a file
 */
export interface FileDependencies {
	/** File path */
	filePath: string;
	/** All imports */
	imports: ImportInfo[];
	/** All exports */
	exports: ExportInfo[];
	/** Resolved import paths (absolute) */
	resolvedImports: Map<string, string>;
}

/**
 * Impact analysis result
 */
export interface ImpactAnalysis {
	/** The file/symbol being analyzed */
	target: string;
	/** Files that directly depend on the target */
	directDependents: string[];
	/** Files that transitively depend on the target */
	transitiveDependents: string[];
	/** Risk assessment */
	riskLevel: "low" | "medium" | "high" | "critical";
	/** Explanation of risk */
	riskExplanation: string;
}

/**
 * Call graph entry
 */
export interface CallGraphEntry {
	/** Function/method being analyzed */
	symbol: string;
	/** File containing the symbol */
	filePath: string;
	/** Functions that call this one */
	callers: Array<{ symbol: string; filePath: string; line: number }>;
	/** Functions called by this one */
	callees: Array<{ symbol: string; filePath: string; line: number }>;
}
