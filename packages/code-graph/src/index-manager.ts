/**
 * Code Graph Index Manager
 *
 * Manages the dependency graph lifecycle with:
 * - Merkle tree cache for efficient change detection
 * - Auto-refresh on query (checks for changes before queries)
 * - Incremental updates (only reindex changed files)
 */

import { join, relative } from "path";
import { GraphStore } from "./graph-store";
import { MerkleCache } from "./merkle-cache";
import { parseFileDependencies } from "./parser";
import type { ImpactAnalysis } from "./types";

/**
 * Code graph configuration
 */
export interface CodeGraphConfig {
	/** Database path relative to workspace (default: .opencode/code-graph.db) */
	dbPath: string;
	/** Merkle cache path relative to workspace (default: .opencode/code-graph-cache.json) */
	cachePath: string;
	/** File patterns to include */
	includePatterns: string[];
	/** File patterns to exclude */
	excludePatterns: string[];
	/** Enable auto-refresh on query (default: true) */
	autoRefresh: boolean;
	/** Max files to check during auto-refresh before skipping (default: 10000) */
	autoRefreshMaxFiles: number;
	/** Cooldown between auto-refresh checks in ms (default: 30000) */
	autoRefreshCooldownMs: number;
}

const DEFAULT_CONFIG: CodeGraphConfig = {
	dbPath: ".opencode/code-graph.db",
	cachePath: ".opencode/code-graph-cache.json",
	includePatterns: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.mjs", "**/*.cjs"],
	excludePatterns: ["**/node_modules/**", "**/dist/**", "**/.git/**", "**/build/**"],
	autoRefresh: true,
	autoRefreshMaxFiles: 10000,
	autoRefreshCooldownMs: 30000,
};

/**
 * Code graph index manager
 */
export class CodeGraphIndex {
	private store: GraphStore;
	private merkleCache: MerkleCache;
	private config: CodeGraphConfig;
	private workspaceRoot: string;
	private lastRefreshCheck: number = 0;
	private isIndexing: boolean = false;

	constructor(workspaceRoot: string, options: { config?: Partial<CodeGraphConfig> } = {}) {
		this.workspaceRoot = workspaceRoot;
		this.config = { ...DEFAULT_CONFIG, ...options.config };
		this.merkleCache = new MerkleCache(workspaceRoot);

		const dbPath = join(workspaceRoot, this.config.dbPath);
		this.store = new GraphStore(dbPath);
	}

	/**
	 * Initialize the index and load Merkle cache
	 */
	async initialize(): Promise<void> {
		const cachePath = join(this.workspaceRoot, this.config.cachePath);
		this.merkleCache = await MerkleCache.load(this.workspaceRoot, cachePath);
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
				for (const file of filesToIndex) {
					await this.indexFile(file);
				}

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
	 * Update index incrementally (only changed files)
	 */
	async updateIndex(): Promise<{ filesIndexed: number; edgesCreated: number }> {
		if (this.isIndexing) {
			throw new Error("Indexing already in progress");
		}

		this.isIndexing = true;
		let filesIndexed = 0;
		let edgesCreated = 0;

		try {
			// Scan files
			const files: string[] = [];
			const seen = new Set<string>();

			for (const pattern of this.config.includePatterns) {
				const glob = new Bun.Glob(pattern);
				for await (const file of glob.scan({ cwd: this.workspaceRoot })) {
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

			// Find changed files using Merkle cache
			const { added, modified } = await this.merkleCache.findChangedFiles(files);
			const filesToIndex = [...added, ...modified];

			// Find and remove deleted files
			const currentFiles = new Set(files);
			const deleted = this.merkleCache.findDeletedFiles(currentFiles);
			for (const file of deleted) {
				this.store.deleteFile(file);
				this.merkleCache.removeFile(file);
			}

			// Index changed files
			for (const file of filesToIndex) {
				const edges = await this.indexFile(file);
				if (edges >= 0) {
					filesIndexed++;
					edgesCreated += edges;
				}
			}

			// Save Merkle cache
			const cachePath = join(this.workspaceRoot, this.config.cachePath);
			await this.merkleCache.save(cachePath);

			return { filesIndexed, edgesCreated };
		} finally {
			this.isIndexing = false;
		}
	}

	/**
	 * Index a single file
	 */
	async indexFile(filePath: string): Promise<number> {
		const absolutePath = filePath.startsWith("/") ? filePath : join(this.workspaceRoot, filePath);
		const relativePath = relative(this.workspaceRoot, absolutePath);

		try {
			const deps = await parseFileDependencies(absolutePath, this.workspaceRoot);

			// Delete existing data for this file
			this.store.deleteFile(relativePath);

			// Add file node
			this.store.addNode({
				id: `file:${relativePath}`,
				type: "file",
				name: relativePath.split("/").pop() || relativePath,
				filePath: relativePath,
			});

			// Add edges for imports
			let edgeCount = 0;
			for (const [, resolvedPath] of deps.resolvedImports) {
				const targetRelative = relative(this.workspaceRoot, resolvedPath);

				// Ensure target node exists
				this.store.addNode({
					id: `file:${targetRelative}`,
					type: "file",
					name: targetRelative.split("/").pop() || targetRelative,
					filePath: targetRelative,
				});

				// Add import edge
				this.store.addEdge({
					from: `file:${relativePath}`,
					to: `file:${targetRelative}`,
					type: "imports",
				});
				edgeCount++;
			}

			return edgeCount;
		} catch (e) {
			console.error(`Failed to index ${filePath}:`, e);
			return 0;
		}
	}

	/**
	 * Rebuild the entire graph from scratch
	 */
	async rebuildGraph(): Promise<{ filesIndexed: number; edgesCreated: number }> {
		// Clear Merkle cache to force full rebuild
		const cachePath = join(this.workspaceRoot, this.config.cachePath);
		this.merkleCache = new MerkleCache(this.workspaceRoot);
		try {
			await Bun.file(cachePath).exists() && await Bun.$`rm ${cachePath}`;
		} catch {}

		// Clear database
		this.store.clear();

		// Run incremental update (which will index all files since cache is empty)
		return this.updateIndex();
	}

	/**
	 * Find files that depend on a given file
	 */
	async findDependents(filePath: string, transitive: boolean = false): Promise<string[]> {
		// Auto-refresh if enabled
		await this.ensureFresh();

		const relativePath = filePath.startsWith("/")
			? relative(this.workspaceRoot, filePath)
			: filePath;
		const nodeId = `file:${relativePath}`;

		if (transitive) {
			return this.store.getTransitiveDependents(nodeId);
		}

		return this.store.getDependents(nodeId).map((n) => n.filePath);
	}

	/**
	 * Find files that a given file depends on
	 */
	async findDependencies(filePath: string): Promise<string[]> {
		// Auto-refresh if enabled
		await this.ensureFresh();

		const relativePath = filePath.startsWith("/")
			? relative(this.workspaceRoot, filePath)
			: filePath;
		const nodeId = `file:${relativePath}`;

		return this.store.getDependencies(nodeId).map((n) => n.filePath);
	}

	/**
	 * Analyze impact of changing a file
	 */
	async analyzeImpact(filePath: string): Promise<ImpactAnalysis> {
		// Auto-refresh if enabled
		await this.ensureFresh();

		const relativePath = filePath.startsWith("/")
			? relative(this.workspaceRoot, filePath)
			: filePath;

		return this.store.analyzeImpact(relativePath);
	}

	/**
	 * Get graph statistics
	 */
	getStats(): { nodeCount: number; edgeCount: number; fileCount: number } {
		return this.store.getStats();
	}

	/**
	 * Get the Merkle cache for external access
	 */
	getMerkleCache(): MerkleCache {
		return this.merkleCache;
	}

	/**
	 * Close the graph store
	 */
	close(): void {
		this.store.close();
	}
}
