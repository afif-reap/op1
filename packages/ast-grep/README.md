# @op1/ast-grep

AST-aware code search and replace tools for OpenCode, powered by [ast-grep](https://ast-grep.github.io/).

## Features

- **25 language support** - TypeScript, Python, Go, Rust, Java, C/C++, and more
- **Meta-variables** - Use `$VAR` (single node) and `$$$` (multiple nodes) for pattern matching
- **Auto-download** - Automatically downloads ast-grep binary if not installed
- **Safety limits** - Timeout (5 min), output limits (1MB), match limits (500)

## Installation

```bash
bun add @op1/ast-grep
```

## Usage

Add to your `opencode.json`:

```json
{
  "plugin": ["@op1/ast-grep"]
}
```

## Tools

### `ast_grep_search`

Search code patterns across filesystem using AST-aware matching.

```
pattern: "console.log($MSG)"
lang: "typescript"
paths: ["src/"]
globs: ["*.ts", "!*.test.ts"]
context: 2
```

### `ast_grep_replace`

Replace code patterns with AST-aware rewriting (dry-run by default).

```
pattern: "console.log($MSG)"
rewrite: "logger.info($MSG)"
lang: "typescript"
dryRun: false  // Set to false to apply changes
```

## Pattern Syntax

| Pattern | Matches |
|---------|---------|
| `$VAR` | Single AST node |
| `$$$` | Zero or more nodes |
| `console.log($MSG)` | Any console.log call |
| `function $NAME($$$) { $$$ }` | Any function declaration |
| `def $FUNC($$$):` | Python function (no trailing colon in pattern!) |

## Supported Languages

bash, c, cpp, csharp, css, elixir, go, haskell, html, java, javascript, json, kotlin, lua, nix, php, python, ruby, rust, scala, solidity, swift, typescript, tsx, yaml

## Binary Resolution

The package resolves the ast-grep binary in this order:

1. **Cached binary** (`~/.cache/op1-ast-grep/bin/sg`)
2. **@ast-grep/cli package** (if installed)
3. **Platform-specific package** (e.g., `@ast-grep/cli-darwin-arm64`)
4. **Homebrew** (macOS: `/opt/homebrew/bin/sg`)
5. **PATH** (fallback to `sg` in system PATH)
6. **Auto-download** (from GitHub releases)

## API

```typescript
import { 
  ast_grep_search, 
  ast_grep_replace,
  isCliAvailable,
  ensureCliAvailable,
  checkEnvironment 
} from "@op1/ast-grep";

// Check if CLI is available
if (isCliAvailable()) {
  console.log("ast-grep ready");
}

// Ensure CLI is available (downloads if needed)
await ensureCliAvailable();

// Get detailed environment status
const env = checkEnvironment();
console.log(env.cli.available, env.cli.path);
```

## License

MIT
