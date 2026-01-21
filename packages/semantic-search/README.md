# @op1/semantic-search

Semantic code search plugin for OpenCode - natural language to code search with embeddings.

## Features

- **Natural Language Search** - Find code using plain English queries
- **Code Similarity** - Find code patterns similar to a given snippet
- **Incremental Indexing** - Only re-index changed files using Merkle tree cache
- **Parallel Processing** - Index files with configurable concurrency (default: 10)
- **Batch Embeddings** - Process up to 100 chunks per API request
- **File Watching** - Automatic index updates with 500ms debounce
- **LRU Embedding Cache** - Avoid redundant API calls

## Installation

```bash
bun add @op1/semantic-search
```

## Configuration

Add to your `opencode.json`:

```json
{
  "plugin": ["@op1/semantic-search"]
}
```

### Environment Variables

```bash
OPENAI_API_KEY=sk-...        # Required for embeddings
OPENAI_BASE_URL=https://...  # Optional: custom API endpoint
```

## Tools Provided

### `search_semantic`

Search code using natural language.

```
search_semantic(query="function that validates email", limit=10)
```

### `find_similar`

Find code similar to a given snippet.

```
find_similar(code="try { await handler() } catch (e) { ... }", limit=5)
find_similar(filePath="src/auth.ts", line=42, limit=5)
```

### `semantic_status`

Get index status including file count, chunk count, and watcher state.

```
semantic_status()
```

### `semantic_reindex`

Rebuild or update the search index.

```
semantic_reindex()              # Incremental update
semantic_reindex(force=true)    # Full rebuild
```

## Performance

| Metric | Value |
|--------|-------|
| Embedding batch size | 100 chunks |
| File parallelism | 10 concurrent |
| Change detection | Merkle tree + content hash |
| Embedding cache | LRU (1000 entries) |
| File watcher debounce | 500ms |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    SemanticSearchIndex                       │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ MerkleCache │  │ FileWatcher │  │ OpenAIEmbedder     │  │
│  │ (change det)│  │ (debounced) │  │ (batch + LRU cache)│  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Chunker   │  │ VectorStore │  │     Benchmark       │  │
│  │ (semantic)  │  │ (SQLite-vec)│  │   (performance)     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Advanced Configuration

```typescript
import { SemanticSearchIndex } from "@op1/semantic-search";

const index = new SemanticSearchIndex(workspaceRoot, {
  config: {
    parallelism: 10,           // Concurrent file processing
    embeddingBatchSize: 100,   // Chunks per API request
    enableWatcher: true,       // Auto-update on file changes
    watcherDebounceMs: 500,    // Debounce delay
    cachePath: ".opencode/semantic-search-cache.json",
  },
  onProgress: (progress) => {
    console.log(`${progress.phase}: ${progress.current}/${progress.total}`);
  },
});

await index.initialize();
```

## License

MIT
