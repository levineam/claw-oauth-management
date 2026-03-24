/**
 * MultiLayerReconciler - Ensures system consistency after a provider switch
 *
 * Layers:
 *   1. Config layer   — persist new active provider to OpenClaw config
 *   2. Session layer  — update any active sessions to use the new provider
 *   3. Audit layer    — write a reconciliation log entry
 */

export default class MultiLayerReconciler {
  /**
   * @param {object} config  - Extension config
   * @param {object} api     - OpenClaw plugin API handle
   */
  constructor(config, api) {
    this.config = config;
    this.api = api;
    this._reconcileLog = [];
  }

  /**
   * Run all reconciliation layers after a provider switch.
   *
   * @param {{ from: string, to: string }} switchEvent
   * @returns {Promise<void>}
   */
  async reconcile({ from, to }) {
    const ts = new Date().toISOString();
    console.log(`[multi-layer-reconciler] Reconciling switch: ${from} → ${to}`);

    const results = await Promise.allSettled([
      this._reconcileConfig(from, to),
      this._reconcileSessions(from, to),
      this._writeAuditLog({ from, to, ts }),
    ]);

    const failures = results.filter((r) => r.status === 'rejected');
    if (failures.length > 0) {
      console.warn(
        `[multi-layer-reconciler] ${failures.length} reconciliation layer(s) failed:`,
        failures.map((f) => f.reason?.message ?? f.reason)
      );
    } else {
      console.log(`[multi-layer-reconciler] All layers reconciled successfully`);
    }

    this._reconcileLog.push({ from, to, ts, success: failures.length === 0 });
  }

  // ── Layer 1: Config ─────────────────────────────────────────────────────────

  async _reconcileConfig(from, to) {
    // Integration point: persist new active provider in OpenClaw config
    if (this.api?.config?.set) {
      await this.api.config.set('providerSwitch.activeProvider', to);
    } else {
      console.log(`[reconcile:config] STUB: would set activeProvider="${to}" in config`);
    }
  }

  // ── Layer 2: Sessions ────────────────────────────────────────────────────────

  async _reconcileSessions(from, to) {
    // Integration point: notify active sessions of the provider change
    // e.g. this.api.sessions?.broadcast({ type: 'provider_changed', from, to })
    if (this.api?.sessions?.broadcast) {
      await this.api.sessions.broadcast({ type: 'provider_changed', from, to });
    } else {
      console.log(`[reconcile:sessions] STUB: would broadcast provider_changed event`);
    }
  }

  // ── Layer 3: Audit log ───────────────────────────────────────────────────────

  async _writeAuditLog({ from, to, ts }) {
    const entry = JSON.stringify({ event: 'provider_switch', from, to, ts });
    // Integration point: write to OpenClaw's structured event log
    if (this.api?.log?.audit) {
      await this.api.log.audit(entry);
    } else {
      console.log(`[reconcile:audit] ${entry}`);
    }
  }

  /** Return full reconciliation history */
  getLog() {
    return [...this._reconcileLog];
  }
}
