/** FNV-1a 32-bit hash of a string -> unsigned 32-bit integer. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    // h *= 16777619 with 32-bit overflow
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 PRNG, returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SampleCandidate {
  id: string;
  stage: string;
}

/**
 * Deterministic shuffle: sort a copy by id ascending, then Fisher-Yates with mulberry32(hashSeed(seedKey)).
 */
export function seededShuffle<T extends { id: string }>(
  items: readonly T[],
  seedKey: string,
): T[] {
  const out = items.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const rand = mulberry32(hashSeed(seedKey));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

/** Take the first k of seededShuffle(items, seedKey). k <= 0 -> []. */
export function pickRandom<T extends { id: string }>(
  items: readonly T[],
  k: number,
  seedKey: string,
): T[] {
  if (k <= 0) return [];
  return seededShuffle(items, seedKey).slice(0, k);
}

export interface StratifiedSample {
  picked: SampleCandidate[];
  /** how many candidates each stage had */
  populationByStage: Record<string, number>;
  /** how many were picked per stage */
  pickedByStage: Record<string, number>;
}

interface StageGroup {
  stage: string;
  items: SampleCandidate[];
}

function groupByStage(candidates: readonly SampleCandidate[]): StageGroup[] {
  const map = new Map<string, SampleCandidate[]>();
  for (const c of candidates) {
    const arr = map.get(c.stage);
    if (arr) arr.push(c);
    else map.set(c.stage, [c]);
  }
  const stages = Array.from(map.keys()).sort();
  return stages.map((stage) => ({ stage, items: map.get(stage) ?? [] }));
}

interface Quota {
  stage: string;
  quota: number;
  remainder: number;
}

function allocateQuotas(groups: readonly StageGroup[], cap: number, total: number): Quota[] {
  const quotas: Quota[] = groups.map((g) => {
    const exact = (cap * g.items.length) / total;
    const quota = Math.floor(exact);
    return { stage: g.stage, quota, remainder: exact - quota };
  });
  let assigned = quotas.reduce((s, q) => s + q.quota, 0);
  const order = quotas.slice().sort((a, b) => {
    if (b.remainder !== a.remainder) return b.remainder - a.remainder;
    return a.stage < b.stage ? -1 : a.stage > b.stage ? 1 : 0;
  });
  let idx = 0;
  while (assigned < cap && order.length > 0) {
    const target = order[idx % order.length] as Quota;
    target.quota += 1;
    assigned += 1;
    idx += 1;
  }
  return quotas;
}

/**
 * If candidates.length <= cap -> pick all.
 * Else proportional allocation by stage: exact_s = cap * n_s / N; quota_s = floor(exact_s);
 * distribute the remaining (cap - sum quota) one each to stages with the largest (exact_s - quota_s),
 * ties broken by stage name ascending. Within each stage take pickRandom(stageItems, quota_s, `${seedKey}:${stage}`).
 * Output `picked` sorted by stage ascending then id ascending. cap <= 0 -> empty picks.
 */
export function pickStratified(
  candidates: readonly SampleCandidate[],
  cap: number,
  seedKey: string,
): StratifiedSample {
  const groups = groupByStage(candidates);
  const populationByStage: Record<string, number> = {};
  for (const g of groups) populationByStage[g.stage] = g.items.length;

  const pickedByStage: Record<string, number> = {};
  const picked: SampleCandidate[] = [];

  if (cap <= 0) {
    for (const g of groups) pickedByStage[g.stage] = 0;
    return { picked, populationByStage, pickedByStage };
  }

  if (candidates.length <= cap) {
    for (const g of groups) {
      pickedByStage[g.stage] = g.items.length;
      for (const item of g.items) picked.push({ id: item.id, stage: item.stage });
    }
  } else {
    const quotas = allocateQuotas(groups, cap, candidates.length);
    for (const q of quotas) {
      const group = groups.find((g) => g.stage === q.stage);
      const items = group ? group.items : [];
      const chosen = pickRandom(items, q.quota, `${seedKey}:${q.stage}`);
      pickedByStage[q.stage] = chosen.length;
      for (const item of chosen) picked.push({ id: item.id, stage: item.stage });
    }
  }

  picked.sort((a, b) => {
    if (a.stage !== b.stage) return a.stage < b.stage ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return { picked, populationByStage, pickedByStage };
}
