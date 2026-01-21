/**
 * Code Graph Index Manager
 *
 * Manages the dependency graph lifecycle.
 */

import { join, relative } from "path";
import { GraphStore } from "./graph-store";
import { parseFileDependencies } from "./parser";
import type { ImpactAnalysis } from "./types";

/**
 * Code graph index manager
 */
export class CodeGraphIndex {
	private store: GraphStore;
	private workspaceRoot: string;
	private dbPath: string;

	constructor(workspaceRoot: string, dbPath: string = ".opencode/code-graph.db") {
		this.workspaceRoot = workspaceRoot;
		this.dbPath = join(workspaceRoot, dbPath);
		this.store = new GraphStore(this.dbPath);
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
	 * Rebuild the entire graph
	 */
	async rebuildGraph(): Promise<{ filesIndexed: number; edgesCreated: number }> {
		let filesIndexed = 0;
		let edgesCreated = 0;

		// Find all TypeScript/JavaScript files
		const patterns = ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx", "**/*.mjs", "**/*.cjs"];
		const excludes = ["**/node_modules/**", "**/dist/**", "**/.git/**", "**/build/**"];

		for (const pattern of patterns) {
			const glob = new Bun.Glob(pattern);

			for await (const file of glob.scan({ cwd: this.workspaceRoot })) {
				// Check excludes
				let excluded = false;
				for (const exclude of excludes) {
					const excludeRegex = exclude.replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*");
					if (new RegExp(excludeRegex).test(file)) {
						excluded = true;
						break;
					}
				}
				if (excluded) continue;

				const edges = await this.indexFile(file);
				if (edges >= 0) {
					filesIndexed++;
					edgesCreated += edges;
				}
			}
		}

		return { filesIndexed, edgesCreated };
	}

	/**
	 * Find files that depend on a given file
	 */
	findDependents(filePath: string, transitive: boolean = false): string[] {
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
	findDependencies(filePath: string): string[] {
		const relativePath = filePath.startsWith("/") 
			? relative(this.workspaceRoot, filePath) 
			: filePath;
		const nodeId = `file:${relativePath}`;

		return this.store.getDependencies(nodeId).map((n) => n.filePath);
	}

	/**
	 * Analyze impact of changing a file
	 */
	analyzeImpact(filePath: string): ImpactAnalysis {
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
	 * Close the graph store
	 */
	close(): void {
		this.store.close();
	}
}
