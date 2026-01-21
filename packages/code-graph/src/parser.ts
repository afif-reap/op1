/**
 * Import/Export Parser
 *
 * Parses TypeScript/JavaScript files to extract import and export statements.
 * Uses regex-based parsing for simplicity and speed.
 */

import type { ImportInfo, ImportedSymbol, ExportInfo, FileDependencies } from "./types";

/**
 * Parse import statements from source code
 */
export function parseImports(content: string): ImportInfo[] {
	const imports: ImportInfo[] = [];
	const lines = content.split("\n");

	// Patterns for different import types
	const patterns = {
		// import { a, b } from 'module'
		named: /^import\s+(?:type\s+)?{([^}]+)}\s+from\s+['"]([^'"]+)['"]/,
		// import defaultExport from 'module'
		default: /^import\s+(?:type\s+)?(\w+)\s+from\s+['"]([^'"]+)['"]/,
		// import * as namespace from 'module'
		namespace: /^import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/,
		// import defaultExport, { named } from 'module'
		mixed: /^import\s+(?:type\s+)?(\w+)\s*,\s*{([^}]+)}\s+from\s+['"]([^'"]+)['"]/,
		// import 'module' (side-effect)
		sideEffect: /^import\s+['"]([^'"]+)['"]/,
		// Dynamic import: import('module')
		dynamic: /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
	};

	for (let lineNum = 0; lineNum < lines.length; lineNum++) {
		const line = lines[lineNum].trim();
		const isTypeOnly = line.startsWith("import type");

		// Mixed import (default + named)
		let match = line.match(patterns.mixed);
		if (match) {
			const [, defaultName, namedPart, source] = match;
			const symbols: ImportedSymbol[] = [
				{ name: "default", alias: defaultName, isDefault: true, isNamespace: false },
			];

			// Parse named imports
			const namedImports = namedPart.split(",").map((s) => s.trim()).filter(Boolean);
			for (const named of namedImports) {
				const [name, alias] = named.split(/\s+as\s+/).map((s) => s.trim());
				symbols.push({ name, alias: alias || undefined, isDefault: false, isNamespace: false });
			}

			imports.push({ source, symbols, isTypeOnly, line: lineNum + 1, isDynamic: false });
			continue;
		}

		// Namespace import
		match = line.match(patterns.namespace);
		if (match) {
			const [, alias, source] = match;
			imports.push({
				source,
				symbols: [{ name: "*", alias, isDefault: false, isNamespace: true }],
				isTypeOnly,
				line: lineNum + 1,
				isDynamic: false,
			});
			continue;
		}

		// Named imports
		match = line.match(patterns.named);
		if (match) {
			const [, namedPart, source] = match;
			const symbols: ImportedSymbol[] = [];

			const namedImports = namedPart.split(",").map((s) => s.trim()).filter(Boolean);
			for (const named of namedImports) {
				const [name, alias] = named.split(/\s+as\s+/).map((s) => s.trim());
				symbols.push({ name, alias: alias || undefined, isDefault: false, isNamespace: false });
			}

			imports.push({ source, symbols, isTypeOnly, line: lineNum + 1, isDynamic: false });
			continue;
		}

		// Default import (must check after mixed to avoid false matches)
		match = line.match(patterns.default);
		if (match && !line.includes("{")) {
			const [, defaultName, source] = match;
			imports.push({
				source,
				symbols: [{ name: "default", alias: defaultName, isDefault: true, isNamespace: false }],
				isTypeOnly,
				line: lineNum + 1,
				isDynamic: false,
			});
			continue;
		}

		// Side-effect import
		match = line.match(patterns.sideEffect);
		if (match && !line.includes("from")) {
			const [, source] = match;
			imports.push({ source, symbols: [], isTypeOnly: false, line: lineNum + 1, isDynamic: false });
			continue;
		}
	}

	// Find dynamic imports throughout the file
	const dynamicPattern = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
	let dynamicMatch;
	while ((dynamicMatch = dynamicPattern.exec(content)) !== null) {
		const source = dynamicMatch[1];
		// Find line number
		const beforeMatch = content.slice(0, dynamicMatch.index);
		const lineNum = beforeMatch.split("\n").length;

		imports.push({
			source,
			symbols: [],
			isTypeOnly: false,
			line: lineNum,
			isDynamic: true,
		});
	}

	return imports;
}

/**
 * Parse export statements from source code
 */
export function parseExports(content: string): ExportInfo[] {
	const exports: ExportInfo[] = [];
	const lines = content.split("\n");

	const patterns = {
		// export { a, b }
		named: /^export\s+(?:type\s+)?{([^}]+)}/,
		// export { a, b } from 'module'
		reexport: /^export\s+(?:type\s+)?{([^}]+)}\s+from\s+['"]([^'"]+)['"]/,
		// export * from 'module'
		reexportAll: /^export\s+\*\s+from\s+['"]([^'"]+)['"]/,
		// export * as namespace from 'module'
		reexportNamespace: /^export\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/,
		// export default
		exportDefault: /^export\s+default\s+/,
		// export function/class/const/let/var
		exportDeclaration: /^export\s+(?:type\s+)?(function|class|const|let|var|interface|type|enum)\s+(\w+)/,
	};

	for (let lineNum = 0; lineNum < lines.length; lineNum++) {
		const line = lines[lineNum].trim();
		const isTypeOnly = line.includes("export type");

		// Re-export all with namespace
		let match = line.match(patterns.reexportNamespace);
		if (match) {
			const [, name, source] = match;
			exports.push({ name, isDefault: false, isReexport: true, source, line: lineNum + 1, isTypeOnly });
			continue;
		}

		// Re-export all
		match = line.match(patterns.reexportAll);
		if (match) {
			const [, source] = match;
			exports.push({ name: "*", isDefault: false, isReexport: true, source, line: lineNum + 1, isTypeOnly });
			continue;
		}

		// Re-export named
		match = line.match(patterns.reexport);
		if (match) {
			const [, namedPart, source] = match;
			const names = namedPart.split(",").map((s) => s.trim()).filter(Boolean);
			for (const named of names) {
				const [name] = named.split(/\s+as\s+/).map((s) => s.trim());
				exports.push({ name, isDefault: false, isReexport: true, source, line: lineNum + 1, isTypeOnly });
			}
			continue;
		}

		// Named exports (local)
		match = line.match(patterns.named);
		if (match) {
			const [, namedPart] = match;
			const names = namedPart.split(",").map((s) => s.trim()).filter(Boolean);
			for (const named of names) {
				const [name] = named.split(/\s+as\s+/).map((s) => s.trim());
				exports.push({ name, isDefault: false, isReexport: false, line: lineNum + 1, isTypeOnly });
			}
			continue;
		}

		// Export default
		if (patterns.exportDefault.test(line)) {
			// Try to extract the name after 'export default'
			const afterDefault = line.replace(patterns.exportDefault, "").trim();
			const nameMatch = afterDefault.match(/^(?:function|class)?\s*(\w+)/);
			const name = nameMatch ? nameMatch[1] : "default";
			exports.push({ name, isDefault: true, isReexport: false, line: lineNum + 1, isTypeOnly: false });
			continue;
		}

		// Export declaration
		match = line.match(patterns.exportDeclaration);
		if (match) {
			const [, , name] = match;
			exports.push({ name, isDefault: false, isReexport: false, line: lineNum + 1, isTypeOnly });
			continue;
		}
	}

	return exports;
}

/**
 * Resolve import path to absolute file path
 */
export function resolveImportPath(
	importPath: string,
	fromFile: string,
	workspaceRoot: string
): string | null {
	const { dirname, join, resolve } = require("path");
	const { existsSync } = require("fs");

	// Skip external packages
	if (!importPath.startsWith(".") && !importPath.startsWith("/")) {
		return null; // External package
	}

	const fromDir = dirname(fromFile);
	let resolved = resolve(fromDir, importPath);

	// Try with extensions
	const extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", "/index.ts", "/index.tsx", "/index.js"];

	for (const ext of extensions) {
		const candidate = resolved + ext;
		if (existsSync(candidate)) {
			return candidate;
		}
	}

	// Try as-is (might already have extension)
	if (existsSync(resolved)) {
		return resolved;
	}

	return null;
}

/**
 * Parse file dependencies
 */
export async function parseFileDependencies(
	filePath: string,
	workspaceRoot: string
): Promise<FileDependencies> {
	const content = await Bun.file(filePath).text();
	const imports = parseImports(content);
	const exports = parseExports(content);

	// Resolve import paths
	const resolvedImports = new Map<string, string>();
	for (const imp of imports) {
		const resolved = resolveImportPath(imp.source, filePath, workspaceRoot);
		if (resolved) {
			resolvedImports.set(imp.source, resolved);
		}
	}

	return {
		filePath,
		imports,
		exports,
		resolvedImports,
	};
}
