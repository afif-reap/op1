# @op1/notify

Desktop notifications plugin for OpenCode - focus detection, quiet hours, and sounds.

## Features

- **Desktop Notifications** - Native macOS/Linux/Windows notifications
- **Focus Detection** - Suppress notifications when app is focused
- **Quiet Hours** - Schedule notification-free periods
- **Sound Alerts** - Audio cues for important events
- **Smart Batching** - Group rapid notifications

## Installation

```bash
bun add @op1/notify
```

## Configuration

Add to your `opencode.json`:

```json
{
  "plugin": ["@op1/notify"]
}
```

### Options

Configure in your `opencode.json`:

```json
{
  "plugin": ["@op1/notify"],
  "notify": {
    "enabled": true,
    "sound": true,
    "quietHours": {
      "enabled": false,
      "start": "22:00",
      "end": "08:00"
    }
  }
}
```

## Notification Types

| Event | Description |
|-------|-------------|
| Task complete | Background agent finished |
| Build success/failure | Build command completed |
| Test results | Test suite finished |
| Error | Critical errors requiring attention |

## Platform Support

| Platform | Support |
|----------|---------|
| macOS | ✅ Native (osascript) |
| Linux | ✅ notify-send |
| Windows | ✅ PowerShell toast |

## License

MIT
