# op1

OpenCode harness with batteries included. Minimal plugins, maximum capability via skills and commands.

## Installation

```bash
bunx @op1/install
```

The interactive installer will:
- Back up your existing config (if any)
- Install 9 agents, 6 commands, and 19 skills
- Configure MCP servers (Z.AI, Linear, Notion, New Relic, Figma, Context7, Grep.app)
- Set up plugins for notifications and workspace management
- Let you configure per-agent models or a global model

### Manual Installation

If you prefer manual setup:

```bash
# Install plugins in your project
bun add @op1/notify @op1/workspace
```

Then add to your `opencode.json`:

```json
{
  "plugin": ["@op1/notify", "@op1/workspace"]
}
```

## Packages

| Package | Description | Install |
|---------|-------------|---------|
| [`@op1/install`](https://www.npmjs.com/package/@op1/install) | Interactive CLI installer | `bunx @op1/install` |
| [`@op1/notify`](https://www.npmjs.com/package/@op1/notify) | Desktop notifications, focus detection, quiet hours | `bun add @op1/notify` |
| [`@op1/workspace`](https://www.npmjs.com/package/@op1/workspace) | Plan management, notepads, verification hooks | `bun add @op1/workspace` |

## What's Included

### Agents (9)

| Agent | Description |
|-------|-------------|
| `build` | Default build agent - writes code, runs tests, ships features |
| `coder` | Implementation specialist - atomic coding tasks |
| `explore` | Codebase explorer - find files, patterns, implementations |
| `frontend` | UI/UX specialist - visual excellence |
| `oracle` | Architecture consultant - debugging, strategic decisions |
| `plan` | Planning agent - creates detailed work breakdowns |
| `researcher` | External research - docs, GitHub, web search |
| `reviewer` | Code review - security, performance, philosophy compliance |
| `scribe` | Documentation specialist - human-facing content |

### Commands (6)

| Command | Description |
|---------|-------------|
| `/plan` | Create implementation plans |
| `/review` | Code review |
| `/ulw` | ULTRAWORK mode - maximum capability |
| `/find` | Find in codebase |
| `/oracle` | Consult oracle for architecture decisions |
| `/research` | Research topics |

### Skills (19)

Including: `ulw`, `code-philosophy`, `frontend-philosophy`, `playwright`, `linear`, `notion-research-documentation`, `newrelic`, `figma-design`, `git-master`, `tmux`, `code-review`, `analyze-mode`, `search-mode`, and more.

## Configuration

After installation, your `~/.config/opencode/opencode.json` will include:

```json
{
  "plugin": ["@op1/notify", "@op1/workspace"],
  "model": "your-configured-model",
  "mcp": {
    "context7": { "type": "remote", "url": "https://mcp.context7.com/mcp" },
    "grep_app": { "type": "remote", "url": "https://mcp.grep.app" }
  },
  "agent": {
    "build": {},
    "coder": {},
    "explore": {},
    "frontend": {},
    "oracle": {},
    "plan": {},
    "researcher": {},
    "reviewer": {},
    "scribe": {}
  }
}
```

### Per-Agent Models

Configure different models for different agents:

```json
{
  "agent": {
    "build": { "model": "anthropic/claude-sonnet-4-20250514" },
    "explore": { "model": "anthropic/claude-haiku-3-5-20241022" },
    "oracle": { "model": "openai/gpt-4o" }
  }
}
```

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
```

## Acknowledgments

op1 was inspired by and builds upon ideas from these excellent projects:

- **[oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode)** by [@code-yeongyu](https://github.com/code-yeongyu) - "oh-my-zsh" for OpenCode with multi-model orchestration, LSP tools, and lifecycle hooks
- **[opencode-workspace](https://github.com/kdcokenny/opencode-workspace)** by [@kdcokenny](https://github.com/kdcokenny) - Bundled multi-agent orchestration harness with strict orchestrator/implementer hierarchy

Thank you for the inspiration and contributions to the OpenCode ecosystem!

## License

MIT
