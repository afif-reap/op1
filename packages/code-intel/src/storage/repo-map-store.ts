/**
 * Repo Map Store - File importance rankings for orientation
 */

import type { Database } from "bun:sqlite";
import type { RepoMapEntry } from "../types";

export interface RepoMapStore {
	upsert(entry: RepoMapEntry): void;
	upsertMany(entries: RepoMapEntry[]): void;
	getByBranch(branch: string, limit?: number): RepoMapEntry[];
	getByFilePath(filePath: string, branch: string): RepoMapEntry | null;
	deleteByBranch(branch: string): number;
	deleteByFilePath(filePath: string, branch: string): boolean;
}

export function createRepoMapStore(db: Database): RepoMapStore {
	const upsertStmt = db.prepare(`
		INSERT OR REPLACE INTO repo_map (
			file_path, branch, importance_score, in_degree, out_degree,
			symbol_summary, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?)
	`);

	const getByBranchStmt = db.prepare(`
		SELECT * FROM repo_map 
		WHERE branch = ? 
		ORDER BY importance_score DESC 
		LIMIT ?
	`);

	const getByFilePathStmt = db.prepare(
		"SELECT * FROM repo_map WHERE file_path = ? AND branch = ?",
	);

	const deleteByBranchStmt = db.prepare(
		"DELETE FROM repo_map WHERE branch = ?",
	);

	const deleteByFilePathStmt = db.prepare(
		"DELETE FROM repo_map WHERE file_path = ? AND branch = ?",
	);

	function rowToEntry(row: Record<string, unknown>): RepoMapEntry {
		return {
			file_path: row.file_path as string,
			importance_score: row.importance_score as number,
			in_degree: row.in_degree as number,
			out_degree: row.out_degree as number,
			symbol_summary: (row.symbol_summary as string) || "",
			branch: row.branch as string,
		};
	}

	return {
		upsert(entry: RepoMapEntry): void {
			upsertStmt.run(
				entry.file_path,
				entry.branch,
				entry.importance_score,
				entry.in_degree,
				entry.out_degree,
				entry.symbol_summary,
				Date.now(),
			);
		},

		upsertMany(entries: RepoMapEntry[]): void {
			const transaction = db.transaction((items: RepoMapEntry[]) => {
				const now = Date.now();
				for (const entry of items) {
					upsertStmt.run(
						entry.file_path,
						entry.branch,
						entry.importance_score,
						entry.in_degree,
						entry.out_degree,
						entry.symbol_summary,
						now,
					);
				}
			});
			transaction(entries);
		},

		getByBranch(branch: string, limit = 50): RepoMapEntry[] {
			const rows = getByBranchStmt.all(branch, limit) as Record<
				string,
				unknown
			>[];
			return rows.map(rowToEntry);
		},

		getByFilePath(filePath: string, branch: string): RepoMapEntry | null {
			const row = getByFilePathStmt.get(filePath, branch) as Record<
				string,
				unknown
			> | null;
			return row ? rowToEntry(row) : null;
		},

		deleteByBranch(branch: string): number {
			const result = deleteByBranchStmt.run(branch);
			return result.changes;
		},

		deleteByFilePath(filePath: string, branch: string): boolean {
			const result = deleteByFilePathStmt.run(filePath, branch);
			return result.changes > 0;
		},
	};
}
