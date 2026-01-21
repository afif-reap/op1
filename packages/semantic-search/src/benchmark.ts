/**
 * Benchmark Utilities for Semantic Search
 *
 * Provides performance measurement tools for query latency optimization.
 * Target: <100ms for search queries.
 */

/**
 * Benchmark result for a single operation
 */
export interface BenchmarkResult {
	operation: string;
	durationMs: number;
	iterations: number;
	avgMs: number;
	minMs: number;
	maxMs: number;
	p50Ms: number;
	p95Ms: number;
	p99Ms: number;
}

/**
 * Run a benchmark on an async operation
 */
export async function benchmark<T>(
	name: string,
	operation: () => Promise<T>,
	iterations = 10
): Promise<BenchmarkResult> {
	const times: number[] = [];

	// Warmup run
	await operation();

	// Timed runs
	for (let i = 0; i < iterations; i++) {
		const start = performance.now();
		await operation();
		const end = performance.now();
		times.push(end - start);
	}

	times.sort((a, b) => a - b);

	return {
		operation: name,
		durationMs: times.reduce((a, b) => a + b, 0),
		iterations,
		avgMs: times.reduce((a, b) => a + b, 0) / iterations,
		minMs: times[0],
		maxMs: times[times.length - 1],
		p50Ms: times[Math.floor(iterations * 0.5)],
		p95Ms: times[Math.floor(iterations * 0.95)],
		p99Ms: times[Math.floor(iterations * 0.99)],
	};
}

/**
 * Format benchmark result as a table row
 */
export function formatBenchmark(result: BenchmarkResult): string {
	const status = result.p95Ms < 100 ? "✓" : "✗";
	return `${status} ${result.operation}: avg=${result.avgMs.toFixed(1)}ms, p50=${result.p50Ms.toFixed(1)}ms, p95=${result.p95Ms.toFixed(1)}ms, p99=${result.p99Ms.toFixed(1)}ms`;
}

/**
 * Timer utility for measuring individual operations
 */
export class Timer {
	private startTime: number;
	private marks: Map<string, number> = new Map();

	constructor() {
		this.startTime = performance.now();
	}

	/**
	 * Mark a point in time
	 */
	mark(name: string): void {
		this.marks.set(name, performance.now());
	}

	/**
	 * Get elapsed time since start or mark
	 */
	elapsed(fromMark?: string): number {
		const now = performance.now();
		const start = fromMark ? this.marks.get(fromMark) ?? this.startTime : this.startTime;
		return now - start;
	}

	/**
	 * Get elapsed time between two marks
	 */
	between(startMark: string, endMark: string): number {
		const start = this.marks.get(startMark);
		const end = this.marks.get(endMark);
		if (!start || !end) return 0;
		return end - start;
	}

	/**
	 * Reset the timer
	 */
	reset(): void {
		this.startTime = performance.now();
		this.marks.clear();
	}

	/**
	 * Get summary of all marks
	 */
	summary(): Record<string, number> {
		const result: Record<string, number> = {};
		let lastTime = this.startTime;

		for (const [name, time] of this.marks) {
			result[name] = time - lastTime;
			lastTime = time;
		}

		result.total = performance.now() - this.startTime;
		return result;
	}
}
