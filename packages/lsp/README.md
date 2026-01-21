# @op1/lsp

LSP integration plugin for OpenCode - language server protocol tools for code navigation and refactoring.

## Features

- **Go to Definition** - Jump to symbol definitions
- **Find References** - Find all usages across the codebase
- **Document Symbols** - Get file outline/structure
- **Workspace Symbols** - Search symbols across all files
- **Diagnostics** - Get errors/warnings before build
- **Rename** - Refactor symbol names safely
- **50+ Language Servers** - Built-in configurations

## Installation

```bash
bun add @op1/lsp
```

## Configuration

Add to your `opencode.json`:

```json
{
  "plugin": ["@op1/lsp"]
}
```

## Tools Provided

| Tool | Description |
|------|-------------|
| `lsp_goto_definition` | Jump to where a symbol is defined |
| `lsp_find_references` | Find all usages of a symbol |
| `lsp_symbols` | Get document outline or search workspace |
| `lsp_diagnostics` | Get errors/warnings from language server |
| `lsp_prepare_rename` | Check if rename is valid |
| `lsp_rename` | Rename a symbol across the codebase |

## Supported Languages

The plugin includes built-in configurations for 50+ language servers:

| Language | Server |
|----------|--------|
| TypeScript/JavaScript | typescript-language-server |
| Python | pylsp, pyright |
| Go | gopls |
| Rust | rust-analyzer |
| C/C++ | clangd |
| Java | jdtls |
| Ruby | solargraph |
| PHP | intelephense |
| And many more... |

## Custom Language Server

Add custom servers in `op1-lsp.json`:

```json
{
  "servers": {
    "my-lang": {
      "command": ["my-lang-server", "--stdio"],
      "fileExtensions": [".mylang"],
      "languageId": "mylang"
    }
  }
}
```

## How It Works

1. **Lazy Initialization** - Servers start on first use
2. **Connection Pooling** - Reuses server connections
3. **Auto-Discovery** - Finds project root automatically
4. **Graceful Cleanup** - Shuts down idle servers

## License

MIT
