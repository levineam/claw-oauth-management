/**
 * claw-oauth-management - OpenClaw extension for automatic OAuth provider switching
 *
 * Standalone extension that integrates with OpenClaw through well-defined APIs
 * to monitor AI provider credits and automatically switch when thresholds are hit.
 *
 * Follows the established OpenClaw extension pattern (see: outbound-hygiene).
 */

import CreditMonitor from './monitor/credit-monitor.js';
import SwitchEngine from './engine/switch-engine.js';
import MultiLayerReconciler from './reconcile/multi-layer.js';

const PREFIX = '[claw-oauth-management]';

const DEFAULT_CONFIG = {
  enabled: true,
  monitorIntervalMs: 300_000, // 5 minutes
  switchThresholdPercent: 10,
  providers: [],
  reconcileOnSwitch: true,
};

export default function providerSwitch(api) {
  const config = { ...DEFAULT_CONFIG, ...(api.config ?? {}) };

  if (!config.enabled) {
    console.log(`${PREFIX} Disabled via config — skipping init`);
    return;
  }

  if (!config.providers || config.providers.length === 0) {
    console.warn(`${PREFIX} No providers configured — extension loaded but inactive`);
    return;
  }

  const monitor = new CreditMonitor(config, api);
  const engine = new SwitchEngine(config, api);
  const reconciler = new MultiLayerReconciler(config, api);

  // Wire the switch pipeline: monitor triggers engine; engine triggers reconciler
  monitor.on('threshold_hit', async ({ provider, remaining, threshold }) => {
    console.log(
      `${PREFIX} Credit threshold hit on "${provider}": ${remaining}% remaining (threshold: ${threshold}%)`
    );

    const switched = await engine.switchNext(provider);
    if (!switched) {
      console.warn(`${PREFIX} No available provider to switch to — staying on "${provider}"`);
      return;
    }

    console.log(`${PREFIX} Switched to provider: "${switched}"`);

    if (config.reconcileOnSwitch) {
      await reconciler.reconcile({ from: provider, to: switched });
    }
  });

  // Start monitoring
  monitor.start();

  console.log(`${PREFIX} Extension loaded — monitoring ${config.providers.length} provider(s)`);

  // Expose stop hook for clean shutdown
  if (typeof api.onStop === 'function') {
    api.onStop(() => {
      monitor.stop();
      console.log(`${PREFIX} Extension stopped`);
    });
  }
}
