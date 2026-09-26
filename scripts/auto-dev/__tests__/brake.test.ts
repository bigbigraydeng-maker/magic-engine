import { describe, expect, it } from 'vitest';

import {
  checkBrakes,
  heartbeatLine,
  maintainInProgress,
  maintainPR,
} from '../brake.mjs';

const NOW = '2026-09-27T11:13:00.000Z';

describe('maintainPR', () => {
  it('returns none for a fresh draft PR', () => {
    const pr = { number: 1, draft: true, createdAt: '2026-09-27T10:00:00.000Z', riskGateStale: false };
    expect(maintainPR(pr, NOW)).toEqual({ action: 'none' });
  });

  it('closes a draft PR older than 24 hours', () => {
    const pr = { number: 2, draft: true, createdAt: '2026-09-26T10:00:00.000Z', riskGateStale: false };
    const result = maintainPR(pr, NOW);
    expect(result.action).toBe('close');
    expect(result.reason).toContain('#2');
    expect(result.reason).toContain('25h');
  });

  it('updates branch when risk gate is stale', () => {
    const pr = { number: 3, draft: false, createdAt: NOW, riskGateStale: true };
    const result = maintainPR(pr, NOW);
    expect(result.action).toBe('update-branch');
    expect(result.reason).toContain('#3');
  });

  it('prefers close over update-branch for stale drafts', () => {
    const pr = { number: 4, draft: true, createdAt: '2026-09-25T00:00:00.000Z', riskGateStale: true };
    expect(maintainPR(pr, NOW).action).toBe('close');
  });

  it('returns none for a non-draft non-stale PR', () => {
    const pr = { number: 5, draft: false, createdAt: NOW, riskGateStale: false };
    expect(maintainPR(pr, NOW)).toEqual({ action: 'none' });
  });
});

describe('maintainInProgress', () => {
  it('does not unlock a recent in-progress issue', () => {
    const issue = { number: 10, labeledAt: '2026-09-27T10:00:00.000Z' };
    expect(maintainInProgress(issue, NOW)).toEqual({ unlock: false });
  });

  it('unlocks an in-progress issue older than 6 hours', () => {
    const issue = { number: 11, labeledAt: '2026-09-27T04:00:00.000Z' };
    const result = maintainInProgress(issue, NOW);
    expect(result.unlock).toBe(true);
    expect(result.reason).toContain('#11');
    expect(result.reason).toContain('7h');
  });

  it('does not unlock at exactly 6 hours', () => {
    const issue = { number: 12, labeledAt: '2026-09-27T05:13:00.000Z' };
    expect(maintainInProgress(issue, NOW).unlock).toBe(false);
  });
});

describe('checkBrakes', () => {
  const clean = () => ({
    revertedLanePRs: 0,
    openLanePRsAfterMaintenance: [],
    recentFailureCount: 0,
    weeklyDeepSeekCostUsd: 0,
  });

  it('returns no brake when all clear', () => {
    expect(checkBrakes(clean(), NOW)).toEqual({ brake: false });
  });

  it('brakes on reverted PR', () => {
    const input = { ...clean(), revertedLanePRs: 1 };
    const result = checkBrakes(input, NOW);
    expect(result.brake).toBe(true);
    expect(result.reason).toContain('reverted');
  });

  it('brakes on open PR older than 48 hours', () => {
    const input = {
      ...clean(),
      openLanePRsAfterMaintenance: [{ number: 99, createdAt: '2026-09-25T00:00:00.000Z' }],
    };
    const result = checkBrakes(input, NOW);
    expect(result.brake).toBe(true);
    expect(result.reason).toContain('#99');
    expect(result.reason).toContain('48h');
  });

  it('does not brake on open PR under 48 hours', () => {
    const input = {
      ...clean(),
      openLanePRsAfterMaintenance: [{ number: 100, createdAt: '2026-09-26T00:00:00.000Z' }],
    };
    expect(checkBrakes(input, NOW).brake).toBe(false);
  });

  it('brakes on 3 failures', () => {
    const input = { ...clean(), recentFailureCount: 3 };
    const result = checkBrakes(input, NOW);
    expect(result.brake).toBe(true);
    expect(result.reason).toContain('3 failures');
  });

  it('does not brake on 2 failures', () => {
    expect(checkBrakes({ ...clean(), recentFailureCount: 2 }, NOW).brake).toBe(false);
  });

  it('brakes on weekly cost > $5', () => {
    const input = { ...clean(), weeklyDeepSeekCostUsd: 5.01 };
    const result = checkBrakes(input, NOW);
    expect(result.brake).toBe(true);
    expect(result.reason).toContain('$5.01');
  });

  it('does not brake at exactly $5', () => {
    expect(checkBrakes({ ...clean(), weeklyDeepSeekCostUsd: 5 }, NOW).brake).toBe(false);
  });

  it('brakes on NaN cost', () => {
    expect(checkBrakes({ ...clean(), weeklyDeepSeekCostUsd: NaN }, NOW).brake).toBe(true);
  });

  it('checks conditions in priority order (revert first)', () => {
    const input = { ...clean(), revertedLanePRs: 1, recentFailureCount: 5, weeklyDeepSeekCostUsd: 10 };
    expect(checkBrakes(input, NOW).reason).toContain('reverted');
  });
});

describe('heartbeatLine', () => {
  it('formats a normal line', () => {
    expect(heartbeatLine(NOW, 2)).toBe('2026-09-27T11:13:00.000Z picked=2');
  });

  it('formats a zero-pick line', () => {
    expect(heartbeatLine(NOW, 0)).toBe('2026-09-27T11:13:00.000Z picked=0');
  });

  it('formats a brake line', () => {
    const line = heartbeatLine(NOW, 0, 'sandbox failed');
    expect(line).toBe('2026-09-27T11:13:00.000Z brake: sandbox failed');
  });
});
