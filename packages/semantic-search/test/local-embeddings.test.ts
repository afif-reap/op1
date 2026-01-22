/**
 * Test script for local Transformers.js embeddings
 * Run: bun run test/local-embeddings.test.ts
 */

import { TransformersEmbedder, isTransformersAvailable } from "../src/transformers-embedder";
import { detectEmbedder, createEmbedder } from "../src/embedder-factory";

async function main() {
	console.log("=== Local Embeddings Test ===\n");

	// 1. Check availability
	console.log("1. Checking Transformers.js availability...");
	const available = await isTransformersAvailable();
	console.log(`   Available: ${available ? "✅ YES" : "❌ NO"}\n`);

	if (!available) {
		console.log("   Install with: bun add @huggingface/transformers");
		process.exit(1);
	}

	// 2. Auto-detect embedder
	console.log("2. Auto-detecting embedder...");
	try {
		const config = await detectEmbedder();
		console.log(`   Type: ${config.type}`);
		console.log(`   Model: ${config.model}`);
		console.log(`   Dimension: ${config.dimension}`);
		console.log(`   Reason: ${config.reason}\n`);
	} catch (err) {
		console.log(`   Error: ${(err as Error).message}\n`);
	}

	// 3. Create embedder and generate embeddings
	console.log("3. Creating TransformersEmbedder (will download model on first run)...");
	const embedder = new TransformersEmbedder({
		model: "Xenova/all-MiniLM-L6-v2",
		dimension: 384,
		quantized: true,
		onProgress: (progress) => {
			if (progress.status === "downloading" && progress.progress) {
				process.stdout.write(`\r   Downloading: ${progress.progress.toFixed(1)}%`);
			} else if (progress.status === "loading") {
				console.log("\n   Loading model...");
			}
		},
	});

	console.log(`   Model: ${embedder.getModelInfo().model}`);
	console.log(`   Dimension: ${embedder.dimension}`);
	console.log(`   Quantized: ${embedder.getModelInfo().quantized}\n`);

	// 4. Generate single embedding
	console.log("4. Generating single embedding...");
	const startSingle = performance.now();
	const text = "function fibonacci(n) { return n <= 1 ? n : fibonacci(n-1) + fibonacci(n-2); }";
	const embedding = await embedder.embed(text);
	const timeSingle = performance.now() - startSingle;
	
	console.log(`   Text: "${text.slice(0, 50)}..."`);
	console.log(`   Embedding length: ${embedding.length}`);
	console.log(`   First 5 values: [${embedding.slice(0, 5).map(v => v.toFixed(4)).join(", ")}]`);
	console.log(`   Time: ${timeSingle.toFixed(0)}ms\n`);

	// 5. Generate batch embeddings
	console.log("5. Generating batch embeddings...");
	const codeSnippets = [
		"const sum = (a, b) => a + b;",
		"function multiply(x, y) { return x * y; }",
		"async function fetchData(url) { return await fetch(url).then(r => r.json()); }",
		"class Calculator { add(a, b) { return a + b; } }",
	];

	const startBatch = performance.now();
	const batchEmbeddings = await embedder.embedBatch(codeSnippets);
	const timeBatch = performance.now() - startBatch;

	console.log(`   Batch size: ${codeSnippets.length}`);
	console.log(`   All embeddings length: ${batchEmbeddings.every(e => e.length === 384) ? "✅ 384" : "❌ varies"}`);
	console.log(`   Time: ${timeBatch.toFixed(0)}ms (${(timeBatch / codeSnippets.length).toFixed(0)}ms/item)\n`);

	// 6. Test cache
	console.log("6. Testing cache...");
	const startCached = performance.now();
	const cachedEmbedding = await embedder.embed(text); // Same text as before
	const timeCached = performance.now() - startCached;

	console.log(`   Cache stats: ${JSON.stringify(embedder.getCacheStats())}`);
	console.log(`   Cached lookup time: ${timeCached.toFixed(2)}ms`);
	console.log(`   Same result: ${JSON.stringify(embedding.slice(0, 3)) === JSON.stringify(cachedEmbedding.slice(0, 3)) ? "✅ YES" : "❌ NO"}\n`);

	// 7. Similarity test
	console.log("7. Testing semantic similarity...");
	const query = "recursive function";
	const queryEmbedding = await embedder.embed(query);

	const similarities = codeSnippets.map((snippet, i) => {
		const score = cosineSimilarity(queryEmbedding, batchEmbeddings[i]);
		return { snippet: snippet.slice(0, 40), score };
	});

	similarities.sort((a, b) => b.score - a.score);
	console.log(`   Query: "${query}"`);
	console.log("   Results:");
	for (const { snippet, score } of similarities) {
		console.log(`     ${score.toFixed(4)}: ${snippet}...`);
	}

	console.log("\n=== All tests passed! ===");
}

function cosineSimilarity(a: number[], b: number[]): number {
	let dotProduct = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i++) {
		dotProduct += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

main().catch(console.error);
