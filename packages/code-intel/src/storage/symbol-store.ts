/**
 * Symbol Store - CRUD operations for symbols table
 */

import type { Database } from "bun:sqlite";
import type { SymbolNode, SymbolType } from "../types";

export interface SymbolStore {
	upsert(symbol: SymbolNode): void;
	upsertMany(symbols: SymbolNode[]): void;
	getById(id: string): SymbolNode | null;
	getByFilePath(filePath: string, branch: string): SymbolNode[];
	getByName(name: string, branch: string): SymbolNode[];
	getByType(type: SymbolType, branch: string): SymbolNode[];
	deleteByFilePath(filePath: string, branch: string): number;
	deleteByBranch(branch: string): number;
	count(branch?: string): number;
	getAll(branch: string, limit?: number): SymbolNode[];
}

export function createSymbolStore(db: Database): SymbolStore {
	// Prepared statements for performance
	const upsertStmt = db.prepare(`
		INSERT OR REPLACE INTO symbols (
			id, name, qualified_name, type, language, file_path,
			start_line, end_line, content, signature, docstring,
			content_hash, is_external, branch, embedding_model_id,
			updated_at, revision_id
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`);

	const getByIdStmt = db.prepare("SELECT * FROM symbols WHERE id = ?");

	const getByFilePathStmt = db.prepare(
		"SELECT * FROM symbols WHERE file_path = ? AND branch = ?",
	);

	const getByNameStmt = db.prepare(
		"SELECT * FROM symbols WHERE name = ? AND branch = ?",
	);

	const getByTypeStmt = db.prepare(
		"SELECT * FROM symbols WHERE type = ? AND branch = ?",
	);

	const deleteByFilePathStmt = db.prepare(
		"DELETE FROM symbols WHERE file_path = ? AND branch = ?",
	);

	const deleteByBranchStmt = db.prepare("DELETE FROM symbols WHERE branch = ?");

	const countStmt = db.prepare("SELECT COUNT(*) as count FROM symbols");

	const countByBranchStmt = db.prepare(
		"SELECT COUNT(*) as count FROM symbols WHERE branch = ?",
	);

	const getAllStmt = db.prepare(
		"SELECT * FROM symbols WHERE branch = ? LIMIT ?",
	);

	function rowToSymbol(row: Record<string, unknown>): SymbolNode {
		return {
			id: row.id as string,
			name: row.name as string,
			qualified_name: row.qualified_name as string,
			type: row.type as SymbolType,
			language: row.language as "typescript" | "python",
			file_path: row.file_path as string,
			start_line: row.start_line as number,
			end_line: row.end_line as number,
			content: row.content as string,
			signature: (row.signature as string) || undefined,
			docstring: (row.docstring as string) || undefined,
			content_hash: row.content_hash as string,
			is_external: (row.is_external as number) === 1,
			branch: row.branch as string,
			embedding_model_id: (row.embedding_model_id as string) || undefined,
			updated_at: row.updated_at as number,
			revision_id: row.revision_id as number,
		};
	}

	return {
		upsert(symbol: SymbolNode): void {
			upsertStmt.run(
				symbol.id,
				symbol.name,
				symbol.qualified_name,
				symbol.type,
				symbol.language,
				symbol.file_path,
				symbol.start_line,
				symbol.end_line,
				symbol.content,
				symbol.signature ?? null,
				symbol.docstring ?? null,
				symbol.content_hash,
				symbol.is_external ? 1 : 0,
				symbol.branch,
				symbol.embedding_model_id ?? null,
				symbol.updated_at,
				symbol.revision_id,
			);
		},

		upsertMany(symbols: SymbolNode[]): void {
			const transaction = db.transaction((items: SymbolNode[]) => {
				for (const symbol of items) {
					this.upsert(symbol);
				}
			});
			transaction(symbols);
		},

		getById(id: string): SymbolNode | null {
			const row = getByIdStmt.get(id) as Record<string, unknown> | null;
			return row ? rowToSymbol(row) : null;
		},

		getByFilePath(filePath: string, branch: string): SymbolNode[] {
			const rows = getByFilePathStmt.all(filePath, branch) as Record<
				string,
				unknown
			>[];
			return rows.map(rowToSymbol);
		},

		getByName(name: string, branch: string): SymbolNode[] {
			const rows = getByNameStmt.all(name, branch) as Record<string, unknown>[];
			return rows.map(rowToSymbol);
		},

		getByType(type: SymbolType, branch: string): SymbolNode[] {
			const rows = getByTypeStmt.all(type, branch) as Record<string, unknown>[];
			return rows.map(rowToSymbol);
		},

		deleteByFilePath(filePath: string, branch: string): number {
			const result = deleteByFilePathStmt.run(filePath, branch);
			return result.changes;
		},

		deleteByBranch(branch: string): number {
			const result = deleteByBranchStmt.run(branch);
			return result.changes;
		},

		count(branch?: string): number {
			if (branch) {
				const result = countByBranchStmt.get(branch) as { count: number };
				return result.count;
			}
			const result = countStmt.get() as { count: number };
			return result.count;
		},

		getAll(branch: string, limit = 1000): SymbolNode[] {
			const rows = getAllStmt.all(branch, limit) as Record<string, unknown>[];
			return rows.map(rowToSymbol);
		},
	};
}
