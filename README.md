# op1

OpenCode harness with batteries included. Minimal plugins, maximum capability via skills and commands.

## Quick Start

```bash
# Install op1 config into your project
bunx @op1/create

# Or install plugins directly
bun add @op1/notify @op1/workspace
```

## Packages

| Package | Description | npm |
|---------|-------------|-----|
| `@op1/create` | Interactive CLI installer | `bunx @op1/create` |
| `@op1/notify` | Desktop notifications, focus detection, quiet hours | `bun add @op1/notify` |
| `@op1/workspace` | Plan management, notepads, verification hooks | `bun add @op1/workspace` |

## What's Included

### Agents (9)
- `build` - Default build agent
- `coder` - Implementation specialist
- `explore` - Codebase explorer
- `frontend` - UI/UX specialist
- `oracle` - Architecture consultant
- `plan` - Planning agent
- `researcher` - External research
- `reviewer` - Code review
- `scribe` - Documentation

### Commands (6)
- `/plan` - Create implementation plans
- `/review` - Code review
- `/ulw` - ULTRAWORK mode
- `/find` - Find in codebase
- `/oracle` - Consult oracle
- `/research` - Research topics

### Skills (17)
- `ulw` - ULTRAWORK mode
- `code-philosophy` - 5 Laws of Elegant Defense
- `frontend-philosophy` - 5 Pillars of Intentional UI
- `playwright` - Browser automation
- `linear` - Linear integration
- `notion-research-documentation` - Notion research
- And more...

## Development

```bash
# Install dependencies
bun install

# Build all packages
bun run build

# Typecheck
bun run typecheck

# Lint
bun run lint

# Format
bun run format
```

## Monorepo Structure

```
op1/
├── packages/
│   ├── create/      # @op1/create - CLI installer
│   ├── notify/      # @op1/notify - Notifications plugin
│   └── workspace/   # @op1/workspace - Workspace plugin
├── .opencode/       # Config templates
│   ├── agent/       # Agent definitions
│   ├── command/     # Slash commands
│   └── skill/       # Loadable skills
├── package.json     # Bun workspaces root
├── tsconfig.json    # Shared TypeScript config
└── biome.json       # Biome linting/formatting
```

## Publishing

```bash
# Build first
bun run build

# Publish packages (from each package directory)
cd packages/notify && bun publish
cd packages/workspace && bun publish
cd packages/create && bun publish
```

## License

MIT
