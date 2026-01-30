/**
 * Keyword Search - BM25 search via FTS5 trigram
 *
 * Provides keyword-based symbol search with exact symbol name boosting.
 */

import type { Database } from "bun:sqlite";

// ============================================================================
// Types
// ============================================================================

export interface KeywordSearchMatch {
	symbolId: string;
	name: string;
	qualifiedName: string;
	filePath: string;
	/** BM25 rank (lower is better match) */
	bm25Rank: number;
	/** Boosted score (higher is better) */
	score: number;
}

export interface KeywordSearchOptions {
	/** Maximum results to return (default: 20) */
	limit?: number;
	/** Boost factor for exact symbol name matches (default: 2.0) */
	exactNameBoost?: number;
}

export interface KeywordSearcher {
	search(query: string, options?: KeywordSearchOptions): KeywordSearchMatch[];
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_LIMIT = 20;
const DEFAULT_EXACT_NAME_BOOST = 2.0;

// ============================================================================
// Implementation
// ============================================================================

export function createKeywordSearcher(db: Database): KeywordSearcher {
	return {
		search(query: string, options?: KeywordSearchOptions): KeywordSearchMatch[] {
			const limit = options?.limit ?? DEFAULT_LIMIT;
			const exactNameBoost = options?.exactNameBoost ?? DEFAULT_EXACT_NAME_BOOST;

			// Guard: empty query returns empty results
			const escapedQuery = escapeQueryForFts5(query);
			if (!escapedQuery) return [];

			const rawResults = executeKeywordSearch(db, escapedQuery, limit * 2);
			if (rawResults.length === 0) return [];

			const boostedResults = applyExactNameBoost(rawResults, query, exactNameBoost);
			const sortedResults = sortByScoreDescending(boostedResults);

			return sortedResults.slice(0, limit);
		},
	};
}

// ============================================================================
// Pure Functions
// ============================================================================

function escapeQueryForFts5(query: string): string {
	// Remove FTS5 special characters that would cause syntax errors
	return query.replace(/[*"()]/g, " ").trim();
}

interface RawFtsResult {
	symbol_id: string;
	name: string;
	qualified_name: string;
	file_path: string;
	rank: number;
}

function executeKeywordSearch(
	db: Database,
	escapedQuery: string,
	limit: number,
): RawFtsResult[] {
	const searchStmt = db.prepare(`
		SELECT 
			symbol_id,
			name,
			qualified_name,
			file_path,
			bm25(fts_symbols) as rank
		FROM fts_symbols
		WHERE fts_symbols MATCH ?
		ORDER BY rank
		LIMIT ?
	`);

	try {
		return searchStmt.all(escapedQuery, limit) as RawFtsResult[];
	} catch {
		// FTS5 query syntax error - return empty
		return [];
	}
}

function applyExactNameBoost(
	results: RawFtsResult[],
	originalQuery: string,
	boostFactor: number,
): KeywordSearchMatch[] {
	const queryLower = originalQuery.toLowerCase();

	return results.map((row) => {
		// BM25 rank is negative (more negative = better match)
		// Convert to positive score where higher is better
		const baseScore = -row.rank;

		// Boost exact symbol name matches
		const isExactNameMatch = row.name.toLowerCase() === queryLower;
		const score = isExactNameMatch ? baseScore * boostFactor : baseScore;

		return {
			symbolId: row.symbol_id,
			name: row.name,
			qualifiedName: row.qualified_name,
			filePath: row.file_path,
			bm25Rank: row.rank,
			score,
		};
	});
}

function sortByScoreDescending(results: KeywordSearchMatch[]): KeywordSearchMatch[] {
	return [...results].sort((a, b) => b.score - a.score);
}
