/**
 * LSP Plugin Export
 *
 * Main plugin entry point for OpenCode integration.
 */

import type { Plugin } from "@opencode-ai/plugin";
import {
	lsp_goto_definition,
	lsp_find_references,
	lsp_symbols,
	lsp_diagnostics,
	lsp_prepare_rename,
	lsp_rename,
} from "./tools";
import { lspManager } from "./client";

/**
 * LSP Plugin for OpenCode
 *
 * Provides 6 LSP tools for code navigation and refactoring:
 * - lsp_goto_definition
 * - lsp_find_references
 * - lsp_symbols
 * - lsp_diagnostics
 * - lsp_prepare_rename
 * - lsp_rename
 */
export const LspPlugin: Plugin = async (_ctx) => {
	// Register cleanup on process exit
	const cleanup = () => {
		lspManager.stopAll();
	};

	process.on("SIGINT", cleanup);
	process.on("SIGTERM", cleanup);
	if (process.platform === "win32") {
		process.on("SIGBREAK" as NodeJS.Signals, cleanup);
	}

	return {
		name: "@op1/lsp",
		tool: {
			lsp_goto_definition,
			lsp_find_references,
			lsp_symbols,
			lsp_diagnostics,
			lsp_prepare_rename,
			lsp_rename,
		},
	};
};

export default LspPlugin;
