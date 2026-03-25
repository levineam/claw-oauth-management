# Credit Monitor Integration Notes

This module (`credit-monitor.js`) is the live implementation migrated from `clawd/scripts`.

## Integration points for SUP-289 (switch engine)

The credit monitor exposes a **pull-based** interface — it does not emit events.
The switch engine should poll the monitor on a schedule or on-demand.

### Checking credit state

```bash
node src/monitor/credit-monitor.js              # human-readable status report
node src/monitor/credit-monitor.js --json        # full JSON output
node src/monitor/credit-monitor.js --check-alerts # check if thresholds exceeded
node src/monitor/credit-monitor.js --integration  # machine-readable switch signal
```

> **Note:** `cli/provider-switch.js status` shows provider *config* (providers,
> threshold, interval, enabled) — it does not report live credit state.
> Use the commands above to query actual credit/usage data.

### Switch signal contract

The `--integration` flag (and the exported `getSwitchSignal()` function) returns:

| Field                 | Type       | Description                                              |
|-----------------------|------------|----------------------------------------------------------|
| `provider`            | `string`   | Provider identifier (e.g. `"openai-codex"`)              |
| `tokenValid`          | `boolean`  | Whether the current auth token is valid and not expired   |
| `inCooldown`          | `boolean`  | Whether the provider is in a rate-limit cooldown period   |
| `cooldownRemainingMs` | `number`   | Milliseconds remaining in cooldown (`0` if not cooling)   |
| `limitReached`        | `boolean`  | Whether the usage limit has been fully reached            |
| `switchNeeded`        | `boolean`  | `true` if cooldown active, token expired, or limit hit    |
| `usageWindows`        | `array`    | Per-window usage details (percent used, reset times)      |
| `checkedAt`           | `number`   | Epoch milliseconds when the check was performed           |

The switch engine should treat `switchNeeded === true` as the trigger for
reconciliation. Use `provider` + `checkedAt` for deduplication/idempotency.

### Threshold alerts

The monitor tracks alert thresholds at **80%, 90%, and 100%** depletion.
Running `--check-alerts` evaluates current usage against these levels and
records which thresholds have been crossed in the state file (see below).
The switch engine can read the state file or call `--integration` to determine
the current depletion level from `usageWindows[].used_percent`.

## State file

**Path:** `~/clawd/agents/michael/memory/provider-credit-state.json`

This is an absolute path resolved via `os.homedir()` in `credit-monitor.js`
(`STATE_PATH` constant). It is **not** relative to the workspace root.

### Write semantics and security constraints

- **Atomic writes:** The monitor writes via `fs.writeFileSync` (sync full-file
  replace). For improved crash safety, a future iteration should use a
  temp-file-then-rename pattern.
- **File permissions:** Access should be restricted to the runtime user/process.
  Ensure the parent directory is not world-readable (`chmod 700` recommended).
- **No secrets:** This file stores only credit-monitor state (usage windows,
  alert history, cooldown timestamps). **Do not** persist OAuth access tokens,
  refresh tokens, or other long-lived credentials here — keep those in memory
  or in the dedicated auth-profiles store.
- **Parse failure handling:** On read failure, the monitor falls back to empty
  default state and recreates the file on the next write cycle.
