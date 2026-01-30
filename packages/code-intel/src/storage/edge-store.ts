/**
 * Edge Store - CRUD operations for edges table
 */

import type { Database } from "bun:sqlite";
import type { EdgeOrigin, EdgeType, SymbolEdge } from "../types";

export interface EdgeStore {
	upsert(edge: SymbolEdge): void;
	upsertMany(edges: SymbolEdge[]): void;
	getById(id: string): SymbolEdge | null;
	getBySourceId(sourceId: string, branch: string): SymbolEdge[];
	getByTargetId(targetId: string, branch: string): SymbolEdge[];
	getByType(type: EdgeType, branch: string): SymbolEdge[];
	getCallers(symbolId: string, branch: string): SymbolEdge[];
	getCallees(symbolId: string, branch: string): SymbolEdge[];
	deleteBySourceId(sourceId: string, branch: string): number;
	deleteByTargetId(targetId: string, branch: string): number;
	deleteByBranch(branch: string): number;
	deleteStaleEdges(symbolIds: string[], branch: string): number;
	count(branch?: string): number;
}

export function createEdgeStore(db: Database): EdgeStore {
	const upsertStmt = db.prepare(`
		INSERT OR REPLACE INTO edges (
			id, source_id, target_id, type, confidence, origin, branch,
			source_start_line, source_end_line, target_start_line, target_end_line,
			updated_at, metadata
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`);

	const getByIdStmt = db.prepare("SELECT * FROM edges WHERE id = ?");

	const getBySourceIdStmt = db.prepare(
		"SELECT * FROM edges WHERE source_id = ? AND branch = ?",
	);

	const getByTargetIdStmt = db.prepare(
		"SELECT * FROM edges WHERE target_id = ? AND branch = ?",
	);

	const getByTypeStmt = db.prepare(
		"SELECT * FROM edges WHERE type = ? AND branch = ?",
	);

	const getCallersStmt = db.prepare(
		"SELECT * FROM edges WHERE target_id = ? AND branch = ? AND type = 'CALLS'",
	);

	const getCalleesStmt = db.prepare(
		"SELECT * FROM edges WHERE source_id = ? AND branch = ? AND type = 'CALLS'",
	);

	const deleteBySourceIdStmt = db.prepare(
		"DELETE FROM edges WHERE source_id = ? AND branch = ?",
	);

	const deleteByTargetIdStmt = db.prepare(
		"DELETE FROM edges WHERE target_id = ? AND branch = ?",
	);

	const deleteByBranchStmt = db.prepare("DELETE FROM edges WHERE branch = ?");

	const countStmt = db.prepare("SELECT COUNT(*) as count FROM edges");

	const countByBranchStmt = db.prepare(
		"SELECT COUNT(*) as count FROM edges WHERE branch = ?",
	);

	function rowToEdge(row: Record<string, unknown>): SymbolEdge {
		const edge: SymbolEdge = {
			id: row.id as string,
			source_id: row.source_id as string,
			target_id: row.target_id as string,
			type: row.type as EdgeType,
			confidence: row.confidence as number,
			origin: row.origin as EdgeOrigin,
			branch: row.branch as string,
			updated_at: row.updated_at as number,
		};

		if (row.source_start_line !== null && row.source_end_line !== null) {
			edge.source_range = [
				row.source_start_line as number,
				row.source_end_line as number,
			];
		}

		if (row.target_start_line !== null && row.target_end_line !== null) {
			edge.target_range = [
				row.target_start_line as number,
				row.target_end_line as number,
			];
		}

		if (row.metadata) {
			try {
				edge.metadata = JSON.parse(row.metadata as string);
			} catch {
				// Ignore invalid JSON
			}
		}

		return edge;
	}

	return {
		upsert(edge: SymbolEdge): void {
			upsertStmt.run(
				edge.id,
				edge.source_id,
				edge.target_id,
				edge.type,
				edge.confidence,
				edge.origin,
				edge.branch,
				edge.source_range?.[0] ?? null,
				edge.source_range?.[1] ?? null,
				edge.target_range?.[0] ?? null,
				edge.target_range?.[1] ?? null,
				edge.updated_at,
				edge.metadata ? JSON.stringify(edge.metadata) : null,
			);
		},

		upsertMany(edges: SymbolEdge[]): void {
			const transaction = db.transaction((items: SymbolEdge[]) => {
				for (const edge of items) {
					this.upsert(edge);
				}
			});
			transaction(edges);
		},

		getById(id: string): SymbolEdge | null {
			const row = getByIdStmt.get(id) as Record<string, unknown> | null;
			return row ? rowToEdge(row) : null;
		},

		getBySourceId(sourceId: string, branch: string): SymbolEdge[] {
			const rows = getBySourceIdStmt.all(sourceId, branch) as Record<
				string,
				unknown
			>[];
			return rows.map(rowToEdge);
		},

		getByTargetId(targetId: string, branch: string): SymbolEdge[] {
			const rows = getByTargetIdStmt.all(targetId, branch) as Record<
				string,
				unknown
			>[];
			return rows.map(rowToEdge);
		},

		getByType(type: EdgeType, branch: string): SymbolEdge[] {
			const rows = getByTypeStmt.all(type, branch) as Record<string, unknown>[];
			return rows.map(rowToEdge);
		},

		getCallers(symbolId: string, branch: string): SymbolEdge[] {
			const rows = getCallersStmt.all(symbolId, branch) as Record<
				string,
				unknown
			>[];
			return rows.map(rowToEdge);
		},

		getCallees(symbolId: string, branch: string): SymbolEdge[] {
			const rows = getCalleesStmt.all(symbolId, branch) as Record<
				string,
				unknown
			>[];
			return rows.map(rowToEdge);
		},

		deleteBySourceId(sourceId: string, branch: string): number {
			const result = deleteBySourceIdStmt.run(sourceId, branch);
			return result.changes;
		},

		deleteByTargetId(targetId: string, branch: string): number {
			const result = deleteByTargetIdStmt.run(targetId, branch);
			return result.changes;
		},

		deleteByBranch(branch: string): number {
			const result = deleteByBranchStmt.run(branch);
			return result.changes;
		},

		deleteStaleEdges(symbolIds: string[], branch: string): number {
			if (symbolIds.length === 0) return 0;

			// Delete edges where source or target is in the list
			const placeholders = symbolIds.map(() => "?").join(",");
			const stmt = db.prepare(`
				DELETE FROM edges 
				WHERE branch = ? 
				AND (source_id IN (${placeholders}) OR target_id IN (${placeholders}))
			`);
			const result = stmt.run(branch, ...symbolIds, ...symbolIds);
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
	};
}
