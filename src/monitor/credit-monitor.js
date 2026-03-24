#!/usr/bin/env node
/**
 * provider-credit-monitor.js
 * 
 * Phase 1: Credit Monitoring System - Provider Switching Foundation
 * 
 * Monitors OpenAI Codex OAuth token status and cooldown periods,
 * tracks usage patterns, predicts switch needs, and emits alerts
 * at 80%, 90%, and 100% credit depletion thresholds.
 * 
 * Usage:
 *   node scripts/provider-credit-monitor.js             # full status report
 *   node scripts/provider-credit-monitor.js --json      # JSON output
 *   node scripts/provider-credit-monitor.js --check-alerts  # emit alerts if thresholds exceeded
 *   node scripts/provider-credit-monitor.js --state     # show state file
 *
 * CLI alias (openclaw models credits --status):
 *   openclaw will route `openclaw models credits --status` → this script.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const HOME = os.homedir();
const AUTH_PROFILES_PATH = path.join(HOME, '.openclaw', 'agents', 'main', 'agent', 'auth-profiles.json');
const STATE_PATH = path.join(HOME, 'clawd', 'agents', 'michael', 'memory', 'provider-credit-state.json');
const OPENCLAW_CONFIG_PATH = path.join(HOME, '.openclaw', 'openclaw.json');

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------
const ALERT_THRESHOLDS = [80, 90, 100]; // percent usage
const USAGE_API_URL = 'https://chatgpt.com/backend-api/wham/usage';
const USER_AGENT = 'OpenClawCreditMonitor/1.0';
const DEFAULT_TIMEOUT_MS = 8000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    return null;
  }
}

function saveJson(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return 'now';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(seconds / 86400);
  const h = Math.round((seconds % 86400) / 3600);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

function formatTimestamp(epochMs) {
  if (!epochMs) return 'N/A';
  return new Date(epochMs).toLocaleString('en-US', { timeZone: 'America/New_York' });
}

function fetchUrl(url, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers,
      timeout: timeoutMs,
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.on('error', reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Auth profile loading
// ---------------------------------------------------------------------------

function loadCodexAuth() {
  const profiles = loadJson(AUTH_PROFILES_PATH);
  if (!profiles) {
    return { error: `Cannot read auth-profiles.json at ${AUTH_PROFILES_PATH}` };
  }

  const codexProfile = profiles.profiles?.['openai-codex:default'];
  if (!codexProfile) {
    return { error: 'No openai-codex:default profile found' };
  }

  const now = Date.now();
  const expires = codexProfile.expires;
  const isExpired = expires && expires < now;
  const usageStats = profiles.usageStats?.['openai-codex:default'] || {};

  return {
    accessToken: codexProfile.access,
    accountId: codexProfile.accountId,
    expires,
    isExpired,
    expiresIn: expires ? Math.round((expires - now) / 1000) : null,
    cooldownUntil: usageStats.cooldownUntil || null,
    inCooldown: usageStats.cooldownUntil ? usageStats.cooldownUntil > now : false,
    cooldownRemainingMs: usageStats.cooldownUntil ? Math.max(0, usageStats.cooldownUntil - now) : 0,
    errorCount: usageStats.errorCount || 0,
    failureCounts: usageStats.failureCounts || {},
    lastUsed: usageStats.lastUsed || null,
    lastFailureAt: usageStats.lastFailureAt || null,
  };
}

// ---------------------------------------------------------------------------
// Fetch usage from OpenAI
// ---------------------------------------------------------------------------

async function fetchCodexUsage(accessToken, accountId) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'User-Agent': USER_AGENT,
    Accept: 'application/json',
  };
  if (accountId) headers['ChatGPT-Account-Id'] = accountId;

  try {
    const result = await fetchUrl(USAGE_API_URL, headers, DEFAULT_TIMEOUT_MS);
    if (result.status === 401 || result.status === 403) {
      return { error: `Token expired or unauthorized (HTTP ${result.status})`, tokenExpired: true };
    }
    if (result.status !== 200) {
      return { error: `HTTP ${result.status}` };
    }
    return { data: JSON.parse(result.body) };
  } catch (e) {
    return { error: e.message };
  }
}

// ---------------------------------------------------------------------------
// Parse usage data
// ---------------------------------------------------------------------------

function parseUsageData(data) {
  const now = Date.now();
  const result = {
    allowed: data.rate_limit?.allowed !== false,
    limitReached: data.rate_limit?.limit_reached === true,
    planType: data.plan_type || 'unknown',
    email: data.email || null,
    windows: [],
    credits: null,
    switchNeeded: false,
    alerts: [],
    additionalLimits: [],
  };

  // Primary window (typically 5h for Codex)
  if (data.rate_limit?.primary_window) {
    const pw = data.rate_limit.primary_window;
    const windowHours = Math.round((pw.limit_window_seconds || 18000) / 3600);
    const usedPct = Math.min(100, pw.used_percent || 0);
    result.windows.push({
      label: `${windowHours}h`,
      usedPercent: usedPct,
      resetAt: pw.reset_at ? pw.reset_at * 1000 : null,
      resetAfterSeconds: pw.reset_after_seconds || null,
      limitWindowSeconds: pw.limit_window_seconds || null,
    });
    // Trigger alerts
    for (const threshold of ALERT_THRESHOLDS) {
      if (usedPct >= threshold) {
        result.alerts.push({ window: `${windowHours}h`, threshold, usedPercent: usedPct });
      }
    }
  }

  // Secondary window (typically week/day)
  if (data.rate_limit?.secondary_window) {
    const sw = data.rate_limit.secondary_window;
    const windowHours = Math.round((sw.limit_window_seconds || 604800) / 3600);
    const label = windowHours >= 168 ? 'Week' : windowHours >= 24 ? 'Day' : `${windowHours}h`;
    const usedPct = Math.min(100, sw.used_percent || 0);
    result.windows.push({
      label,
      usedPercent: usedPct,
      resetAt: sw.reset_at ? sw.reset_at * 1000 : null,
      resetAfterSeconds: sw.reset_after_seconds || null,
      limitWindowSeconds: sw.limit_window_seconds || null,
    });
    for (const threshold of ALERT_THRESHOLDS) {
      if (usedPct >= threshold) {
        result.alerts.push({ window: label, threshold, usedPercent: usedPct });
      }
    }
  }

  // Credits / balance
  if (data.credits) {
    const bal = parseFloat(data.credits.balance) || 0;
    result.credits = {
      hasCredits: data.credits.has_credits === true,
      unlimited: data.credits.unlimited === true,
      balance: bal,
      balanceStr: `$${bal.toFixed(2)}`,
    };
  }

  // Code review limits
  if (data.code_review_rate_limit) {
    const cr = data.code_review_rate_limit;
    result.codeReview = {
      allowed: cr.allowed !== false,
      limitReached: cr.limit_reached === true,
      usedPercent: cr.primary_window?.used_percent || 0,
    };
  }

  // Additional named limits (e.g. GPT-5.3-Codex-Spark)
  if (Array.isArray(data.additional_rate_limits)) {
    for (const item of data.additional_rate_limits) {
      const rl = item.rate_limit;
      if (!rl) continue;
      const pw = rl.primary_window;
      result.additionalLimits.push({
        name: item.limit_name || item.metered_feature,
        allowed: rl.allowed !== false,
        limitReached: rl.limit_reached === true,
        usedPercent: pw?.used_percent || 0,
        resetAfterSeconds: pw?.reset_after_seconds || null,
      });
    }
  }

  // Determine if switch needed
  result.switchNeeded = result.limitReached || !result.allowed || result.alerts.some(a => a.usedPercent >= 100);

  return result;
}

// ---------------------------------------------------------------------------
// State management
// ---------------------------------------------------------------------------

function loadState() {
  return loadJson(STATE_PATH) || {
    version: 1,
    lastChecked: null,
    lastUsageData: null,
    alertHistory: [],
    predictionHistory: [],
    switchRecommendations: [],
  };
}

function saveState(state) {
  state.lastChecked = Date.now();
  saveJson(STATE_PATH, state);
}

function updateStateWithUsage(state, usage) {
  state.lastUsageData = {
    timestamp: Date.now(),
    allowed: usage.allowed,
    limitReached: usage.limitReached,
    windows: usage.windows,
    credits: usage.credits,
    switchNeeded: usage.switchNeeded,
  };

  // Record new alerts
  for (const alert of usage.alerts) {
    const existing = state.alertHistory.find(
      a => a.window === alert.window && a.threshold === alert.threshold && a.resolvedAt == null
    );
    if (!existing) {
      state.alertHistory.push({
        ...alert,
        triggeredAt: Date.now(),
        resolvedAt: null,
      });
    }
  }

  // Resolve alerts that are no longer active
  for (const ha of state.alertHistory) {
    if (ha.resolvedAt != null) continue;
    const stillActive = usage.alerts.some(a => a.window === ha.window && a.threshold === ha.threshold);
    if (!stillActive) ha.resolvedAt = Date.now();
  }

  // Keep only last 100 alert records
  state.alertHistory = state.alertHistory.slice(-100);

  return state;
}

// ---------------------------------------------------------------------------
// Prediction
// ---------------------------------------------------------------------------

function predictDepletion(state, usage) {
  // Simple linear extrapolation using last 2 data points
  const history = state.predictionHistory || [];
  const now = Date.now();

  // Add current usage to prediction history
  for (const w of usage.windows) {
    history.push({ t: now, window: w.label, usedPercent: w.usedPercent });
  }
  // Keep last 20 per window
  state.predictionHistory = history.slice(-40);

  const predictions = {};
  for (const w of usage.windows) {
    const windowHistory = history.filter(h => h.window === w.label).slice(-5);
    if (windowHistory.length < 2) {
      predictions[w.label] = null;
      continue;
    }
    const oldest = windowHistory[0];
    const newest = windowHistory[windowHistory.length - 1];
    const dt = newest.t - oldest.t;
    if (dt < 60000) { predictions[w.label] = null; continue; } // too close
    const dPct = newest.usedPercent - oldest.usedPercent;
    if (dPct <= 0) { predictions[w.label] = null; continue; }
    const ratePerMs = dPct / dt;
    const remainingPct = 100 - newest.usedPercent;
    const msToDepletion = remainingPct / ratePerMs;
    predictions[w.label] = {
      estimatedDepletionMs: now + msToDepletion,
      ratePerHour: ratePerMs * 3600000,
    };
  }
  return predictions;
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

function printStatus(auth, usage, predictions, state) {
  const now = Date.now();
  console.log('\n═══════════════════════════════════════════');
  console.log('  OpenAI Codex Credit Monitor');
  console.log('═══════════════════════════════════════════\n');

  // Auth status
  console.log('AUTH STATUS');
  if (auth.error) {
    console.log(`  ❌ ${auth.error}`);
  } else {
    const tokenStatus = auth.isExpired
      ? '❌ Expired'
      : auth.expiresIn != null
      ? `✅ Valid (expires in ${formatDuration(auth.expiresIn)})`
      : '✅ Valid';
    console.log(`  Token:     ${tokenStatus}`);

    if (auth.inCooldown) {
      console.log(`  Cooldown:  ⏳ Active — resets in ${formatDuration(auth.cooldownRemainingMs / 1000)}`);
    } else {
      console.log(`  Cooldown:  ✅ None`);
    }
    console.log(`  Errors:    ${auth.errorCount} (rate_limit: ${auth.failureCounts?.rate_limit || 0})`);
    if (auth.lastUsed) console.log(`  Last Used: ${formatTimestamp(auth.lastUsed)}`);
  }

  // Usage windows
  if (usage && !usage.error) {
    console.log('\nUSAGE WINDOWS');
    for (const w of usage.windows) {
      const bar = buildBar(w.usedPercent);
      const resetStr = w.resetAfterSeconds ? `resets in ${formatDuration(w.resetAfterSeconds)}` : '';
      const alert = w.usedPercent >= 100 ? ' 🚨 LIMIT REACHED' : w.usedPercent >= 90 ? ' ⚠️  90%+' : w.usedPercent >= 80 ? ' ⚠️  80%+' : '';
      console.log(`  ${w.label.padEnd(6)} ${bar} ${String(Math.round(w.usedPercent)).padStart(3)}%${alert}`);
      if (resetStr) console.log(`         ${resetStr}`);

      // Prediction
      const pred = predictions?.[w.label];
      if (pred?.estimatedDepletionMs) {
        const etaMs = pred.estimatedDepletionMs - now;
        if (etaMs > 0 && etaMs < 7 * 24 * 3600 * 1000) {
          console.log(`         📈 Projected depletion: ${formatDuration(etaMs / 1000)} (${formatTimestamp(pred.estimatedDepletionMs)})`);
        }
      }
    }

    // Credits
    if (usage.credits) {
      console.log('\nCREDITS');
      if (usage.credits.unlimited) {
        console.log('  ✅ Unlimited credits');
      } else if (usage.credits.hasCredits) {
        console.log(`  💰 Balance: ${usage.credits.balanceStr}`);
      } else {
        console.log(`  ⚠️  No credits (balance: ${usage.credits.balanceStr})`);
      }
    }

    // Switch recommendation
    console.log('\nSWITCH ENGINE');
    if (usage.switchNeeded) {
      console.log('  🚨 SWITCH RECOMMENDED — limit reached or depleted');
    } else if (usage.alerts.length > 0) {
      console.log('  ⚠️  Approaching limits — monitor closely');
    } else {
      console.log('  ✅ No switch needed');
    }

    // Code review sub-limit
    if (usage.codeReview) {
      console.log('\nCODE REVIEW LIMIT');
      const crStatus = usage.codeReview.limitReached ? '🚨 REACHED' : `✅ ${usage.codeReview.usedPercent}% used`;
      console.log(`  ${crStatus}`);
    }

    // Additional named limits
    if (usage.additionalLimits.length > 0) {
      console.log('\nADDITIONAL LIMITS');
      for (const al of usage.additionalLimits) {
        const status = al.limitReached ? '🚨 REACHED' : `✅ ${al.usedPercent}% used`;
        console.log(`  ${al.name}: ${status}`);
      }
    }
  } else if (usage?.error) {
    console.log('\nUSAGE FETCH ERROR');
    console.log(`  ❌ ${usage.error}`);
    if (usage.tokenExpired) console.log('  → Token refresh required');
  }

  // Active alerts
  if (state?.alertHistory) {
    const active = state.alertHistory.filter(a => a.resolvedAt == null);
    if (active.length > 0) {
      console.log('\nACTIVE ALERTS');
      for (const a of active) {
        console.log(`  🔔 ${a.window} window at ${a.usedPercent}% (threshold: ${a.threshold}%) since ${formatTimestamp(a.triggeredAt)}`);
      }
    }
  }

  console.log(`\nChecked: ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}`);
  console.log('═══════════════════════════════════════════\n');
}

function buildBar(pct) {
  const filled = Math.round((pct / 100) * 20);
  const empty = 20 - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
}

// ---------------------------------------------------------------------------
// Integration points (for switch engine)
// ---------------------------------------------------------------------------

/**
 * Returns a structured summary for consumption by the switch engine.
 * Switch engine should call this and check switchNeeded.
 */
function getSwitchSignal(auth, usage) {
  return {
    provider: 'openai-codex',
    tokenValid: !auth.isExpired && !auth.error,
    inCooldown: auth.inCooldown,
    cooldownRemainingMs: auth.cooldownRemainingMs,
    limitReached: usage?.limitReached || false,
    switchNeeded: !!(auth.inCooldown || auth.isExpired || usage?.switchNeeded),
    usageWindows: usage?.windows || [],
    checkedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Simulated depletion scenarios (for testing)
// ---------------------------------------------------------------------------

function simulateDepletion(scenario) {
  const scenarios = {
    '80pct': {
      rate_limit: {
        allowed: true,
        limit_reached: false,
        primary_window: { used_percent: 80, limit_window_seconds: 18000, reset_after_seconds: 9000, reset_at: Math.round((Date.now() + 9000000) / 1000) },
        secondary_window: { used_percent: 60, limit_window_seconds: 604800, reset_after_seconds: 300000, reset_at: Math.round((Date.now() + 300000000) / 1000) },
      },
      credits: { has_credits: false, unlimited: false, balance: '0' },
    },
    '90pct': {
      rate_limit: {
        allowed: true,
        limit_reached: false,
        primary_window: { used_percent: 90, limit_window_seconds: 18000, reset_after_seconds: 4500, reset_at: Math.round((Date.now() + 4500000) / 1000) },
        secondary_window: { used_percent: 85, limit_window_seconds: 604800, reset_after_seconds: 250000, reset_at: Math.round((Date.now() + 250000000) / 1000) },
      },
      credits: { has_credits: false, unlimited: false, balance: '0' },
    },
    '100pct': {
      rate_limit: {
        allowed: false,
        limit_reached: true,
        primary_window: { used_percent: 100, limit_window_seconds: 18000, reset_after_seconds: 18000, reset_at: Math.round((Date.now() + 18000000) / 1000) },
        secondary_window: { used_percent: 100, limit_window_seconds: 604800, reset_after_seconds: 78099, reset_at: Math.round((Date.now() + 78099000) / 1000) },
      },
      credits: { has_credits: false, unlimited: false, balance: '0' },
    },
  };
  return scenarios[scenario] || null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const checkAlerts = args.includes('--check-alerts');
  const showState = args.includes('--state');
  const simulate = args.find(a => a.startsWith('--simulate='))?.split('=')[1];
  const integrationMode = args.includes('--integration'); // for switch engine

  // Load state
  const state = loadState();

  // Load auth
  const auth = loadCodexAuth();
  
  // Fetch or simulate usage
  let usageResult = null;
  if (simulate) {
    const simData = simulateDepletion(simulate);
    if (!simData) {
      console.error(`Unknown simulation: ${simulate}. Use: 80pct, 90pct, 100pct`);
      process.exit(1);
    }
    if (!jsonMode && !integrationMode) console.log(`[SIMULATION: ${simulate}]`);
    usageResult = { data: simData };
  } else if (auth.accessToken && !auth.isExpired) {
    usageResult = await fetchCodexUsage(auth.accessToken, auth.accountId);
  } else if (auth.isExpired) {
    usageResult = { error: 'Token expired — refresh required', tokenExpired: true };
  } else if (auth.error) {
    usageResult = { error: auth.error };
  }

  // Parse usage
  let usage = null;
  if (usageResult?.data) {
    usage = parseUsageData(usageResult.data);
  } else if (usageResult?.error) {
    usage = { error: usageResult.error, tokenExpired: usageResult.tokenExpired };
  }

  // Compute predictions
  let predictions = {};
  if (usage && !usage.error) {
    updateStateWithUsage(state, usage);
    predictions = predictDepletion(state, usage);
    saveState(state);
  } else {
    saveState(state);
  }

  // Output
  if (showState) {
    console.log(JSON.stringify(loadState(), null, 2));
    return;
  }

  if (integrationMode) {
    // Minimal JSON for switch engine consumption
    const signal = getSwitchSignal(auth, usage);
    process.stdout.write(JSON.stringify(signal) + '\n');
    return;
  }

  if (jsonMode) {
    const output = {
      checkedAt: Date.now(),
      auth: {
        tokenValid: !auth.isExpired && !auth.error,
        isExpired: auth.isExpired,
        inCooldown: auth.inCooldown,
        cooldownRemainingMs: auth.cooldownRemainingMs,
        expiresIn: auth.expiresIn,
        error: auth.error || null,
      },
      usage: usage ? {
        allowed: usage.allowed,
        limitReached: usage.limitReached,
        switchNeeded: usage.switchNeeded,
        windows: usage.windows,
        credits: usage.credits,
        alerts: usage.alerts,
        error: usage.error || null,
      } : null,
      predictions,
      switchSignal: getSwitchSignal(auth, usage),
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  if (checkAlerts) {
    const active = state.alertHistory?.filter(a => a.resolvedAt == null) || [];
    if (active.length === 0 && !usage?.switchNeeded) {
      console.log('OK — no active alerts');
      process.exit(0);
    }
    if (usage?.switchNeeded) {
      console.log('SWITCH_NEEDED');
      for (const w of (usage.windows || [])) {
        if (w.usedPercent >= 100) console.log(`  DEPLETED: ${w.label} window at 100%`);
      }
    }
    for (const a of active) {
      console.log(`ALERT: ${a.window} window at ${a.usedPercent}% (threshold: ${a.threshold}%)`);
    }
    process.exit(active.length > 0 || usage?.switchNeeded ? 1 : 0);
  }

  // Default: human-readable status
  printStatus(auth, usage, predictions, state);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
