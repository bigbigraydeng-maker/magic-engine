import { readFileSync } from 'node:fs';
import { argv } from 'node:process';

const STALE_DRAFT_HOURS = 24;
const STUCK_IN_PROGRESS_HOURS = 6;
const BRAKE_OPEN_PR_HOURS = 48;
const BRAKE_FAILURE_COUNT = 3;
const BRAKE_WEEKLY_COST_USD = 5;
const BRAKE_LOOKBACK_DAYS = 7;

/**
 * Check if a PR needs branch update or should be closed.
 * @param {{number: number, draft: boolean, createdAt: string, riskGateStale: boolean}} pr
 * @param {string} now - ISO timestamp
 * @returns {{action: 'update-branch'|'close'|'none', reason?: string}}
 */
export function maintainPR(pr, now) {
  const nowMs = new Date(now).getTime();
  const createdMs = new Date(pr.createdAt).getTime();
  const ageHours = (nowMs - createdMs) / (1000 * 60 * 60);

  if (pr.draft && ageHours > STALE_DRAFT_HOURS) {
    return { action: 'close', reason: `draft PR #${pr.number} open ${Math.floor(ageHours)}h > ${STALE_DRAFT_HOURS}h` };
  }

  if (pr.riskGateStale) {
    return { action: 'update-branch', reason: `PR #${pr.number} risk gate stale` };
  }

  return { action: 'none' };
}

/**
 * Check if an in-progress issue should be unlocked (crashed previous run).
 * @param {{number: number, labeledAt: string}} issue - issue with auto-dev:in-progress
 * @param {string} now - ISO timestamp
 * @returns {{unlock: boolean, reason?: string}}
 */
export function maintainInProgress(issue, now) {
  const nowMs = new Date(now).getTime();
  const labeledMs = new Date(issue.labeledAt).getTime();
  const ageHours = (nowMs - labeledMs) / (1000 * 60 * 60);

  if (ageHours > STUCK_IN_PROGRESS_HOURS) {
    return { unlock: true, reason: `issue #${issue.number} in-progress ${Math.floor(ageHours)}h > ${STUCK_IN_PROGRESS_HOURS}h` };
  }

  return { unlock: false };
}

/**
 * Check the four brake conditions. Any hit = don't pick this round.
 * @param {{
 *   revertedLanePRs: number,
 *   openLanePRsAfterMaintenance: Array<{number: number, createdAt: string}>,
 *   recentFailureCount: number,
 *   weeklyDeepSeekCostUsd: number,
 * }} input
 * @param {string} now - ISO timestamp
 * @returns {{brake: boolean, reason?: string}}
 */
export function checkBrakes(input, now) {
  if (typeof input.revertedLanePRs === 'number' && input.revertedLanePRs > 0) {
    return { brake: true, reason: `${input.revertedLanePRs} lane PR(s) reverted in last ${BRAKE_LOOKBACK_DAYS} days` };
  }

  const nowMs = new Date(now).getTime();
  for (const pr of input.openLanePRsAfterMaintenance || []) {
    const createdMs = new Date(pr.createdAt).getTime();
    const ageHours = (nowMs - createdMs) / (1000 * 60 * 60);
    if (ageHours > BRAKE_OPEN_PR_HOURS) {
      return { brake: true, reason: `PR #${pr.number} still open after ${Math.floor(ageHours)}h > ${BRAKE_OPEN_PR_HOURS}h` };
    }
  }

  if (typeof input.recentFailureCount === 'number' && input.recentFailureCount >= BRAKE_FAILURE_COUNT) {
    return { brake: true, reason: `${input.recentFailureCount} failures in last ${BRAKE_LOOKBACK_DAYS} days (limit ${BRAKE_FAILURE_COUNT})` };
  }

  const cost = input.weeklyDeepSeekCostUsd;
  if (typeof cost !== 'number' || !Number.isFinite(cost)) {
    return { brake: true, reason: 'weekly DeepSeek cost unknown' };
  }
  if (cost > BRAKE_WEEKLY_COST_USD) {
    return { brake: true, reason: `weekly DeepSeek cost $${cost.toFixed(2)} > $${BRAKE_WEEKLY_COST_USD.toFixed(2)}` };
  }

  return { brake: false };
}

/**
 * Generate a heartbeat line for runs.log.
 * @param {string} now - ISO timestamp
 * @param {number} issuesPicked
 * @param {string} [brakeReason]
 * @returns {string}
 */
export function heartbeatLine(now, issuesPicked, brakeReason) {
  const ts = now || new Date().toISOString();
  if (brakeReason) {
    return `${ts} brake: ${brakeReason}`;
  }
  return `${ts} picked=${issuesPicked}`;
}

// ── CLI entry point: node brake.mjs <input.json> ──
if (argv[1] && argv[1].endsWith('brake.mjs') && argv[2]) {
  const raw = readFileSync(argv[2], 'utf8');
  const input = JSON.parse(raw);
  const now = input.now || new Date().toISOString();
  const result = checkBrakes(input, now);
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exit(result.brake ? 1 : 0);
}
