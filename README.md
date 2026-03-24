# claw-provider-switch

Standalone OpenClaw extension for automated AI provider credit monitoring and switching.

## Overview

Monitors credit balances across configured AI provider profiles and automatically switches to the next provider when the active one falls below a configurable threshold. Follows the established OpenClaw extension pattern.

## Architecture

```
claw-provider-switch/
├── src/
│   ├── extension.js              # Main plugin entry point (OpenClaw hook)
│   ├── monitor/
│   │   └── credit-monitor.js     # Polls provider credit APIs, emits threshold events
│   ├── engine/
│   │   └── switch-engine.js      # Executes provider switches (round-robin)
│   └── reconcile/
│       └── multi-layer.js        # Post-switch consistency: config + sessions + audit
├── cli/
│   └── provider-switch.js        # CLI commands (status, list, switch, history)
├── openclaw/
│   └── extensions/
│       └── provider-switch/
│           └── config.js         # Config schema and validation
├── openclaw.plugin.json
└── package.json
```

## Installation

```bash
# From the extension directory:
openclaw extension install ./claw-provider-switch

# Or via npm (future):
npm install claw-provider-switch
openclaw extension install claw-provider-switch
```

## Configuration

In your `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "extensions": {
      "provider-switch": {
        "enabled": true,
        "providers": ["openai", "anthropic", "openrouter"],
        "switchThresholdPercent": 10,
        "monitorIntervalMs": 300000,
        "reconcileOnSwitch": true
      }
    }
  }
}
```

## CLI

```bash
claw-provider-switch status       # Active provider + credit levels
claw-provider-switch list         # All configured providers
claw-provider-switch switch <p>   # Manual switch (runtime required)
claw-provider-switch history      # Recent switch log
claw-provider-switch config       # Current config
```

## Extension API Integration Points

The following OpenClaw APIs are used when available (stubs log warnings when absent):

| API | Purpose |
|-----|---------|
| `api.credits.forProvider(name)` | Fetch remaining credit % |
| `api.setDefaultProvider(name)` | Apply the active provider switch |
| `api.config.set(key, value)` | Persist config changes |
| `api.sessions.broadcast(event)` | Notify active sessions |
| `api.log.audit(entry)` | Write structured audit log |

## Related Issues

- **SUP-293** — Architecture & Setup (this scaffold) ✅
- **SUP-289** — Phase 2: Automatic Switch Engine
- **SUP-290** — Phase 3: Multi-Layer Reconciliation
- **SUP-291** — Phase 4: Integration & Testing
- **SUP-292** — Master Implementation Plan
