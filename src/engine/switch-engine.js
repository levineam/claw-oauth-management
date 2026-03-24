/**
 * SwitchEngine - Executes provider switches via OpenClaw config/session APIs
 *
 * Manages the ordered provider list, tracks the current active provider,
 * and calls OpenClaw's model-override API to apply the switch.
 */

export default class SwitchEngine {
  /**
   * @param {object} config  - Extension config (providers list)
   * @param {object} api     - OpenClaw plugin API handle
   */
  constructor(config, api) {
    this.config = config;
    this.api = api;
    this._currentIndex = 0;
    this._switchHistory = []; // [{ from, to, ts }]
  }

  /**
   * Switch to the next available provider (round-robin, skipping the current one).
   *
   * @param {string} fromProvider - The provider that triggered the switch
   * @returns {Promise<string|null>} The new active provider name, or null if none available
   */
  async switchNext(fromProvider) {
    const providers = this.config.providers;
    if (!providers || providers.length < 2) return null;

    // Find next provider that is not the current one
    const currentIdx = providers.indexOf(fromProvider);
    const nextIdx = (currentIdx + 1) % providers.length;

    // If we've looped back to the same provider, no switch possible
    if (nextIdx === currentIdx) return null;

    const nextProvider = providers[nextIdx];

    try {
      await this._applySwitch(nextProvider);
      this._currentIndex = nextIdx;
      this._switchHistory.push({ from: fromProvider, to: nextProvider, ts: new Date().toISOString() });
      return nextProvider;
    } catch (err) {
      console.error(`[switch-engine] Failed to apply switch to "${nextProvider}": ${err.message}`);
      return null;
    }
  }

  /**
   * Apply the provider switch via OpenClaw's API.
   * Integration point: call OpenClaw's model/provider override API when available.
   *
   * @param {string} provider - Provider profile name to activate
   */
  async _applySwitch(provider) {
    // Integration point: OpenClaw provider/model override API
    // e.g. this.api.setDefaultProvider(provider)
    //      this.api.config.set('defaultProvider', provider)
    if (this.api?.setDefaultProvider) {
      await this.api.setDefaultProvider(provider);
      return;
    }

    // Stub: log the intended switch until the real API is wired
    console.log(`[switch-engine] STUB: would switch active provider to "${provider}"`);
  }

  /** Return the full switch history */
  getHistory() {
    return [...this._switchHistory];
  }

  /** Return currently active provider name */
  current() {
    return this.config.providers[this._currentIndex] ?? null;
  }
}
