export const ACCURACY_WINDOW_DAYS = 56;
export const MIN_N_FOR_POINT = 10;
export const MAX_UNKNOWN_SHARE = 0.2;
const MS_PER_DAY = 86_400_000;

/** agree / disagree = same or different category; review_unclear = reviewer could not read it; not_reviewed = skipped (reason elsewhere) */
export type ReviewResult = 'agree' | 'disagree' | 'review_unclear' | 'not_reviewed';
export type Ruling = 'ai_right' | 'review_right' | 'neither';

export interface ReviewedItem {
  judgmentId: string;
  stage: string; // the AI-judged stage key
  reviewedAt: string; // ISO
  result: ReviewResult;
  /** human ruling, only meaningful when result === 'disagree'; null = not ruled */
  ruling: Ruling | null;
}

export interface StageAccuracy {
  stage: string;
  sampled: number;
  reviewUnclear: number;
  notReviewed: number;
  agree: number;
  disagree: number;
  aiRight: number;
  reviewRight: number;
  neither: number;
  /** disagree with no ruling */
  unknown: number;
  /** agree + disagree */
  n: number;
  lower: number | null;
  upper: number | null;
  /** only when n >= MIN_N_FOR_POINT and unknown <= MAX_UNKNOWN_SHARE * n: (lower + upper) / 2 */
  point: number | null;
  /** agree / n */
  agreementRate: number | null;
}

interface Accumulator {
  stage: string;
  sampled: number;
  reviewUnclear: number;
  notReviewed: number;
  agree: number;
  disagree: number;
  aiRight: number;
  reviewRight: number;
  neither: number;
  unknown: number;
}

function emptyAcc(stage: string): Accumulator {
  return {
    stage,
    sampled: 0,
    reviewUnclear: 0,
    notReviewed: 0,
    agree: 0,
    disagree: 0,
    aiRight: 0,
    reviewRight: 0,
    neither: 0,
    unknown: 0,
  };
}

function accumulate(acc: Accumulator, item: ReviewedItem): void {
  acc.sampled += 1;
  if (item.result === 'review_unclear') {
    acc.reviewUnclear += 1;
    return;
  }
  if (item.result === 'not_reviewed') {
    acc.notReviewed += 1;
    return;
  }
  if (item.result === 'agree') {
    acc.agree += 1;
    return;
  }
  // disagree
  acc.disagree += 1;
  if (item.ruling === 'ai_right') acc.aiRight += 1;
  else if (item.ruling === 'review_right') acc.reviewRight += 1;
  else if (item.ruling === 'neither') acc.neither += 1;
  else acc.unknown += 1;
}

function finalize(acc: Accumulator): StageAccuracy {
  const n = acc.agree + acc.disagree;
  const lower = n === 0 ? null : (acc.agree + acc.aiRight) / n;
  const upper = n === 0 ? null : (acc.agree + acc.aiRight + acc.unknown) / n;
  const agreementRate = n === 0 ? null : acc.agree / n;
  let point: number | null = null;
  if (lower !== null && upper !== null && n >= MIN_N_FOR_POINT && acc.unknown <= MAX_UNKNOWN_SHARE * n) {
    point = (lower + upper) / 2;
  }
  return {
    stage: acc.stage,
    sampled: acc.sampled,
    reviewUnclear: acc.reviewUnclear,
    notReviewed: acc.notReviewed,
    agree: acc.agree,
    disagree: acc.disagree,
    aiRight: acc.aiRight,
    reviewRight: acc.reviewRight,
    neither: acc.neither,
    unknown: acc.unknown,
    n,
    lower,
    upper,
    point,
    agreementRate,
  };
}

/**
 * Keep items with nowMs - Date.parse(reviewedAt) <= windowDays * MS_PER_DAY (and reviewedAt parseable).
 * Group by stage. lower = (agree + aiRight) / n; upper = (agree + aiRight + unknown) / n; n === 0 -> nulls.
 * ruling only counts for result === 'disagree' items; ruling on other results is ignored.
 * Return sorted by stage ascending.
 */
export function computeAccuracy(
  items: readonly ReviewedItem[],
  nowMs: number,
  windowDays: number = ACCURACY_WINDOW_DAYS,
): StageAccuracy[] {
  const windowMs = windowDays * MS_PER_DAY;
  const byStage = new Map<string, Accumulator>();
  for (const item of items) {
    const parsed = Date.parse(item.reviewedAt);
    if (Number.isNaN(parsed)) continue;
    if (nowMs - parsed > windowMs) continue;
    let acc = byStage.get(item.stage);
    if (!acc) {
      acc = emptyAcc(item.stage);
      byStage.set(item.stage, acc);
    }
    accumulate(acc, item);
  }
  const stages = Array.from(byStage.keys()).sort();
  return stages.map((stage) => finalize(byStage.get(stage) as Accumulator));
}
