/**
 * Code Chunker
 *
 * Splits code into semantic chunks based on function/class boundaries.
 * Uses regex-based parsing for simplicity (Tree-sitter can be added later).
 */

import { createHash } from "crypto";
import type { CodeChunk, ChunkType } from "./types";

/**
 * Language-specific patterns for extracting code structures
 */
const PATTERNS: Record<string, RegExp[]> = {
	typescript: [
		// Function declarations
		/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm,
		// Arrow functions assigned to const/let
		/^(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*(?::\s*[^=]+)?\s*=>/gm,
		// Class declarations
		/^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/gm,
		// Interface declarations
		/^(?:export\s+)?interface\s+(\w+)/gm,
		// Type declarations
		/^(?:export\s+)?type\s+(\w+)/gm,
		// Method definitions (inside classes)
		/^\s+(?:async\s+)?(?:public|private|protected)?\s*(\w+)\s*\([^)]*\)/gm,
	],
	javascript: [
		/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm,
		/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/gm,
		/^(?:export\s+)?class\s+(\w+)/gm,
	],
	python: [
		/^(?:async\s+)?def\s+(\w+)/gm,
		/^class\s+(\w+)/gm,
	],
	go: [
		/^func\s+(?:\([^)]+\)\s+)?(\w+)/gm,
		/^type\s+(\w+)\s+struct/gm,
		/^type\s+(\w+)\s+interface/gm,
	],
	rust: [
		/^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/gm,
		/^(?:pub\s+)?struct\s+(\w+)/gm,
		/^(?:pub\s+)?trait\s+(\w+)/gm,
		/^(?:pub\s+)?impl(?:<[^>]+>)?\s+(\w+)/gm,
	],
};

/**
 * Extension to language mapping
 */
const EXT_TO_LANG: Record<string, string> = {
	".ts": "typescript",
	".tsx": "typescript",
	".mts": "typescript",
	".cts": "typescript",
	".js": "javascript",
	".jsx": "javascript",
	".mjs": "javascript",
	".cjs": "javascript",
	".py": "python",
	".go": "go",
	".rs": "rust",
};

/**
 * Generate a hash of content for cache invalidation
 */
export function hashContent(content: string): string {
	return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/**
 * Get language from file extension
 */
export function getLanguage(filePath: string): string {
	const ext = filePath.slice(filePath.lastIndexOf("."));
	return EXT_TO_LANG[ext] || "unknown";
}

/**
 * Find all symbol boundaries in the code
 */
interface SymbolBoundary {
	name: string;
	type: ChunkType;
	startLine: number;
	endLine: number;
}

function findSymbolBoundaries(content: string, language: string): SymbolBoundary[] {
	const patterns = PATTERNS[language];
	if (!patterns) return [];

	const lines = content.split("\n");
	const boundaries: SymbolBoundary[] = [];

	// Track brace depth for finding end of blocks
	function findBlockEnd(startLine: number): number {
		let depth = 0;
		let foundOpen = false;

		for (let i = startLine; i < lines.length; i++) {
			const line = lines[i];
			for (const char of line) {
				if (char === "{" || char === "(") {
					depth++;
					foundOpen = true;
				} else if (char === "}" || char === ")") {
					depth--;
					if (foundOpen && depth === 0) {
						return i;
					}
				}
			}
		}
		return lines.length - 1;
	}

	// Python uses indentation instead of braces
	function findPythonBlockEnd(startLine: number): number {
		if (startLine >= lines.length) return startLine;

		const startIndent = lines[startLine].search(/\S/);
		if (startIndent === -1) return startLine;

		for (let i = startLine + 1; i < lines.length; i++) {
			const line = lines[i];
			if (line.trim() === "") continue; // Skip empty lines

			const indent = line.search(/\S/);
			if (indent !== -1 && indent <= startIndent) {
				return i - 1;
			}
		}
		return lines.length - 1;
	}

	// Find all matches for each pattern
	for (const pattern of patterns) {
		pattern.lastIndex = 0;
		let match;
		while ((match = pattern.exec(content)) !== null) {
			const matchStart = match.index;
			const name = match[1] || "anonymous";

			// Find line number
			const beforeMatch = content.slice(0, matchStart);
			const startLine = beforeMatch.split("\n").length - 1;

			// Determine chunk type
			let type: ChunkType = "function";
			const matchText = match[0].toLowerCase();
			if (matchText.includes("class")) type = "class";
			else if (matchText.includes("interface")) type = "interface";
			else if (matchText.includes("type ")) type = "type";
			else if (matchText.includes("struct")) type = "class";
			else if (matchText.includes("trait")) type = "interface";

			// Find end of block
			const endLine = language === "python" 
				? findPythonBlockEnd(startLine) 
				: findBlockEnd(startLine);

			boundaries.push({ name, type, startLine, endLine });
		}
	}

	// Sort by start line and remove overlaps
	boundaries.sort((a, b) => a.startLine - b.startLine);

	return boundaries;
}

/**
 * Chunk code into semantic units
 */
export function chunkCode(
	filePath: string,
	content: string,
	options: {
		maxChunkLines?: number;
		chunkOverlap?: number;
	} = {}
): CodeChunk[] {
	const { maxChunkLines = 100, chunkOverlap = 10 } = options;

	const language = getLanguage(filePath);
	const lines = content.split("\n");
	const contentHash = hashContent(content);
	const chunks: CodeChunk[] = [];

	// Find symbol boundaries
	const boundaries = findSymbolBoundaries(content, language);

	if (boundaries.length === 0) {
		// No symbols found, chunk by line count
		for (let i = 0; i < lines.length; i += maxChunkLines - chunkOverlap) {
			const startLine = i;
			const endLine = Math.min(i + maxChunkLines - 1, lines.length - 1);
			const chunkContent = lines.slice(startLine, endLine + 1).join("\n");

			if (chunkContent.trim()) {
				chunks.push({
					filePath,
					startLine: startLine + 1,
					endLine: endLine + 1,
					content: chunkContent,
					chunkType: "block",
					language,
					contentHash,
				});
			}
		}
	} else {
		// Chunk by symbol boundaries
		let lastEnd = -1;

		for (const boundary of boundaries) {
			// Skip if this overlaps with previous chunk
			if (boundary.startLine <= lastEnd) continue;

			const startLine = boundary.startLine;
			let endLine = boundary.endLine;

			// If chunk is too large, split it
			if (endLine - startLine + 1 > maxChunkLines) {
				// Take first maxChunkLines
				endLine = startLine + maxChunkLines - 1;
			}

			const chunkContent = lines.slice(startLine, endLine + 1).join("\n");

			if (chunkContent.trim()) {
				chunks.push({
					filePath,
					startLine: startLine + 1,
					endLine: endLine + 1,
					content: chunkContent,
					chunkType: boundary.type,
					symbolName: boundary.name,
					language,
					contentHash,
				});
			}

			lastEnd = endLine;
		}
	}

	return chunks;
}

/**
 * Check if a file should be indexed based on patterns
 */
export function shouldIndexFile(
	filePath: string,
	includePatterns: string[] = ["**/*.ts", "**/*.js", "**/*.py", "**/*.go", "**/*.rs"],
	excludePatterns: string[] = ["**/node_modules/**", "**/dist/**", "**/.git/**"]
): boolean {
	// Simple glob matching
	const matchesPattern = (path: string, pattern: string): boolean => {
		const regex = pattern
			.replace(/\*\*/g, ".*")
			.replace(/\*/g, "[^/]*")
			.replace(/\?/g, ".");
		return new RegExp(`^${regex}$`).test(path);
	};

	// Check excludes first
	for (const pattern of excludePatterns) {
		if (matchesPattern(filePath, pattern)) return false;
	}

	// Check includes
	for (const pattern of includePatterns) {
		if (matchesPattern(filePath, pattern)) return true;
	}

	return false;
}
