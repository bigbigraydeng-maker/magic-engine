/**
 * Pure scheduling logic for a weekly reel loop.
 *
 * Given a week start, a per-week quota, candidate items and items that are
 * already scheduled, this module assigns candidates to evenly spaced slots
 * within the week. It avoids placing two items with the same product key on
 * adjacent slots (relative to already placed items) and reports any
 * candidates that could not be scheduled along with the reason.
 */

import { styleViolation, stylePenalty, type EntryStyle, type StyleViolation } from './style-rules';

export interface ScheduleCandidate {
  id: string;
  productKey: string | null;
  rankAt: string;
  /** Optional: when present the style rules (music, variants, template runs) apply. */
  style?: EntryStyle | null;
}

export interface ScheduledItem {
  id: string;
  publishOn: string;
  productKey: string | null;
  style?: EntryStyle | null;
}

export interface PlanReelScheduleInput {
  weekStart: string;
  weekEnd: string;
  reelPerWeek: number;
  candidates: ScheduleCandidate[];
  alreadyScheduled: ScheduledItem[];
}

export type UnscheduledReason = 'over_quota' | 'product_adjacent' | StyleViolation;

export interface PlanReelScheduleResult {
  assignments: Array<{ id: string; publishOn: string }>;
  unscheduled: Array<{ id: string; reason: UnscheduledReason }>;
  cappedAt: number | null;
}

interface PlacedEntry {
  publishOn: string;
  productKey: string | null;
  style?: EntryStyle | null;
}

interface RankedCandidate {
  candidate: ScheduleCandidate;
  index: number;
  rankMs: number;
}

const MAX_SLOTS = 7;

/** Add `n` days to a 'YYYY-MM-DD' string using UTC to avoid time zones. */
function addDays(dateStr: string, n: number): string {
  const parts = dateStr.split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  const base = Date.UTC(year, month - 1, day);
  const shifted = base + n * 24 * 60 * 60 * 1000;
  return new Date(shifted).toISOString().slice(0, 10);
}

/** Compute the slot dates for the given week start and slot count. */
function computeSlotDates(weekStart: string, slotCount: number): string[] {
  const dates: string[] = [];
  for (let i = 0; i < slotCount; i += 1) {
    const offset = Math.floor((i * 7) / slotCount);
    dates.push(addDays(weekStart, offset));
  }
  return dates;
}

/** Sort candidates by rankAt ascending; invalid dates last; stable on index. */
function sortCandidates(candidates: ScheduleCandidate[]): RankedCandidate[] {
  const ranked: RankedCandidate[] = candidates.map((candidate, index) => {
    const parsed = Date.parse(candidate.rankAt);
    return {
      candidate,
      index,
      rankMs: Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed,
    };
  });
  ranked.sort((a, b) => {
    if (a.rankMs !== b.rankMs) {
      return a.rankMs - b.rankMs;
    }
    return a.index - b.index;
  });
  return ranked;
}

/** Find the nearest placed entry strictly before the given date. */
function nearestBefore(placed: PlacedEntry[], date: string): PlacedEntry | null {
  let best: PlacedEntry | null = null;
  for (const entry of placed) {
    if (entry.publishOn < date) {
      if (best === null || entry.publishOn > best.publishOn) {
        best = entry;
      }
    }
  }
  return best;
}

/** Find the nearest placed entry strictly after the given date. */
function nearestAfter(placed: PlacedEntry[], date: string): PlacedEntry | null {
  let best: PlacedEntry | null = null;
  for (const entry of placed) {
    if (entry.publishOn > date) {
      if (best === null || entry.publishOn < best.publishOn) {
        best = entry;
      }
    }
  }
  return best;
}

/** A candidate conflicts at `date` if a neighbour shares its product key. */
function conflictsAt(
  placed: PlacedEntry[],
  date: string,
  productKey: string | null,
): boolean {
  if (productKey === null) {
    return false;
  }
  const before = nearestBefore(placed, date);
  if (before !== null && before.productKey === productKey) {
    return true;
  }
  const after = nearestAfter(placed, date);
  if (after !== null && after.productKey === productKey) {
    return true;
  }
  return false;
}

export function planReelSchedule(
  input: PlanReelScheduleInput,
): PlanReelScheduleResult {
  const slotCount = Math.min(MAX_SLOTS, Math.max(0, Math.floor(input.reelPerWeek)));
  const cappedAt = input.reelPerWeek > MAX_SLOTS ? MAX_SLOTS : null;
  const slotDates = computeSlotDates(input.weekStart, slotCount);
  return { ...fillSlots(slotDates, input.candidates, input.alreadyScheduled), cappedAt };
}

/**
 * Fills each free slot date with the oldest candidate whose product does not sit next to the same product.
 * A date already taken by `alreadyScheduled` is never filled again; neighbours are looked up across every
 * already-scheduled item, not only the ones on slot dates.
 */
export function fillSlots(
  slotDates: readonly string[],
  candidates: ScheduleCandidate[],
  alreadyScheduled: readonly ScheduledItem[],
): Omit<PlanReelScheduleResult, 'cappedAt'> {
  const occupied = new Set(alreadyScheduled.map((item) => item.publishOn));
  const freeSlots = slotDates.filter((date) => !occupied.has(date));

  const sorted = sortCandidates(candidates);
  const used = new Set<number>();
  const placed: PlacedEntry[] = alreadyScheduled.map((item) => ({
    publishOn: item.publishOn,
    productKey: item.productKey,
    style: item.style,
  }));
  const rejected = new Map<string, UnscheduledReason>();

  const assignments: Array<{ id: string; publishOn: string }> = [];
  let emptySlots = 0;

  for (const slotDate of freeSlots) {
    let chosen: RankedCandidate | null = null;
    let chosenPenalty = Number.POSITIVE_INFINITY;
    for (const entry of sorted) {
      if (used.has(entry.index)) {
        continue;
      }
      const reason: UnscheduledReason | null = conflictsAt(placed, slotDate, entry.candidate.productKey)
        ? 'product_adjacent'
        : styleViolation(entry.candidate.style, slotDate, placed);
      if (reason !== null) {
        rejected.set(entry.candidate.id, reason);
        continue;
      }
      const penalty = stylePenalty(entry.candidate.style, slotDate, placed);
      if (penalty < chosenPenalty) {
        chosen = entry;
        chosenPenalty = penalty;
      }
    }
    if (chosen === null) {
      emptySlots += 1;
      continue;
    }
    used.add(chosen.index);
    placed.push({
      publishOn: slotDate,
      productKey: chosen.candidate.productKey,
      style: chosen.candidate.style,
    });
    assignments.push({ id: chosen.candidate.id, publishOn: slotDate });
  }

  const reason: UnscheduledReason =
    emptySlots > 0 ? 'product_adjacent' : 'over_quota';

  const unscheduled: Array<{ id: string; reason: UnscheduledReason }> = [];
  for (const entry of sorted) {
    if (!used.has(entry.index)) {
      unscheduled.push({ id: entry.candidate.id, reason: rejected.get(entry.candidate.id) ?? reason });
    }
  }

  assignments.sort((a, b) => (a.publishOn < b.publishOn ? -1 : a.publishOn > b.publishOn ? 1 : 0));

  return { assignments, unscheduled };
}
