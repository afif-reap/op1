/**
 * File Store - CRUD operations for files table
 */

import type { Database } from "bun:sqlite";
import type { FileRecord, FileStatus } from "../types";

export interface FileStore {
	upsert(file: FileRecord): void;
	upsertMany(files: FileRecord[]): void;
	getByPath(filePath: string, branch: string): FileRecord | null;
	getByStatus(status: FileStatus, branch: string): FileRecord[];
	getByBranch(branch: string): FileRecord[];
	getAllPaths(branch: string): string[];
	updateStatus(
		filePath: string,
		branch: string,
		status: FileStatus,
		errorMessage?: string,
	): void;
	updateSymbolCount(
		filePath: string,
		branch: string,
		symbolCount: number,
	): void;
	deleteByPath(filePath: string, branch: string): boolean;
	deleteByBranch(branch: string): number;
	count(branch?: string): number;
	countByStatus(status: FileStatus, branch: string): number;
}

export function createFileStore(db: Database): FileStore {
	const upsertStmt = db.prepare(`
		INSERT OR REPLACE INTO files (
			file_path, file_hash, mtime, size, last_indexed, language,
			branch, status, symbol_count, importance_rank, error_message
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`);

	const getByPathStmt = db.prepare(
		"SELECT * FROM files WHERE file_path = ? AND branch = ?",
	);

	const getByStatusStmt = db.prepare(
		"SELECT * FROM files WHERE status = ? AND branch = ?",
	);

	const getByBranchStmt = db.prepare("SELECT * FROM files WHERE branch = ?");

	const getAllPathsStmt = db.prepare(
		"SELECT file_path FROM files WHERE branch = ?",
	);

	const updateStatusStmt = db.prepare(`
		UPDATE files SET status = ?, error_message = ?, last_indexed = ?
		WHERE file_path = ? AND branch = ?
	`);

	const updateSymbolCountStmt = db.prepare(`
		UPDATE files SET symbol_count = ? WHERE file_path = ? AND branch = ?
	`);

	const deleteByPathStmt = db.prepare(
		"DELETE FROM files WHERE file_path = ? AND branch = ?",
	);

	const deleteByBranchStmt = db.prepare("DELETE FROM files WHERE branch = ?");

	const countStmt = db.prepare("SELECT COUNT(*) as count FROM files");

	const countByBranchStmt = db.prepare(
		"SELECT COUNT(*) as count FROM files WHERE branch = ?",
	);

	const countByStatusStmt = db.prepare(
		"SELECT COUNT(*) as count FROM files WHERE status = ? AND branch = ?",
	);

	function rowToFile(row: Record<string, unknown>): FileRecord {
		return {
			file_path: row.file_path as string,
			file_hash: row.file_hash as string,
			mtime: row.mtime as number,
			size: row.size as number,
			last_indexed: row.last_indexed as number,
			language: row.language as "typescript" | "python" | "unknown",
			branch: row.branch as string,
			status: row.status as FileStatus,
			symbol_count: row.symbol_count as number,
			importance_rank: (row.importance_rank as number) ?? undefined,
			error_message: (row.error_message as string) ?? undefined,
		};
	}

	return {
		upsert(file: FileRecord): void {
			upsertStmt.run(
				file.file_path,
				file.file_hash,
				file.mtime,
				file.size,
				file.last_indexed,
				file.language,
				file.branch,
				file.status,
				file.symbol_count,
				file.importance_rank ?? null,
				file.error_message ?? null,
			);
		},

		upsertMany(files: FileRecord[]): void {
			const transaction = db.transaction((items: FileRecord[]) => {
				for (const file of items) {
					this.upsert(file);
				}
			});
			transaction(files);
		},

		getByPath(filePath: string, branch: string): FileRecord | null {
			const row = getByPathStmt.get(filePath, branch) as Record<
				string,
				unknown
			> | null;
			return row ? rowToFile(row) : null;
		},

		getByStatus(status: FileStatus, branch: string): FileRecord[] {
			const rows = getByStatusStmt.all(status, branch) as Record<
				string,
				unknown
			>[];
			return rows.map(rowToFile);
		},

		getByBranch(branch: string): FileRecord[] {
			const rows = getByBranchStmt.all(branch) as Record<string, unknown>[];
			return rows.map(rowToFile);
		},

		getAllPaths(branch: string): string[] {
			const rows = getAllPathsStmt.all(branch) as Array<{ file_path: string }>;
			return rows.map((r) => r.file_path);
		},

		updateStatus(
			filePath: string,
			branch: string,
			status: FileStatus,
			errorMessage?: string,
		): void {
			updateStatusStmt.run(
				status,
				errorMessage ?? null,
				Date.now(),
				filePath,
				branch,
			);
		},

		updateSymbolCount(
			filePath: string,
			branch: string,
			symbolCount: number,
		): void {
			updateSymbolCountStmt.run(symbolCount, filePath, branch);
		},

		deleteByPath(filePath: string, branch: string): boolean {
			const result = deleteByPathStmt.run(filePath, branch);
			return result.changes > 0;
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

		countByStatus(status: FileStatus, branch: string): number {
			const result = countByStatusStmt.get(status, branch) as { count: number };
			return result.count;
		},
	};
}
