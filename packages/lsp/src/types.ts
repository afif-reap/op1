/**
 * LSP Type Definitions
 *
 * Core types for Language Server Protocol integration.
 */

/**
 * Configuration for a language server
 */
export interface LSPServerConfig {
	/** Unique identifier for the server */
	id: string;
	/** Command to start the server (binary + args) */
	command: string[];
	/** File extensions this server handles */
	extensions: string[];
	/** Environment variables to pass to the server */
	env?: Record<string, string>;
	/** Additional initialization options */
	initializationOptions?: Record<string, unknown>;
	/** Priority for server selection (higher = preferred) */
	priority?: number;
	/** Whether this server is disabled */
	disabled?: boolean;
}

/**
 * LSP Position (0-indexed)
 */
export interface Position {
	line: number;
	character: number;
}

/**
 * LSP Range
 */
export interface Range {
	start: Position;
	end: Position;
}

/**
 * LSP Location
 */
export interface Location {
	uri: string;
	range: Range;
}

/**
 * LSP LocationLink (for go-to-definition with origin)
 */
export interface LocationLink {
	originSelectionRange?: Range;
	targetUri: string;
	targetRange: Range;
	targetSelectionRange: Range;
}

/**
 * Symbol information (workspace symbols)
 */
export interface SymbolInfo {
	name: string;
	kind: number;
	location: Location;
	containerName?: string;
}

/**
 * Document symbol (hierarchical)
 */
export interface DocumentSymbol {
	name: string;
	detail?: string;
	kind: number;
	range: Range;
	selectionRange: Range;
	children?: DocumentSymbol[];
}

/**
 * LSP Diagnostic
 */
export interface Diagnostic {
	range: Range;
	message: string;
	severity?: number;
	code?: string | number;
	source?: string;
	relatedInformation?: DiagnosticRelatedInformation[];
}

/**
 * Related diagnostic information
 */
export interface DiagnosticRelatedInformation {
	location: Location;
	message: string;
}

/**
 * Workspace edit for refactoring
 */
export interface WorkspaceEdit {
	changes?: Record<string, TextEdit[]>;
	documentChanges?: (TextDocumentEdit | CreateFile | RenameFile | DeleteFile)[];
}

/**
 * Text edit
 */
export interface TextEdit {
	range: Range;
	newText: string;
}

/**
 * Text document edit
 */
export interface TextDocumentEdit {
	textDocument: { uri: string; version?: number | null };
	edits: TextEdit[];
}

/**
 * Create file operation
 */
export interface CreateFile {
	kind: "create";
	uri: string;
	options?: { overwrite?: boolean; ignoreIfExists?: boolean };
}

/**
 * Rename file operation
 */
export interface RenameFile {
	kind: "rename";
	oldUri: string;
	newUri: string;
	options?: { overwrite?: boolean; ignoreIfExists?: boolean };
}

/**
 * Delete file operation
 */
export interface DeleteFile {
	kind: "delete";
	uri: string;
	options?: { recursive?: boolean; ignoreIfNotExists?: boolean };
}

/**
 * Prepare rename result
 */
export interface PrepareRenameResult {
	range: Range;
	placeholder: string;
}

/**
 * Default behavior for prepare rename
 */
export interface PrepareRenameDefaultBehavior {
	defaultBehavior: boolean;
}

/**
 * Resolved server configuration
 */
export interface ResolvedServer {
	config: LSPServerConfig;
	languageId: string;
}

/**
 * Server lookup result
 */
export type ServerLookupResult =
	| { status: "found"; server: ResolvedServer }
	| { status: "not_installed"; server: LSPServerConfig; installHint?: string }
	| { status: "not_configured"; extension: string };

/**
 * Apply workspace edit result
 */
export interface ApplyResult {
	success: boolean;
	filesModified: string[];
	filesCreated: string[];
	filesDeleted: string[];
	filesRenamed: Array<{ from: string; to: string }>;
	errors: string[];
}
