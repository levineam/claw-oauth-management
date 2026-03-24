#!/usr/bin/env node
/**
 * claw-oauth-management CLI
 *
 * Extends the OpenClaw CLI with provider-switch management commands.
 *
 * Usage:
 *   claw-oauth-management status          Show current active provider and credit levels
 *   claw-oauth-management list            List all configured providers
 *   claw-oauth-management switch <name>   Manually switch to a specific provider
 *   claw-oauth-management history         Show recent switch history
 *   claw-oauth-management config          Show current extension config
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const [, , command, ...args] = process.argv;

const HELP = `
claw-oauth-management — Automatic OAuth provider switching and credit lifecycle management

Commands:
  status              Show active provider and cached credit levels
  list                List all configured providers
  switch <provider>   Manually trigger a switch to <provider>
  history             Show recent provider switch log
  config              Print current extension config
  help                Show this help

Options:
  --json              Output as JSON
`.trim();

async function main() {
  switch (command) {
    case 'status':
      await cmdStatus();
      break;
    case 'list':
      await cmdList();
      break;
    case 'switch':
      await cmdSwitch(args[0]);
      break;
    case 'history':
      await cmdHistory();
      break;
    case 'config':
      await cmdConfig();
      break;
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP);
      break;
    default:
      console.error(`Unknown command: ${command}\n`);
      console.log(HELP);
      process.exit(1);
  }
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function cmdStatus() {
  const config = loadConfig();
  if (!config) {
    console.log('No config found. Run inside an OpenClaw project or set PROVIDER_SWITCH_CONFIG.');
    return;
  }
  console.log(`Active providers: ${config.providers?.join(', ') || '(none configured)'}`);
  console.log(`Threshold: ${config.switchThresholdPercent ?? 10}%`);
  console.log(`Monitor interval: ${(config.monitorIntervalMs ?? 300_000) / 1000}s`);
  console.log(`Enabled: ${config.enabled ?? true}`);
}

async function cmdList() {
  const config = loadConfig();
  const providers = config?.providers ?? [];
  if (providers.length === 0) {
    console.log('No providers configured.');
    return;
  }
  providers.forEach((p, i) => console.log(`${i + 1}. ${p}`));
}

async function cmdSwitch(provider) {
  if (!provider) {
    console.error('Usage: claw-oauth-management switch <provider>');
    process.exit(1);
  }
  // CLI switches are advisory — actual switch requires the extension runtime
  console.log(`[stub] Manual switch to "${provider}" — requires extension runtime to apply.`);
  console.log('Start the extension and use the OpenClaw API to trigger a live switch.');
}

async function cmdHistory() {
  console.log('[stub] Switch history is available at runtime via the extension API.');
}

async function cmdConfig() {
  const config = loadConfig();
  console.log(JSON.stringify(config ?? {}, null, 2));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadConfig() {
  const envPath = process.env.PROVIDER_SWITCH_CONFIG;
  const candidates = [
    envPath,
    './provider-switch.config.json',
    '../openclaw.plugin.json',
  ].filter(Boolean);

  for (const p of candidates) {
    const abs = resolve(p);
    if (existsSync(abs)) {
      try {
        return JSON.parse(readFileSync(abs, 'utf8'));
      } catch {
        // ignore parse errors
      }
    }
  }
  return null;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
