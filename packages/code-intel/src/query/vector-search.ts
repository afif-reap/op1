/**
 * Vector Search - Semantic similarity search
 *
 * Provides semantic similarity search using either sqlite-vec (if available)
 * or pure JavaScript cosine similarity as fallback.
 */

import type { Database } from "bun:sqlite";

// ============================================================================
// Types
// ============================================================================

export interface VectorSearchMatch {
	symbolId: string;
	/** Distance (lower is more similar) */
	distance: number;
	/** Normalized similarity score 0-1 (higher is more similar) */
	similarity: number;
}

export interface VectorSearchOptions {
	/** Maximum results to return (default: 20) */
	limit?: number;
	/** Filter results to specific branch */
	branch?: string;
}

export interface VectorSearcher {
	search(embedding: number[], options?: VectorSearchOptions): VectorSearchMatch[];
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_LIMIT = 20;

// ============================================================================
// Vector Math Utilities (for pure JS fallback)
// ============================================================================

function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length) return 0;

	let dotProduct = 0;
	let normA = 0;
	let normB = 0;

	for (let i = 0; i < a.length; i++) {
		dotProduct += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}

	const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
	if (magnitude === 0) return 0;

	return dotProduct / magnitude;
}

function deserializeEmbedding(base64: string): number[] {
	const bytes = Buffer.from(base64, "base64");
	const float32 = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
	return Array.from(float32);
}

// ============================================================================
// Implementation
// ============================================================================

export function createVectorSearcher(db: Database): VectorSearcher {
	// Check which vector table exists
	let useJsVectors = false;
	let useSqliteVec = false;

	try {
		const jsCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='js_vectors'").get();
		useJsVectors = !!jsCheck;
	} catch {
		// Table doesn't exist
	}

	try {
		const vecCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vec_symbols'").get();
		useSqliteVec = !!vecCheck;
	} catch {
		// Table doesn't exist
	}

	return {
		search(embedding: number[], options?: VectorSearchOptions): VectorSearchMatch[] {
			const limit = options?.limit ?? DEFAULT_LIMIT;
			const branch = options?.branch;

			// Guard: empty embedding returns empty results
			if (embedding.length === 0) return [];

			// Try sqlite-vec first
			if (useSqliteVec) {
				try {
					return searchWithSqliteVec(db, embedding, limit, branch);
				} catch {
					// Fall through to JS search
				}
			}

			// Use pure JS vector search
			if (useJsVectors) {
				return searchWithPureJs(db, embedding, limit, branch);
			}

			// No vector store available
			return [];
		},
	};
}

// ============================================================================
// sqlite-vec Search (if available)
// ============================================================================

function serializeEmbedding(embedding: number[]): Uint8Array {
	const buffer = new Float32Array(embedding);
	return new Uint8Array(buffer.buffer);
}

function searchWithSqliteVec(
	db: Database,
	embedding: number[],
	limit: number,
	branch?: string,
): VectorSearchMatch[] {
	const blob = serializeEmbedding(embedding);

	const query = branch
		? `
			SELECT v.symbol_id, v.distance
			FROM vec_symbols v
			INNER JOIN symbols s ON s.id = v.symbol_id
			WHERE v.embedding MATCH ?
			  AND s.branch = ?
			ORDER BY v.distance
			LIMIT ?
		`
		: `
			SELECT symbol_id, distance
			FROM vec_symbols
			WHERE embedding MATCH ?
			ORDER BY distance
			LIMIT ?
		`;

	const stmt = db.prepare(query);
	const args = branch ? [blob, branch, limit] : [blob, limit];
	const rows = stmt.all(...args) as Array<{ symbol_id: string; distance: number }>;

	return rows.map((row) => ({
		symbolId: row.symbol_id,
		distance: row.distance,
		similarity: Math.max(0, 1 - row.distance),
	}));
}

// ============================================================================
// Pure JavaScript Search (fallback)
// ============================================================================

function searchWithPureJs(
	db: Database,
	queryEmbedding: number[],
	limit: number,
	branch?: string,
): VectorSearchMatch[] {
	// Get all vectors from js_vectors table
	const query = branch
		? `
			SELECT jv.symbol_id, jv.embedding
			FROM js_vectors jv
			INNER JOIN symbols s ON s.id = jv.symbol_id
			WHERE s.branch = ?
		`
		: `SELECT symbol_id, embedding FROM js_vectors`;

	const stmt = db.prepare(query);
	const rows = (branch ? stmt.all(branch) : stmt.all()) as Array<{
		symbol_id: string;
		embedding: string;
	}>;

	// Compute similarities
	const results: VectorSearchMatch[] = [];

	for (const row of rows) {
		try {
			const storedEmbedding = deserializeEmbedding(row.embedding);
			const similarity = cosineSimilarity(queryEmbedding, storedEmbedding);
			const distance = 1 - similarity;

			results.push({
				symbolId: row.symbol_id,
				distance,
				similarity,
			});
		} catch {
			// Skip corrupted embeddings
		}
	}

	// Sort by similarity (descending) and return top K
	results.sort((a, b) => b.similarity - a.similarity);
	return results.slice(0, limit);
}
