# Credit Monitor Integration Notes

This module (credit-monitor.js) is the live implementation migrated from clawd/scripts.

## Integration points for SUP-289 (switch engine)
- Run node cli/provider-switch.js status to check current credit state
- The monitor emits threshold_hit events at 80/90/100% depletion
- Switch engine should listen for these events and trigger reconciliation

## State file
memory/provider-credit-state.json in the OpenClaw workspace dir
