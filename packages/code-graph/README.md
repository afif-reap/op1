# @op1/code-graph

Dependency graph plugin for OpenCode - import/export analysis, call hierarchies, and impact analysis.

## Features

- **Dependency Tracking** - Map imports and exports
- **Impact Analysis** - Assess change risk
- **Call Hierarchies** - Trace function relationships
- **Graph Visualization** - Understand code structure

## Installation

```bash
bun add @op1/code-graph
```

## Configuration

Add to your `opencode.json`:

```json
{
  "plugin": ["@op1/code-graph"]
}
```

## Tools Provided

| Tool | Description |
|------|-------------|
| `find_dependencies` | Find what a file imports/depends on |
| `find_dependents` | Find what files import/depend on a file |
| `impact_analysis` | Analyze risk of changing a file |
| `graph_status` | Get dependency graph statistics |
| `graph_rebuild` | Rebuild the dependency graph |

## Usage Examples

### Find Dependencies

```
find_dependencies(filePath="src/auth/login.ts")
```

Returns:
```
src/auth/login.ts depends on:
- src/utils/validation.ts
- src/api/client.ts
- src/types/user.ts
```

### Find Dependents

```
find_dependents(filePath="src/utils/validation.ts", transitive=true)
```

Returns:
```
Files that depend on src/utils/validation.ts:
- src/auth/login.ts
- src/auth/register.ts
- src/api/handlers/user.ts
- ... and 12 more
```

### Impact Analysis

```
impact_analysis(filePath="src/core/database.ts")
```

Returns:
```
## Impact Analysis: src/core/database.ts

**Risk Level:** HIGH
**Assessment:** Core module with 47 transitive dependents

### Direct Dependents
- src/api/handlers/user.ts
- src/api/handlers/auth.ts
- src/services/cache.ts

### Transitive Dependents
Total: 47 files
- src/routes/api.ts
- src/app.ts
- ... and 45 more
```

## Supported Languages

| Language | Import Parsing |
|----------|----------------|
| TypeScript | ✅ Full support |
| JavaScript | ✅ Full support |
| Python | ✅ Full support |
| Go | ✅ Full support |

## How It Works

1. **Parses imports** - Extracts import/export statements
2. **Builds graph** - Creates adjacency list in SQLite
3. **Traverses** - BFS for transitive dependencies
4. **Caches** - Incremental updates on file changes

## License

MIT
