# @op1/workspace

Project-scoped plan management plugin for OpenCode - plans, notepads, and verification hooks.

## Features

- **Plan Management** - Create, save, and track implementation plans
- **Notepads** - Persist learnings, issues, and decisions across sessions
- **Verification Hooks** - Automatic reminders for build/test after edits
- **Cross-Session Continuity** - Resume work exactly where you left off

## Installation

```bash
bun add @op1/workspace
```

## Configuration

Add to your `opencode.json`:

```json
{
  "plugin": ["@op1/workspace"]
}
```

## Tools Provided

### Plan Management

| Tool | Description |
|------|-------------|
| `plan_save` | Save implementation plan as markdown |
| `plan_read` | Read the active plan |
| `plan_list` | List all plans in the project |

### Notepads

| Tool | Description |
|------|-------------|
| `notepad_read` | Read accumulated wisdom (learnings, issues, decisions) |
| `notepad_write` | Append to notepad files |
| `notepad_list` | List notepad files for active plan |

## Data Storage

Plans and notepads are stored in your project:

```
<project-root>/
└── .opencode/
    └── workspace/
        ├── plans/
        │   └── 1234567890-brave-panda.md
        ├── notepads/
        │   └── 1234567890-brave-panda/
        │       ├── learnings.md
        │       ├── issues.md
        │       └── decisions.md
        └── active-plan.json
```

## Plan Format

Plans use markdown with YAML frontmatter:

```markdown
---
status: in-progress
phase: 2
updated: 2026-01-21
---

# Implementation Plan

## Goal
One sentence describing the outcome.

## Phase 1: Setup [COMPLETE]
- [x] 1.1 Task one
- [x] 1.2 Task two

## Phase 2: Implementation [IN PROGRESS]
- [ ] 2.1 Current task ← CURRENT
- [ ] 2.2 Next task
```

## Safety Hooks

The plugin includes automatic safety hooks:

- **Output Truncation** - Large tool outputs are truncated to prevent context overflow
- **Edit Error Recovery** - Reminders to read file after edit failures
- **Empty Task Detection** - Warnings for failed agent delegations
- **Verification Reminders** - Prompts to run build/test after code changes

## License

MIT
