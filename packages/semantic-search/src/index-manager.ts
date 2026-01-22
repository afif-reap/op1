/**
 * Semantic Search Index Manager
 *
 * Manages the semantic search index lifecycle with:
 * - Merkle tree cache for efficient change detection
 * - Parallel file processing with concurrency control
 * - Debounced file watching for automatic updates
 * - Batch embedding with 100 chunks per request
 */

import { join } from "path";
import { VectorStore } from "./vector-store";
import { chunkCode, hashContent, shouldIndexFile } from "./chunker";
import { OpenAIEmbedder } from "./embedder";
import { createEmbedder, detectEmbedder } from "./embedder-factory";
import { MerkleCache } from "./merkle-cache";
import { FileWatcher } from "./watcher";
import type { Embedder, CodeChunk, EmbeddedChunk, SearchResult, IndexConfig, IndexStatus, FileChange } from "./types";

const DEFAULT_CONFIG: IndexConfig = {
	dbPath: ".opencode/semantic-search.db",
	embeddingDimension: 384, // Default to 384 for Transformers.js MiniLM (768 for OpenAI)
	maxChunkLines: 100,
	chunkOverlap: 10,
	includePatterns: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.py", "**/*.go", "**/*.rs"],
	excludePatterns: ["**/node_modules/**", "**/dist/**", "**/.git/**", "**/build/**", "**/*.min.js"],
};

/**
 * Extended config with performance options
 */
export interface ExtendedIndexConfig extends IndexConfig {
	/** Number of files to process in parallel (default: 10) */
	parallelism: number;
	/** Batch size for embedding requests (default: 100) */
	embeddingBatchSize: number;
	/** Enable file watching (default: false) */
	enableWatcher: boolean;
	/** Debounce delay for file watcher in ms (default: 500) */
	watcherDebounceMs: number;
	/** Path for Merkle cache file */
	cachePath: string;
	/** Enable auto-refresh on query - checks for changes before search (default: true) */
	autoRefresh: boolean;
	/** Max files to check during auto-refresh before skipping (default: 10000) */
	autoRefreshMaxFiles: number;
	/** Cooldown between auto-refresh checks in ms (default: 30000) */
	autoRefreshCooldownMs: number;
}

const DEFAULT_EXTENDED_CONFIG: ExtendedIndexConfig = {
	...DEFAULT_CONFIG,
	parallelism: 10,
	embeddingBatchSize: 100,
	enableWatcher: false,
	watcherDebounceMs: 500,
	cachePath: ".opencode/semantic-search-cache.json",
	autoRefresh: true,
	autoRefreshMaxFiles: 10000,
	autoRefreshCooldownMs: 30000,
};

/**
 * Progress event for index operations
 */
export interface IndexProgress {
	phase: "scanning" | "hashing" | "embedding" | "storing" | "complete";
	current: number;
	total: number;
	currentFile?: string;
}

/**
 * Semantic search index manager
 */
export class SemanticSearchIndex {
	private store: VectorStore;
	private embedder: Embedder;
	private config: ExtendedIndexConfig;
	private workspaceRoot: string;
	private isIndexing = false;
	private merkleCache: MerkleCache;
	private watcher: FileWatcher | null = null;
	private onProgress: ((progress: IndexProgress) => void) | null = null;
	private lastRefreshCheck: number = 0;

	constructor(
		workspaceRoot: string,
		options: {
			config?: Partial<ExtendedIndexConfig>;
			embedder?: Embedder;
			onProgress?: (progress: IndexProgress) => void;
		} = {}
	) {
		this.workspaceRoot = workspaceRoot;
		this.config = { ...DEFAULT_EXTENDED_CONFIG, ...options.config };
		// Embedder will be set during initialize() if not provided
		this.embedder = options.embedder ?? null as unknown as Embedder;
		this.onProgress = options.onProgress ?? null;
		this.merkleCache = new MerkleCache(workspaceRoot);
		
		const dbPath = join(workspaceRoot, this.config.dbPath);
		this.store = new VectorStore(dbPath, this.config.embeddingDimension);
	}

	/**
	 * Initialize the index and optionally start file watching.
	 * Auto-detects embedder if not provided (Transformers.js preferred, OpenAI fallback).
	 */
	async initialize(): Promise<void> {
		await this.store.initialize();

		// Auto-detect embedder if not provided
		if (!this.embedder) {
			try {
				const config = await detectEmbedder();
				
				// Update dimension based on detected embedder
				if (config.dimension !== this.config.embeddingDimension) {
					this.config.embeddingDimension = config.dimension;
					
					// Recreate store with correct dimension
					this.store.close();
					const dbPath = join(this.workspaceRoot, this.config.dbPath);
					this.store = new VectorStore(dbPath, config.dimension);
					await this.store.initialize();
				}
				
				this.embedder = await createEmbedder({
					dimension: config.dimension,
				});
			} catch (error) {
				const err = error as Error;
				throw new Error(`Failed to initialize embedder: ${err.message}`);
			}
		}

		// Load Merkle cache
		const cachePath = join(this.workspaceRoot, this.config.cachePath);
		this.merkleCache = await MerkleCache.load(this.workspaceRoot, cachePath);

		// Start file watcher if enabled
		if (this.config.enableWatcher) {
			this.startWatching();
		}
	}

	/**
	 * Start watching for file changes
	 */
	startWatching(): void {
		if (this.watcher) return;

		this.watcher = new FileWatcher(this.workspaceRoot, {
			debounceMs: this.config.watcherDebounceMs,
			includePatterns: this.config.includePatterns,
			excludePatterns: this.config.excludePatterns,
		});

		this.watcher.start(async (changes: FileChange[]) => {
			await this.handleFileChanges(changes);
		});
	}

	/**
	 * Stop watching for file changes
	 */
	stopWatching(): void {
		if (this.watcher) {
			this.watcher.stop();
			this.watcher = null;
		}
	}

	/**
	 * Handle file changes from watcher
	 */
	private async handleFileChanges(changes: FileChange[]): Promise<void> {
		if (this.isIndexing) return; // Skip if already indexing

		for (const change of changes) {
			if (change.type === "unlink") {
				this.store.deleteFile(change.filePath);
				this.merkleCache.removeFile(change.filePath);
			} else {
				await this.indexFile(change.filePath);
			}
		}

		// Save cache after processing changes
		const cachePath = join(this.workspaceRoot, this.config.cachePath);
		await this.merkleCache.save(cachePath);
	}

	/**
	 * Ensure index is fresh by checking for file changes.
	 * Uses cooldown to prevent excessive checks on rapid queries.
	 * Only runs if autoRefresh is enabled.
	 */
	async ensureFresh(): Promise<{ checked: boolean; updated: boolean; filesChanged: number }> {
		// Skip if auto-refresh disabled
		if (!this.config.autoRefresh) {
			return { checked: false, updated: false, filesChanged: 0 };
		}

		// Skip if already indexing
		if (this.isIndexing) {
			return { checked: false, updated: false, filesChanged: 0 };
		}

		// Check cooldown
		const now = Date.now();
		if (now - this.lastRefreshCheck < this.config.autoRefreshCooldownMs) {
			return { checked: false, updated: false, filesChanged: 0 };
		}

		this.lastRefreshCheck = now;

		try {
			// Scan files matching patterns
			const files: string[] = [];
			const seen = new Set<string>();

			for (const pattern of this.config.includePatterns) {
				const glob = new Bun.Glob(pattern);
				for await (const file of glob.scan({ cwd: this.workspaceRoot })) {
					// Check excludes
					const excluded = this.config.excludePatterns.some((ex) => {
						const exGlob = new Bun.Glob(ex);
						return exGlob.match(file);
					});
					if (!seen.has(file) && !excluded) {
						seen.add(file);
						files.push(file);
					}

					// Skip if too many files (large repo safeguard)
					if (files.length > this.config.autoRefreshMaxFiles) {
						return { checked: true, updated: false, filesChanged: 0 };
					}
				}
			}

			// Use Merkle cache to find changes (uses mtime+size fast path)
			// IMPORTANT: findChangedFiles updates the cache as a side effect,
			// so we must index the detected files directly, not call updateIndex()
			const { added, modified } = await this.merkleCache.findChangedFiles(files);
			const currentFiles = new Set(files);
			const deleted = this.merkleCache.findDeletedFiles(currentFiles);

			const totalChanges = added.length + modified.length + deleted.length;

			if (totalChanges === 0) {
				return { checked: true, updated: false, filesChanged: 0 };
			}

			// Index changed files directly (don't call updateIndex which would re-scan)
			this.isIndexing = true;
			try {
				// Handle deleted files
				for (const file of deleted) {
					this.store.deleteFile(file);
					this.merkleCache.removeFile(file);
				}

				// Index added and modified files
				const filesToIndex = [...added, ...modified];
				await this.indexFilesParallel(filesToIndex);

				// Save Merkle cache
				const cachePath = join(this.workspaceRoot, this.config.cachePath);
				await this.merkleCache.save(cachePath);
			} finally {
				this.isIndexing = false;
			}

			return { checked: true, updated: true, filesChanged: totalChanges };
		} catch (e) {
			// Don't fail queries due to refresh errors
			console.error("Auto-refresh check failed:", e);
			return { checked: true, updated: false, filesChanged: 0 };
		}
	}

	/**
	 * Search for code using natural language
	 */
	async search(
		query: string,
		options: { limit?: number; filePath?: string } = {}
	): Promise<SearchResult[]> {
		// Auto-refresh if enabled
		await this.ensureFresh();

		const queryEmbedding = await this.embedder.embed(query);
		return this.store.search(queryEmbedding, options.limit ?? 10, options.filePath);
	}

	/**
	 * Find code similar to a given snippet
	 */
	async findSimilar(
		code: string,
		options: { limit?: number } = {}
	): Promise<SearchResult[]> {
		// Auto-refresh if enabled
		await this.ensureFresh();

		const codeEmbedding = await this.embedder.embed(code);
		return this.store.search(codeEmbedding, options.limit ?? 5);
	}

	/**
	 * Find code similar to a specific location
	 */
	async findSimilarToLocation(
		filePath: string,
		line: number,
		options: { limit?: number } = {}
	): Promise<SearchResult[]> {
		// Auto-refresh if enabled
		await this.ensureFresh();

		const absolutePath = join(this.workspaceRoot, filePath);
		const content = await Bun.file(absolutePath).text();
		const lines = content.split("\n");
		
		// Get context around the line (5 lines before and after)
		const start = Math.max(0, line - 6);
		const end = Math.min(lines.length, line + 5);
		const context = lines.slice(start, end).join("\n");

		return this.findSimilar(context, { ...options, skipRefresh: true } as { limit?: number });
	}

	/**
	 * Index a single file
	 */
	async indexFile(filePath: string): Promise<number> {
		const absolutePath = join(this.workspaceRoot, filePath);
		
		try {
			const content = await Bun.file(absolutePath).text();
			const contentHash = hashContent(content);

			// Check if already indexed with same hash
			if (this.store.isFileIndexed(filePath, contentHash)) {
				return 0;
			}

			// Delete old chunks for this file
			this.store.deleteFile(filePath);

			// Chunk the file
			const chunks = chunkCode(filePath, content, {
				maxChunkLines: this.config.maxChunkLines,
				chunkOverlap: this.config.chunkOverlap,
			});

			if (chunks.length === 0) return 0;

			// Generate embeddings in batches
			const batchSize = 20;
			const embeddedChunks: EmbeddedChunk[] = [];

			for (let i = 0; i < chunks.length; i += batchSize) {
				const batch = chunks.slice(i, i + batchSize);
				const texts = batch.map((c) => `${c.symbolName ? `${c.chunkType} ${c.symbolName}:\n` : ""}${c.content}`);
				const embeddings = await this.embedder.embedBatch(texts);

				for (let j = 0; j < batch.length; j++) {
					embeddedChunks.push({
						...batch[j],
						embedding: embeddings[j],
					});
				}
			}

			// Insert into store
			this.store.insertChunks(embeddedChunks);
			this.store.markFileIndexed(filePath, contentHash, embeddedChunks.length);

			return embeddedChunks.length;
		} catch (e) {
			console.error(`Failed to index ${filePath}:`, e);
			return 0;
		}
	}

	/**
	 * Update index incrementally with parallel processing
	 */
	async updateIndex(): Promise<{ filesIndexed: number; chunksAdded: number }> {
		if (this.isIndexing) {
			throw new Error("Indexing already in progress");
		}

		this.isIndexing = true;
		let filesIndexed = 0;
		let chunksAdded = 0;

		try {
			// Phase 1: Scan files
			this.emitProgress({ phase: "scanning", current: 0, total: 0 });
			
			// Bun.Glob doesn't support comma-separated patterns, iterate each pattern
			const files: string[] = [];
			const seen = new Set<string>();

			for (const pattern of this.config.includePatterns) {
				const glob = new Bun.Glob(pattern);
				for await (const file of glob.scan({ cwd: this.workspaceRoot })) {
					// Bun.Glob handles include patterns, check excludes manually
					const excluded = this.config.excludePatterns.some((ex) => {
						const exGlob = new Bun.Glob(ex);
						return exGlob.match(file);
					});
					if (!seen.has(file) && !excluded) {
						seen.add(file);
						files.push(file);
					}
				}
			}

			this.emitProgress({ phase: "scanning", current: files.length, total: files.length });

			// Phase 2: Hash files and find changes using Merkle cache
			this.emitProgress({ phase: "hashing", current: 0, total: files.length });
			
			const { added, modified } = await this.merkleCache.findChangedFiles(files);
			const filesToIndex = [...added, ...modified];
			
			// Find deleted files
			const currentFiles = new Set(files);
			const deleted = this.merkleCache.findDeletedFiles(currentFiles);
			for (const file of deleted) {
				this.store.deleteFile(file);
				this.merkleCache.removeFile(file);
			}

			this.emitProgress({ phase: "hashing", current: files.length, total: files.length });

			if (filesToIndex.length === 0) {
				this.emitProgress({ phase: "complete", current: 0, total: 0 });
				return { filesIndexed: 0, chunksAdded: 0 };
			}

			// Phase 3: Index files in parallel with concurrency limit
			const results = await this.indexFilesParallel(filesToIndex);
			
			for (const result of results) {
				if (result.chunks > 0) {
					filesIndexed++;
					chunksAdded += result.chunks;
				}
			}

			// Save Merkle cache
			const cachePath = join(this.workspaceRoot, this.config.cachePath);
			await this.merkleCache.save(cachePath);

			this.emitProgress({ phase: "complete", current: filesIndexed, total: filesToIndex.length });
			return { filesIndexed, chunksAdded };
		} finally {
			this.isIndexing = false;
		}
	}

	/**
	 * Index multiple files in parallel with concurrency limit
	 */
	private async indexFilesParallel(files: string[]): Promise<Array<{ file: string; chunks: number }>> {
		const results: Array<{ file: string; chunks: number }> = [];
		const concurrency = this.config.parallelism;

		// Process files in batches for controlled concurrency
		for (let i = 0; i < files.length; i += concurrency) {
			const batch = files.slice(i, i + concurrency);
			
			this.emitProgress({ 
				phase: "embedding", 
				current: i, 
				total: files.length,
				currentFile: batch[0],
			});

			const batchResults = await Promise.all(
				batch.map(async (file) => {
					const chunks = await this.indexFile(file);
					return { file, chunks };
				})
			);

			results.push(...batchResults);
		}

		return results;
	}

	/**
	 * Emit progress event
	 */
	private emitProgress(progress: IndexProgress): void {
		if (this.onProgress) {
			this.onProgress(progress);
		}
	}

	/**
	 * Rebuild entire index from scratch
	 */
	async rebuildIndex(): Promise<{ filesIndexed: number; chunksAdded: number }> {
		// Close and delete existing database
		this.store.close();
		
		const dbPath = join(this.workspaceRoot, this.config.dbPath);
		try {
			await Bun.file(dbPath).exists() && await Bun.$`rm ${dbPath}`;
		} catch {}

		// Clear Merkle cache to force re-indexing all files
		const cachePath = join(this.workspaceRoot, this.config.cachePath);
		this.merkleCache = new MerkleCache(this.workspaceRoot);
		try {
			await Bun.file(cachePath).exists() && await Bun.$`rm ${cachePath}`;
		} catch {}

		// Reinitialize and rebuild
		this.store = new VectorStore(dbPath, this.config.embeddingDimension);
		await this.store.initialize();

		return this.updateIndex();
	}

	/**
	 * Get index status
	 */
	getStatus(): IndexStatus {
		const status = this.store.getStatus();
		return {
			...status,
			isIndexing: this.isIndexing,
		};
	}

	/**
	 * Close the index and stop watching
	 */
	close(): void {
		this.stopWatching();
		this.store.close();
	}

	/**
	 * Get the Merkle cache for external access
	 */
	getMerkleCache(): MerkleCache {
		return this.merkleCache;
	}

	/**
	 * Check if file watcher is active
	 */
	isWatching(): boolean {
		return this.watcher?.isActive() ?? false;
	}
}
