/**
 * Merkle Tree Cache for File Change Detection
 *
 * Provides efficient O(log n) verification and incremental cache invalidation
 * for tracking file changes in the semantic search index.
 */

import { createHash } from "crypto";
import { join } from "path";

/**
 * A node in the Merkle tree
 */
interface MerkleNode {
	hash: string;
	left?: MerkleNode;
	right?: MerkleNode;
	filePath?: string; // Only leaf nodes have file paths
}

/**
 * File hash record with metadata for fast cache validation
 */
export interface FileHashRecord {
	hash: string;
	mtime: number;
	size: number;
}

/**
 * Merkle tree cache for efficient file change detection
 */
export class MerkleCache {
	private fileHashes: Map<string, FileHashRecord> = new Map();
	private rootHash: string | null = null;
	private dirty = false;

	constructor(private workspaceRoot: string) {}

	/**
	 * Compute SHA256 hash of content
	 */
	static hashContent(content: string | Buffer): string {
		return createHash("sha256").update(content).digest("hex");
	}

	/**
	 * Compute hash of a file, using metadata cache when possible
	 */
	async hashFile(filePath: string): Promise<string | null> {
		const absolutePath = join(this.workspaceRoot, filePath);

		try {
			const file = Bun.file(absolutePath);
			const stats = await file.stat();

			// Check if we can use cached hash (same mtime and size)
			const cached = this.fileHashes.get(filePath);
			if (cached && cached.mtime === stats.mtimeMs && cached.size === stats.size) {
				return cached.hash;
			}

			// Compute new hash
			const content = await file.text();
			const hash = MerkleCache.hashContent(content);

			// Update cache
			this.fileHashes.set(filePath, {
				hash,
				mtime: stats.mtimeMs,
				size: stats.size,
			});
			this.dirty = true;

			return hash;
		} catch {
			return null;
		}
	}

	/**
	 * Check if a file has changed based on its content hash
	 */
	async hasFileChanged(filePath: string, knownHash: string): Promise<boolean> {
		const currentHash = await this.hashFile(filePath);
		return currentHash !== knownHash;
	}

	/**
	 * Build Merkle tree from current file hashes and return root hash
	 */
	buildTree(): string {
		const files = Array.from(this.fileHashes.entries())
			.sort(([a], [b]) => a.localeCompare(b)); // Deterministic ordering

		if (files.length === 0) {
			this.rootHash = MerkleCache.hashContent("");
			return this.rootHash;
		}

		// Build leaf nodes
		const leaves: MerkleNode[] = files.map(([filePath, record]) => ({
			hash: record.hash,
			filePath,
		}));

		// Build tree bottom-up
		let level = leaves;
		while (level.length > 1) {
			const nextLevel: MerkleNode[] = [];

			for (let i = 0; i < level.length; i += 2) {
				const left = level[i];
				const right = level[i + 1] ?? left; // Duplicate last node if odd

				const combinedHash = MerkleCache.hashContent(left.hash + right.hash);
				nextLevel.push({
					hash: combinedHash,
					left,
					right: level[i + 1] ? right : undefined,
				});
			}

			level = nextLevel;
		}

		this.rootHash = level[0].hash;
		this.dirty = false;
		return this.rootHash;
	}

	/**
	 * Get current root hash (rebuilds if dirty)
	 */
	getRootHash(): string {
		if (this.dirty || this.rootHash === null) {
			return this.buildTree();
		}
		return this.rootHash;
	}

	/**
	 * Update a single file hash (O(1) update, tree rebuild is lazy)
	 */
	updateFile(filePath: string, hash: string, mtime: number, size: number): void {
		this.fileHashes.set(filePath, { hash, mtime, size });
		this.dirty = true;
	}

	/**
	 * Remove a file from the cache
	 */
	removeFile(filePath: string): boolean {
		const existed = this.fileHashes.delete(filePath);
		if (existed) {
			this.dirty = true;
		}
		return existed;
	}

	/**
	 * Get all cached file paths
	 */
	getTrackedFiles(): string[] {
		return Array.from(this.fileHashes.keys());
	}

	/**
	 * Get file hash record
	 */
	getFileRecord(filePath: string): FileHashRecord | undefined {
		return this.fileHashes.get(filePath);
	}

	/**
	 * Check if workspace has changed since last tree build
	 */
	isDirty(): boolean {
		return this.dirty;
	}

	/**
	 * Get file count
	 */
	size(): number {
		return this.fileHashes.size;
	}

	/**
	 * Serialize cache to JSON for persistence
	 */
	serialize(): string {
		return JSON.stringify({
			version: 1,
			rootHash: this.rootHash,
			files: Array.from(this.fileHashes.entries()),
		});
	}

	/**
	 * Deserialize cache from JSON
	 */
	static deserialize(workspaceRoot: string, json: string): MerkleCache {
		const cache = new MerkleCache(workspaceRoot);

		try {
			const data = JSON.parse(json) as {
				version: number;
				rootHash: string | null;
				files: Array<[string, FileHashRecord]>;
			};

			if (data.version === 1) {
				cache.rootHash = data.rootHash;
				cache.fileHashes = new Map(data.files);
				cache.dirty = false;
			}
		} catch {
			// Invalid JSON, start fresh
		}

		return cache;
	}

	/**
	 * Load cache from disk
	 */
	static async load(workspaceRoot: string, cachePath: string): Promise<MerkleCache> {
		try {
			const content = await Bun.file(cachePath).text();
			return MerkleCache.deserialize(workspaceRoot, content);
		} catch {
			return new MerkleCache(workspaceRoot);
		}
	}

	/**
	 * Save cache to disk
	 */
	async save(cachePath: string): Promise<void> {
		await Bun.write(cachePath, this.serialize());
	}

	/**
	 * Batch hash multiple files in parallel
	 */
	async hashFiles(filePaths: string[], concurrency = 10): Promise<Map<string, string | null>> {
		const results = new Map<string, string | null>();

		// Process in batches for controlled concurrency
		for (let i = 0; i < filePaths.length; i += concurrency) {
			const batch = filePaths.slice(i, i + concurrency);
			const hashes = await Promise.all(batch.map((fp) => this.hashFile(fp)));

			for (let j = 0; j < batch.length; j++) {
				results.set(batch[j], hashes[j]);
			}
		}

		return results;
	}

	/**
	 * Find files that have changed compared to stored hashes
	 */
	async findChangedFiles(filePaths: string[]): Promise<{
		added: string[];
		modified: string[];
		unchanged: string[];
	}> {
		const added: string[] = [];
		const modified: string[] = [];
		const unchanged: string[] = [];

		const currentHashes = await this.hashFiles(filePaths);

		for (const [filePath, hash] of currentHashes) {
			if (hash === null) continue; // File doesn't exist or can't be read

			const cached = this.fileHashes.get(filePath);
			if (!cached) {
				added.push(filePath);
			} else if (cached.hash !== hash) {
				modified.push(filePath);
			} else {
				unchanged.push(filePath);
			}
		}

		return { added, modified, unchanged };
	}

	/**
	 * Find files that were deleted (in cache but not in provided list)
	 */
	findDeletedFiles(currentFiles: Set<string>): string[] {
		const deleted: string[] = [];

		for (const filePath of this.fileHashes.keys()) {
			if (!currentFiles.has(filePath)) {
				deleted.push(filePath);
			}
		}

		return deleted;
	}
}
