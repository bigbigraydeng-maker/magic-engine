import { describe, it, expect } from 'vitest';
import { planReelSchedule } from '../schedule';

const WEEK_START = '2026-11-09';
const WEEK_END = '2026-11-15';

function baseInput(reelPerWeek: number) {
  return {
    weekStart: WEEK_START,
    weekEnd: WEEK_END,
    reelPerWeek,
    candidates: [],
    alreadyScheduled: [],
  };
}

describe('planReelSchedule slot dates', () => {
  it('places 1 slot on the week start', () => {
    const result = planReelSchedule({
      ...baseInput(1),
      candidates: [{ id: 'a', productKey: 'p1', rankAt: '2026-11-01T00:00:00Z' }],
    });
    expect(result.assignments.map((a) => a.publishOn)).toEqual(['2026-11-09']);
  });

  it('places 2 slots at offsets 0 and 3', () => {
    const result = planReelSchedule({
      ...baseInput(2),
      candidates: [
        { id: 'a', productKey: 'p1', rankAt: '2026-11-01T00:00:00Z' },
        { id: 'b', productKey: 'p2', rankAt: '2026-11-02T00:00:00Z' },
      ],
    });
    expect(result.assignments.map((a) => a.publishOn)).toEqual([
      '2026-11-09',
      '2026-11-12',
    ]);
  });

  it('places 3 slots at offsets 0, 2, 4', () => {
    const result = planReelSchedule({
      ...baseInput(3),
      candidates: [
        { id: 'a', productKey: 'p1', rankAt: '2026-11-01T00:00:00Z' },
        { id: 'b', productKey: 'p2', rankAt: '2026-11-02T00:00:00Z' },
        { id: 'c', productKey: 'p3', rankAt: '2026-11-03T00:00:00Z' },
      ],
    });
    expect(result.assignments.map((a) => a.publishOn)).toEqual([
      '2026-11-09',
      '2026-11-11',
      '2026-11-13',
    ]);
  });

  it('places 7 slots on all seven days', () => {
    const candidates = Array.from({ length: 7 }, (_, i) => ({
      id: `c${i}`,
      productKey: `k${i}`,
      rankAt: `2026-11-0${i + 1}T00:00:00Z`,
    }));
    const result = planReelSchedule({ ...baseInput(7), candidates });
    expect(result.assignments.map((a) => a.publishOn)).toEqual([
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
      '2026-11-14',
      '2026-11-15',
    ]);
    expect(result.cappedAt).toBeNull();
  });

  it('caps at 7 slots when reelPerWeek is 9', () => {
    const candidates = Array.from({ length: 9 }, (_, i) => ({
      id: `c${i}`,
      productKey: `k${i}`,
      rankAt: `2026-11-0${i + 1}T00:00:00Z`,
    }));
    const result = planReelSchedule({ ...baseInput(9), candidates });
    expect(result.assignments).toHaveLength(7);
    expect(result.assignments.map((a) => a.publishOn)).toEqual([
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
      '2026-11-14',
      '2026-11-15',
    ]);
    expect(result.unscheduled).toHaveLength(2);
    expect(result.unscheduled.every((u) => u.reason === 'over_quota')).toBe(true);
    expect(result.cappedAt).toBe(7);
  });
});

describe('planReelSchedule ordering', () => {
  it('assigns earliest rankAt to earliest date', () => {
    const result = planReelSchedule({
      ...baseInput(3),
      candidates: [
        { id: 'c', productKey: 'p3', rankAt: '2026-11-03T00:00:00Z' },
        { id: 'a', productKey: 'p2', rankAt: '2026-11-01T00:00:00Z' },
        { id: 'b', productKey: 'p1', rankAt: '2026-11-02T00:00:00Z' },
      ],
    });
    expect(result.assignments).toEqual([
      { id: 'a', publishOn: '2026-11-09' },
      { id: 'b', publishOn: '2026-11-11' },
      { id: 'c', publishOn: '2026-11-13' },
    ]);
  });
});

describe('planReelSchedule adjacency', () => {
  it('skips a candidate whose product key is adjacent to a placed item', () => {
    const result = planReelSchedule({
      ...baseInput(3),
      candidates: [
        { id: 'a', productKey: 'p1', rankAt: '2026-11-01T00:00:00Z' },
        { id: 'b', productKey: 'p1', rankAt: '2026-11-02T00:00:00Z' },
        { id: 'c', productKey: 'p2', rankAt: '2026-11-03T00:00:00Z' },
      ],
    });
    expect(result.assignments).toEqual([
      { id: 'a', publishOn: '2026-11-09' },
      { id: 'c', publishOn: '2026-11-11' },
      { id: 'b', publishOn: '2026-11-13' },
    ]);
    expect(result.unscheduled).toEqual([]);
  });

  it('leaves a candidate unscheduled when no slot fits', () => {
    const result = planReelSchedule({
      ...baseInput(2),
      candidates: [
        { id: 'a', productKey: 'p1', rankAt: '2026-11-01T00:00:00Z' },
        { id: 'b', productKey: 'p1', rankAt: '2026-11-02T00:00:00Z' },
      ],
    });
    expect(result.assignments).toEqual([{ id: 'a', publishOn: '2026-11-09' }]);
    expect(result.unscheduled).toEqual([
      { id: 'b', reason: 'product_adjacent' },
    ]);
  });
});

describe('planReelSchedule with alreadyScheduled', () => {
  it('respects occupied slots and adjacency to existing items', () => {
    const result = planReelSchedule({
      ...baseInput(3),
      alreadyScheduled: [
        { id: 'x', publishOn: '2026-11-09', productKey: 'p1' },
      ],
      candidates: [
        { id: 'a', productKey: 'p1', rankAt: '2026-11-01T00:00:00Z' },
        { id: 'b', productKey: 'p2', rankAt: '2026-11-02T00:00:00Z' },
        { id: 'c', productKey: 'p3', rankAt: '2026-11-03T00:00:00Z' },
      ],
    });
    expect(result.assignments).toEqual([
      { id: 'b', publishOn: '2026-11-11' },
      { id: 'a', publishOn: '2026-11-13' },
    ]);
    expect(result.unscheduled).toEqual([
      { id: 'c', reason: 'over_quota' },
    ]);
  });
});

describe('planReelSchedule null productKey', () => {
  it('never conflicts for null product keys', () => {
    const result = planReelSchedule({
      ...baseInput(2),
      candidates: [
        { id: 'a', productKey: null, rankAt: '2026-11-01T00:00:00Z' },
        { id: 'b', productKey: null, rankAt: '2026-11-02T00:00:00Z' },
      ],
    });
    expect(result.assignments).toEqual([
      { id: 'a', publishOn: '2026-11-09' },
      { id: 'b', publishOn: '2026-11-12' },
    ]);
    expect(result.unscheduled).toEqual([]);
  });
});

describe('planReelSchedule zero quota', () => {
  it('assigns nothing and marks all candidates over_quota', () => {
    const result = planReelSchedule({
      ...baseInput(0),
      candidates: [
        { id: 'a', productKey: 'p1', rankAt: '2026-11-01T00:00:00Z' },
        { id: 'b', productKey: 'p2', rankAt: '2026-11-02T00:00:00Z' },
      ],
    });
    expect(result.assignments).toEqual([]);
    expect(result.unscheduled).toEqual([
      { id: 'a', reason: 'over_quota' },
      { id: 'b', reason: 'over_quota' },
    ]);
    expect(result.cappedAt).toBeNull();
  });
});
