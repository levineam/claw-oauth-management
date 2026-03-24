/**
 * OpenClaw integration config for claw-provider-switch
 *
 * This file is loaded by the OpenClaw config system when the extension is installed.
 * It defines defaults and validation for the provider-switch extension settings.
 */

export const schema = {
  type: 'object',
  properties: {
    enabled: {
      type: 'boolean',
      default: true,
    },
    monitorIntervalMs: {
      type: 'number',
      default: 300_000,
      minimum: 10_000,
    },
    switchThresholdPercent: {
      type: 'number',
      default: 10,
      minimum: 1,
      maximum: 100,
    },
    providers: {
      type: 'array',
      items: { type: 'string' },
      default: [],
      description: 'Ordered list of OpenClaw auth profile names to cycle through',
    },
    reconcileOnSwitch: {
      type: 'boolean',
      default: true,
    },
  },
  required: [],
  additionalProperties: false,
};

export const defaults = {
  enabled: true,
  monitorIntervalMs: 300_000,
  switchThresholdPercent: 10,
  providers: [],
  reconcileOnSwitch: true,
};

/**
 * Validate a user-supplied config object against the schema.
 * @param {object} config
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validate(config) {
  const errors = [];

  if (config.providers !== undefined && !Array.isArray(config.providers)) {
    errors.push('providers must be an array of strings');
  }

  if (
    config.switchThresholdPercent !== undefined &&
    (config.switchThresholdPercent < 1 || config.switchThresholdPercent > 100)
  ) {
    errors.push('switchThresholdPercent must be between 1 and 100');
  }

  if (
    config.monitorIntervalMs !== undefined &&
    config.monitorIntervalMs < 10_000
  ) {
    errors.push('monitorIntervalMs must be at least 10000 (10 seconds)');
  }

  return { valid: errors.length === 0, errors };
}
