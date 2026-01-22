/**
 * Vector Store
 *
 * SQLite-vec based vector storage for semantic search.
 * Uses bun:sqlite with custom SQLite on macOS for extension loading support.
 */

import { Database } from "bun:sqlite";
import { mkdir } from "fs/promises";
import { dirname } from "path";
import { statSync, existsSync } from "fs";
import type { CodeChunk, EmbeddedChunk, SearchResult, IndexStatus } from "./types";

// Dynamic import for sqlite-vec to handle platform-specific loading
let sqliteVec: typeof import("sqlite-vec") | null = null;
let customSqliteConfigured = false;

/**
 * Configure custom SQLite for macOS to enable extension loading.
 * Must be called before any Database instantiation.
 */
function configureCustomSqlite(): void {
	if (customSqliteConfigured) return;
	customSqliteConfigured = true;

	// Only needed on macOS - Apple's SQLite doesn't support extension loading
	if (process.platform !== "darwin") return;

	// Common Homebrew sqlite paths
	const sqlitePaths = [
		"/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib", // Apple Silicon
		"/usr/local/opt/sqlite/lib/libsqlite3.dylib", // Intel Mac
		"/opt/homebrew/lib/libsqlite3.dylib",
		"/usr/local/lib/libsqlite3.dylib",
	];

	for (const path of sqlitePaths) {
		if (existsSync(path)) {
			try {
				Database.setCustomSQLite(path);
				return;
			} catch {
				// Try next path
			}
		}
	}

	// No custom SQLite found - will fail later with helpful error
}

// CRITICAL: Configure custom SQLite at module load time, before any Database is created
configureCustomSqlite();

async function loadSqliteVec(): Promise<typeof import("sqlite-vec")> {
	if (sqliteVec) return sqliteVec;
	try {
		sqliteVec = await import("sqlite-vec");
		return sqliteVec;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(
			`Failed to load sqlite-vec module: ${message}\n` +
				`Ensure sqlite-vec is installed: bun install sqlite-vec`
		);
	}
}

/**
 * Error interface for sqlite-vec extension loading failures
 */
export interface SqliteVecError extends Error {
	name: "SqliteVecError";
	cause?: Error;
	hint?: string;
}

/**
 * Create a SqliteVecError with actionable hints
 */
export function createSqliteVecError(message: string, cause?: Error, hint?: string): SqliteVecError {
	const error = new Error(message) as SqliteVecError;
	error.name = "SqliteVecError";
	error.cause = cause;
	error.hint = hint;
	return error;
}

/**
 * Type guard for SqliteVecError
 */
export function isSqliteVecError(error: unknown): error is SqliteVecError {
	return error instanceof Error && error.name === "SqliteVecError";
}

/**
 * Vector store using SQLite-vec for semantic search
 */
export class VectorStore {
	private db: Database | null = null;
	private dbPath: string;
	private dimension: number;

	constructor(dbPath: string, dimension: number = 768) {
		this.dbPath = dbPath;
		this.dimension = dimension;
	}

	/**
	 * Initialize the database and create tables
	 */
	async initialize(): Promise<void> {
		// Configure custom SQLite BEFORE any Database instantiation (macOS requirement)
		configureCustomSqlite();

		const vec = await loadSqliteVec();

		// Ensure the directory exists
		const dir = dirname(this.dbPath);
		await mkdir(dir, { recursive: true });

		// Create database using bun:sqlite
		try {
			this.db = new Database(this.dbPath);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw createSqliteVecError(
				`Failed to open database at ${this.dbPath}: ${message}`,
				error instanceof Error ? error : undefined,
				"Check that the directory is writable and has sufficient disk space"
			);
		}

		// Load sqlite-vec extension
		try {
			vec.load(this.db);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);

			// Provide specific hints based on error type
			let hint = "Run: bun install sqlite-vec";
			if (message.includes("Unsupported platform")) {
				hint = `Your platform may not be supported by sqlite-vec. Check https://github.com/asg017/sqlite-vec for supported platforms.`;
			} else if (message.includes("Loadable extension") || message.includes("not found")) {
				hint = `The sqlite-vec native extension was not found. Try:\n  1. rm -rf node_modules && bun install\n  2. Ensure sqlite-vec-darwin-arm64 (or your platform) is installed`;
			} else if (message.includes("does not support dynamic extension loading")) {
				hint =
					process.platform === "darwin"
						? `macOS requires Homebrew SQLite for extension loading.\n\nInstall with:\n  brew install sqlite\n\nThen retry. The package will automatically detect the Homebrew SQLite.`
						: `SQLite was built without extension support. Install a SQLite version with extension loading enabled.`;
			}

			this.db?.close();
			this.db = null;

			throw createSqliteVecError(
				`Failed to load sqlite-vec extension: ${message}`,
				error instanceof Error ? error : undefined,
				hint
			);
		}

		// Validate that the extension loaded correctly by testing a vec function
		try {
			const result = this.db.prepare("SELECT vec_version() as version").get() as { version: string } | undefined;
			if (!result?.version) {
				throw new Error("vec_version() returned null");
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.db?.close();
			this.db = null;

			throw createSqliteVecError(
				`sqlite-vec extension loaded but validation failed: ${message}`,
				error instanceof Error ? error : undefined,
				"The extension may be corrupted or incompatible. Try reinstalling: rm -rf node_modules && bun install"
			);
		}

		// Create vector table for chunks
		try {
			this.db.exec(`
				CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
					chunk_id INTEGER PRIMARY KEY,
					file_path TEXT,
					embedding float[${this.dimension}],
					+content TEXT,
					+metadata TEXT
				);

				CREATE TABLE IF NOT EXISTS chunks (
					id INTEGER PRIMARY KEY,
					file_path TEXT NOT NULL,
					start_line INTEGER NOT NULL,
					end_line INTEGER NOT NULL,
					content TEXT NOT NULL,
					chunk_type TEXT NOT NULL,
					symbol_name TEXT,
					language TEXT NOT NULL,
					content_hash TEXT NOT NULL,
					created_at TEXT DEFAULT CURRENT_TIMESTAMP
				);

				CREATE INDEX IF NOT EXISTS idx_chunks_file_path ON chunks(file_path);
				CREATE INDEX IF NOT EXISTS idx_chunks_content_hash ON chunks(content_hash);

				CREATE TABLE IF NOT EXISTS indexed_files (
					file_path TEXT PRIMARY KEY,
					content_hash TEXT NOT NULL,
					chunk_count INTEGER NOT NULL,
					indexed_at TEXT DEFAULT CURRENT_TIMESTAMP
				);
			`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.db?.close();
			this.db = null;

			throw createSqliteVecError(
				`Failed to create database tables: ${message}`,
				error instanceof Error ? error : undefined,
				"The database file may be corrupted. Try deleting .opencode/semantic-search.db and reinitializing."
			);
		}
	}

	/**
	 * Insert chunks with embeddings
	 */
	insertChunks(chunks: EmbeddedChunk[]): void {
		if (!this.db) throw new Error("VectorStore not initialized");

		// Use NULL for id to let SQLite auto-generate via ROWID
		const insertChunk = this.db.prepare(`
			INSERT INTO chunks (file_path, start_line, end_line, content, chunk_type, symbol_name, language, content_hash)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`);

		const insertVec = this.db.prepare(`
			INSERT INTO vec_chunks (chunk_id, file_path, embedding, content, metadata)
			VALUES (?, ?, vec_f32(?), ?, ?)
		`);

		const transaction = this.db.transaction((items: EmbeddedChunk[]) => {
			for (const chunk of items) {
				// Insert chunk metadata (id auto-generated)
				insertChunk.run(
					chunk.filePath,
					chunk.startLine,
					chunk.endLine,
					chunk.content,
					chunk.chunkType,
					chunk.symbolName ?? null,
					chunk.language,
					chunk.contentHash
				);

				// Get the auto-generated ID
				const lastId = this.db!.prepare("SELECT last_insert_rowid() as id").get() as { id: number };

				// Insert vector with the generated ID
				const metadata = JSON.stringify({
					startLine: chunk.startLine,
					endLine: chunk.endLine,
					chunkType: chunk.chunkType,
					symbolName: chunk.symbolName,
				});

				insertVec.run(
					BigInt(lastId.id),
					chunk.filePath,
					new Float32Array(chunk.embedding),
					chunk.content,
					metadata
				);
			}
		});

		transaction(chunks);
	}

	/**
	 * Search for similar chunks
	 */
	search(queryEmbedding: number[], limit: number = 10, filePath?: string): SearchResult[] {
		if (!this.db) throw new Error("VectorStore not initialized");

		// sqlite-vec requires 'k = ?' syntax for KNN queries, not standard LIMIT
		let sql = `
			SELECT
				v.chunk_id,
				v.file_path,
				v.distance,
				v.content,
				v.metadata,
				c.start_line,
				c.end_line,
				c.chunk_type,
				c.symbol_name,
				c.language,
				c.content_hash
			FROM vec_chunks v
			JOIN chunks c ON c.id = v.chunk_id
			WHERE v.embedding MATCH ?
			  AND k = ?
		`;

		const params: (Float32Array | number | string | bigint)[] = [new Float32Array(queryEmbedding), limit];

		if (filePath) {
			sql += ` AND v.file_path = ?`;
			params.push(filePath);
		}

		sql += ` ORDER BY v.distance`;

		const stmt = this.db.prepare(sql);
		const rows = stmt.all(...params) as Array<{
			chunk_id: bigint;
			file_path: string;
			distance: number;
			content: string;
			metadata: string;
			start_line: number;
			end_line: number;
			chunk_type: string;
			symbol_name: string | null;
			language: string;
			content_hash: string;
		}>;

		return rows.map((row) => ({
			chunk: {
				id: Number(row.chunk_id),
				filePath: row.file_path,
				startLine: row.start_line,
				endLine: row.end_line,
				content: row.content,
				chunkType: row.chunk_type as CodeChunk["chunkType"],
				symbolName: row.symbol_name ?? undefined,
				language: row.language,
				contentHash: row.content_hash,
			},
			score: 1 - row.distance, // Convert distance to similarity score
			distance: row.distance,
		}));
	}

	/**
	 * Delete all chunks for a file
	 */
	deleteFile(filePath: string): void {
		if (!this.db) throw new Error("VectorStore not initialized");

		// Get chunk IDs for the file
		const chunks = this.db
			.prepare("SELECT id FROM chunks WHERE file_path = ?")
			.all(filePath) as Array<{ id: number }>;

		// Delete from vector table
		const deleteVec = this.db.prepare("DELETE FROM vec_chunks WHERE chunk_id = ?");
		for (const chunk of chunks) {
			deleteVec.run(BigInt(chunk.id));
		}

		// Delete from chunks table
		this.db.prepare("DELETE FROM chunks WHERE file_path = ?").run(filePath);

		// Delete from indexed files
		this.db.prepare("DELETE FROM indexed_files WHERE file_path = ?").run(filePath);
	}

	/**
	 * Check if a file is already indexed with the same hash
	 */
	isFileIndexed(filePath: string, contentHash: string): boolean {
		if (!this.db) throw new Error("VectorStore not initialized");

		const row = this.db
			.prepare("SELECT content_hash FROM indexed_files WHERE file_path = ?")
			.get(filePath) as { content_hash: string } | undefined;

		return row?.content_hash === contentHash;
	}

	/**
	 * Mark a file as indexed
	 */
	markFileIndexed(filePath: string, contentHash: string, chunkCount: number): void {
		if (!this.db) throw new Error("VectorStore not initialized");

		this.db
			.prepare(`
				INSERT OR REPLACE INTO indexed_files (file_path, content_hash, chunk_count, indexed_at)
				VALUES (?, ?, ?, CURRENT_TIMESTAMP)
			`)
			.run(filePath, contentHash, chunkCount);
	}

	/**
	 * Get index status
	 */
	getStatus(): IndexStatus {
		if (!this.db) {
			return {
				fileCount: 0,
				chunkCount: 0,
				lastUpdated: null,
				isIndexing: false,
				dbSizeBytes: 0,
			};
		}

		const fileCount = (this.db.prepare("SELECT COUNT(*) as count FROM indexed_files").get() as { count: number }).count;
		const chunkCount = (this.db.prepare("SELECT COUNT(*) as count FROM chunks").get() as { count: number }).count;
		const lastUpdated = this.db
			.prepare("SELECT MAX(indexed_at) as last FROM indexed_files")
			.get() as { last: string | null };

		// Get database file size
		let dbSizeBytes = 0;
		try {
			const stats = statSync(this.dbPath);
			dbSizeBytes = stats.size;
		} catch {}

		return {
			fileCount,
			chunkCount,
			lastUpdated: lastUpdated.last ? new Date(lastUpdated.last) : null,
			isIndexing: false,
			dbSizeBytes,
		};
	}

	/**
	 * Get the next available chunk ID
	 */
	getNextChunkId(): number {
		if (!this.db) throw new Error("VectorStore not initialized");

		const result = this.db.prepare("SELECT MAX(id) as maxId FROM chunks").get() as { maxId: number | null };
		return (result.maxId ?? 0) + 1;
	}

	/**
	 * Close the database connection
	 */
	close(): void {
		this.db?.close();
		this.db = null;
	}
}
