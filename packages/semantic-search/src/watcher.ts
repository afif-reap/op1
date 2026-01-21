/**
 * File Watcher for Semantic Search
 *
 * Debounced file watching with chokidar for automatic index updates.
 * Uses 500ms debounce delay to batch rapid file changes.
 */

import { watch, type FSWatcher } from "fs";
import { join, relative } from "path";
import type { FileChange } from "./types";

/**
 * Watcher configuration options
 */
export interface WatcherConfig {
	/** Debounce delay in milliseconds (default: 500) */
	debounceMs: number;
	/** File patterns to include */
	includePatterns: string[];
	/** File patterns to exclude */
	excludePatterns: string[];
	/** Whether to use polling (for network filesystems) */
	usePolling: boolean;
	/** Polling interval if usePolling is true */
	pollInterval: number;
}

const DEFAULT_WATCHER_CONFIG: WatcherConfig = {
	debounceMs: 500,
	includePatterns: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.py", "**/*.go", "**/*.rs"],
	excludePatterns: ["**/node_modules/**", "**/dist/**", "**/.git/**", "**/build/**", "**/*.min.js"],
	usePolling: false,
	pollInterval: 1000,
};

/**
 * Debounced file watcher for semantic search index
 */
export class FileWatcher {
	private watcher: FSWatcher | null = null;
	private pendingChanges: Map<string, FileChange> = new Map();
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private config: WatcherConfig;
	private workspaceRoot: string;
	private onChanges: ((changes: FileChange[]) => void) | null = null;
	private isWatching = false;

	constructor(workspaceRoot: string, config: Partial<WatcherConfig> = {}) {
		this.workspaceRoot = workspaceRoot;
		this.config = { ...DEFAULT_WATCHER_CONFIG, ...config };
	}

	/**
	 * Start watching for file changes
	 */
	start(onChanges: (changes: FileChange[]) => void): void {
		if (this.isWatching) {
			return;
		}

		this.onChanges = onChanges;
		this.isWatching = true;

		// Use native fs.watch with recursive option (Bun/Node 20+)
		try {
			this.watcher = watch(
				this.workspaceRoot,
				{ recursive: true },
				(eventType, filename) => {
					if (!filename) return;

					const filePath = relative(this.workspaceRoot, join(this.workspaceRoot, filename));

					// Skip excluded patterns
					if (this.shouldExclude(filePath)) {
						return;
					}

					// Skip non-matching patterns
					if (!this.shouldInclude(filePath)) {
						return;
					}

					// Determine change type
					const changeType = eventType === "rename" ? "add" : "change";

					this.queueChange({
						type: changeType,
						filePath,
					});
				}
			);

			this.watcher.on("error", (error) => {
				console.error("File watcher error:", error);
			});
		} catch (error) {
			console.error("Failed to start file watcher:", error);
			this.isWatching = false;
		}
	}

	/**
	 * Stop watching for file changes
	 */
	stop(): void {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}

		if (this.watcher) {
			this.watcher.close();
			this.watcher = null;
		}

		this.pendingChanges.clear();
		this.isWatching = false;
	}

	/**
	 * Queue a file change with debouncing
	 */
	private queueChange(change: FileChange): void {
		// Merge changes: delete > add > change priority
		const existing = this.pendingChanges.get(change.filePath);
		if (existing) {
			// If already marked for delete, keep it
			if (existing.type === "unlink") {
				return;
			}
			// If new change is delete, upgrade
			if (change.type === "unlink") {
				this.pendingChanges.set(change.filePath, change);
			}
			// Otherwise keep the first change type (add takes precedence over change)
		} else {
			this.pendingChanges.set(change.filePath, change);
		}

		// Reset debounce timer
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
		}

		this.debounceTimer = setTimeout(() => {
			this.flushChanges();
		}, this.config.debounceMs);
	}

	/**
	 * Flush all pending changes
	 */
	private async flushChanges(): Promise<void> {
		if (this.pendingChanges.size === 0) {
			return;
		}

		const changes = Array.from(this.pendingChanges.values());
		this.pendingChanges.clear();
		this.debounceTimer = null;

		// Verify file existence for add/change events
		const verifiedChanges: FileChange[] = [];
		for (const change of changes) {
			if (change.type === "unlink") {
				verifiedChanges.push(change);
				continue;
			}

			const absolutePath = join(this.workspaceRoot, change.filePath);
			try {
				const file = Bun.file(absolutePath);
				const exists = await file.exists();

				if (exists) {
					verifiedChanges.push(change);
				} else {
					// File was deleted, convert to unlink
					verifiedChanges.push({ type: "unlink", filePath: change.filePath });
				}
			} catch {
				// File doesn't exist or can't be accessed
				verifiedChanges.push({ type: "unlink", filePath: change.filePath });
			}
		}

		if (verifiedChanges.length > 0 && this.onChanges) {
			this.onChanges(verifiedChanges);
		}
	}

	/**
	 * Check if a file should be excluded
	 */
	private shouldExclude(filePath: string): boolean {
		return this.config.excludePatterns.some((pattern) => {
			// Simple glob matching for common patterns
			if (pattern.includes("**")) {
				const regex = pattern
					.replace(/\*\*/g, ".*")
					.replace(/\*/g, "[^/]*")
					.replace(/\./g, "\\.");
				return new RegExp(regex).test(filePath);
			}
			return filePath.includes(pattern.replace(/\*/g, ""));
		});
	}

	/**
	 * Check if a file should be included
	 */
	private shouldInclude(filePath: string): boolean {
		return this.config.includePatterns.some((pattern) => {
			// Extract extension from pattern like "**/*.ts"
			const extMatch = pattern.match(/\*\.(\w+)$/);
			if (extMatch) {
				return filePath.endsWith(`.${extMatch[1]}`);
			}
			return true;
		});
	}

	/**
	 * Force flush any pending changes immediately
	 */
	flush(): void {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
		this.flushChanges();
	}

	/**
	 * Check if watcher is active
	 */
	isActive(): boolean {
		return this.isWatching;
	}

	/**
	 * Get count of pending changes
	 */
	getPendingCount(): number {
		return this.pendingChanges.size;
	}
}

/**
 * Create a file watcher with chokidar for more robust watching
 * Falls back to native fs.watch if chokidar is not available
 */
export async function createChokidarWatcher(
	workspaceRoot: string,
	config: Partial<WatcherConfig> = {}
): Promise<FileWatcher> {
	// For now, use the native FileWatcher
	// Chokidar can be added as an optional dependency later
	return new FileWatcher(workspaceRoot, config);
}
