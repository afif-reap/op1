/**
 * Vector Store
 *
 * SQLite-vec based vector storage for semantic search.
 */

import { Database } from "bun:sqlite";
import type { CodeChunk, EmbeddedChunk, SearchResult, IndexStatus } from "./types";

// Dynamic import for sqlite-vec to handle platform-specific loading
let sqliteVec: typeof import("sqlite-vec") | null = null;

async function loadSqliteVec(): Promise<typeof import("sqlite-vec")> {
	if (sqliteVec) return sqliteVec;
	sqliteVec = await import("sqlite-vec");
	return sqliteVec;
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
		const vec = await loadSqliteVec();

		this.db = new Database(this.dbPath);
		vec.load(this.db);

		// Create vector table for chunks
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
	}

	/**
	 * Insert chunks with embeddings
	 */
	insertChunks(chunks: EmbeddedChunk[]): void {
		if (!this.db) throw new Error("VectorStore not initialized");

		const insertChunk = this.db.prepare(`
			INSERT INTO chunks (id, file_path, start_line, end_line, content, chunk_type, symbol_name, language, content_hash)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);

		const insertVec = this.db.prepare(`
			INSERT INTO vec_chunks (chunk_id, file_path, embedding, content, metadata)
			VALUES (?, ?, vec_f32(?), ?, ?)
		`);

		const transaction = this.db.transaction((items: EmbeddedChunk[]) => {
			for (const chunk of items) {
				// Insert chunk metadata
				insertChunk.run(
					chunk.id,
					chunk.filePath,
					chunk.startLine,
					chunk.endLine,
					chunk.content,
					chunk.chunkType,
					chunk.symbolName ?? null,
					chunk.language,
					chunk.contentHash
				);

				// Insert vector
				const metadata = JSON.stringify({
					startLine: chunk.startLine,
					endLine: chunk.endLine,
					chunkType: chunk.chunkType,
					symbolName: chunk.symbolName,
				});

				insertVec.run(
					BigInt(chunk.id),
					chunk.filePath,
					new Uint8Array(new Float32Array(chunk.embedding).buffer),
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
		`;

		const params: (Uint8Array | number | string | bigint)[] = [new Uint8Array(new Float32Array(queryEmbedding).buffer)];

		if (filePath) {
			sql += ` AND v.file_path = ?`;
			params.push(filePath);
		}

		sql += ` ORDER BY v.distance LIMIT ?`;
		params.push(limit);

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
			const file = Bun.file(this.dbPath);
			dbSizeBytes = file.size;
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
