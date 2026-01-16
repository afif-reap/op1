# AGENTS.md - op1

**Last Updated:** 2026-01-16
**Purpose:** AI coding assistant guidelines for op1 monorepo

## Overview

op1 is an OpenCode harness with batteries included - minimal plugins, maximum capability via skills and commands.

| Package | Description | Entry |
|---------|-------------|-------|
| `@op1/create` | Interactive CLI installer | `bunx @op1/create` |
| `@op1/notify` | Desktop notifications, focus detection | `bun add @op1/notify` |
| `@op1/workspace` | Plan management, notepads, hooks | `bun add @op1/workspace` |

## Hard Rules

### Bun Only (CRITICAL)

This is a **Bun-exclusive project**. Use Bun-native APIs exclusively.

#### Import Mappings

| DO NOT USE | USE INSTEAD |
|------------|-------------|
| `import * as fs from "node:fs/promises"` | `import { mkdir, readdir, stat } from "fs/promises"` + `Bun.file()` |
| `import * as path from "node:path"` | `import { join, basename, relative } from "path"` |
| `import * as os from "node:os"` | `import { homedir } from "os"` |
| `import { execFile } from "node:child_process"` | `Bun.spawn()` |
| `import { promisify } from "node:util"` | Not needed with Bun.spawn |
| `import crypto from "node:crypto"` | `new Bun.CryptoHasher()` |

#### Type Mappings

| DO NOT USE | USE INSTEAD |
|------------|-------------|
| `NodeJS.ErrnoException` | `Error & { code?: string }` |
| `NodeJS.Timeout` | `ReturnType<typeof setTimeout>` |
| `NodeJS.Process` | `typeof process` |

#### File Operations

```typescript
// ❌ DON'T: Node.js style
import * as fs from "node:fs/promises";
const content = await fs.readFile(path, "utf8");
await fs.writeFile(path, content);
await fs.copyFile(src, dest);

// ✅ DO: Bun-native style
const file = Bun.file(path);
const content = await file.text();
await Bun.write(path, content);
await Bun.write(dest, Bun.file(src));  // Copy file
```

#### Command Execution

```typescript
// ❌ DON'T: Node.js style
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
const { stdout } = await execFileAsync("git", ["status"], { cwd: dir });

// ✅ DO: Bun-native style
const proc = Bun.spawn(["git", "status"], { cwd: dir, stdout: "pipe" });
const stdout = await new Response(proc.stdout).text();
await proc.exited;
```

#### Hashing

```typescript
// ❌ DON'T: Node.js style
import crypto from "node:crypto";
const hash = crypto.createHash("sha256").update(data).digest("hex");

// ✅ DO: Bun-native style
const hasher = new Bun.CryptoHasher("sha256");
hasher.update(data);
const hash = hasher.digest("hex");
```

### Type Safety

- Strict TypeScript everywhere
- No `as any` or `@ts-ignore`
- Prefer `unknown` over `any` for catch blocks

### Error Handling Pattern

```typescript
// Bun-compatible error type guard
function isSystemError(error: unknown): error is Error & { code: string } {
  return error instanceof Error && "code" in error;
}

// Usage with Bun.file()
const file = Bun.file(path);
if (!(await file.exists())) {
  return null; // File not found - no try/catch needed!
}
const content = await file.text();
```

## Quick Reference

```bash
# Install dependencies
bun install

# Build all packages
bun run build

# Typecheck all packages
bun run typecheck

# Lint
bun run lint

# Format
bun run format

# Build single package
bun run build --filter @op1/create
```

## Structure

```
op1/
├── packages/
│   ├── create/         # @op1/create - CLI installer
│   │   └── src/index.ts
│   ├── notify/         # @op1/notify - Notifications
│   │   └── src/index.ts
│   └── workspace/      # @op1/workspace - Workspace tools
│       └── src/index.ts
├── .opencode/          # Config templates (copied by installer)
│   ├── agent/          # 9 agent definitions
│   ├── command/        # 6 slash commands
│   └── skill/          # 17 loadable skills
├── package.json        # Bun workspaces root
├── tsconfig.json       # Shared TypeScript config
└── biome.json          # Biome linting/formatting
```

## Package-Specific Notes

### @op1/create

Interactive installer that:
1. Installs to `~/.config/opencode/` (global config)
2. Backs up existing config before changes
3. Interactive MCP selection by category
4. Merges config preserving user settings

### @op1/notify

Desktop notifications plugin with:
- Focus detection (pause notifications when OpenCode focused)
- Quiet hours support
- Sound notifications
- macOS native integration

### @op1/workspace

Workspace management plugin with:
- Plan management (create, read, update)
- Notepads for learnings/issues/decisions
- Verification hooks
- Session state persistence

## Templates (.opencode/)

Templates are copied to user's `~/.config/opencode/` by the installer.

**Keep in sync:** When modifying templates in `.opencode/`, also update `packages/create/templates/`.

## Dependencies

| Dependency | Purpose | Package |
|------------|---------|---------|
| `@clack/prompts` | CLI prompts | create |
| `picocolors` | Terminal colors | create |
| `@opencode-ai/sdk` | OpenCode SDK | notify, workspace |
| `@opencode-ai/plugin` | Plugin interface | notify, workspace |

## Debugging

### Build Issues

```bash
# Clean and rebuild
rm -rf packages/*/dist
bun run build
```

### Type Errors

```bash
# Check specific package
bun run typecheck --filter @op1/workspace
```

### Runtime Issues

```bash
# Run with debug output
DEBUG=* bun run packages/create/bin/cli.ts
```
