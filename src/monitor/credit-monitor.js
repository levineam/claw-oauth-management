/**
 * CreditMonitor - Polls provider credit balances and emits threshold events
 *
 * Uses OpenClaw's auth profile system (read-only) to fetch credit info per provider.
 * Emits 'threshold_hit' when a provider's remaining credits fall below the configured %.
 */

import { EventEmitter } from 'events';

export default class CreditMonitor extends EventEmitter {
  /**
   * @param {object} config  - Extension config (providers, monitorIntervalMs, switchThresholdPercent)
   * @param {object} api     - OpenClaw plugin API handle
   */
  constructor(config, api) {
    super();
    this.config = config;
    this.api = api;
    this._timer = null;
    this._running = false;
    this._creditCache = new Map(); // provider -> { remaining, checked_at }
  }

  /** Begin polling on the configured interval */
  start() {
    if (this._running) return;
    this._running = true;
    this._poll(); // immediate first check
    this._timer = setInterval(() => this._poll(), this.config.monitorIntervalMs);
  }

  /** Stop polling */
  stop() {
    this._running = false;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  /** Fetch credits for all configured providers */
  async _poll() {
    for (const provider of this.config.providers) {
      try {
        const remaining = await this._fetchRemainingPercent(provider);
        this._creditCache.set(provider, { remaining, checked_at: Date.now() });

        if (remaining <= this.config.switchThresholdPercent) {
          this.emit('threshold_hit', {
            provider,
            remaining,
            threshold: this.config.switchThresholdPercent,
          });
        }
      } catch (err) {
        console.warn(`[credit-monitor] Failed to fetch credits for "${provider}": ${err.message}`);
      }
    }
  }

  /**
   * Fetch remaining credit percentage for a provider profile.
   * Uses OpenClaw auth profiles API when available; falls back to a stub.
   *
   * @param {string} provider - Provider profile name (e.g. "openai", "anthropic")
   * @returns {Promise<number>} Remaining credit percentage (0–100)
   */
  async _fetchRemainingPercent(provider) {
    // Integration point: OpenClaw auth profile credit API
    // When the API is available via `this.api.credits?.forProvider(provider)`,
    // replace the stub below with the real call.
    if (this.api?.credits?.forProvider) {
      const info = await this.api.credits.forProvider(provider);
      if (info?.remainingPercent != null) {
        return info.remainingPercent;
      }
    }

    // Stub: assume full credits until real API is wired
    console.warn(
      `[credit-monitor] Credits API not available for "${provider}" — returning 100% (stub)`
    );
    return 100;
  }

  /** Return cached credit snapshot */
  getCached() {
    return Object.fromEntries(this._creditCache);
  }
}
