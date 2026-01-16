# op1

OpenCode harness with batteries included. Minimal plugins, maximum capability via skills and commands.

## Quick Start

```bash
# Install op1 config into your project
bunx @op1/install

# Or install plugins directly
bun add @op1/notify @op1/workspace
```

## Packages

| Package | Description | npm |
|---------|-------------|-----|
| `@op1/install` | Interactive CLI installer | `bunx @op1/install` |
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
