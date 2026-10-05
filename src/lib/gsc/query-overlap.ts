export interface QueryPageRow {
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  position: number;
}

export interface OverlapPage {
  page: string;
  clicks: number;
  impressions: number;
  position: number;
}

export interface OverlapQuery {
  query: string;
  total_clicks: number;
  total_impressions: number;
  pages: OverlapPage[];
}

export interface PagePair {
  page_a: string;
  page_b: string;
  shared_queries: number;
  shared_impressions: number;
}

export interface OverlapOptions {
  minPageImpressions?: number;
  minTotalImpressions?: number;
  maxQueries?: number;
}

const DEFAULT_MIN_PAGE_IMPRESSIONS = 3;
const DEFAULT_MIN_TOTAL_IMPRESSIONS = 20;
const DEFAULT_MAX_QUERIES = 60;
const DEFAULT_PAIR_LIMIT = 30;

export function normalisePage(url: string): string {
  const trimmed = url.trim();
  let path: string;
  try {
    const parsed = new URL(trimmed);
    path = parsed.pathname;
  } catch {
    path = trimmed;
  }
  const withoutQuery = path.split('?')[0].split('#')[0];
  const lower = withoutQuery.toLowerCase();
  if (lower.length > 1 && lower.endsWith('/')) {
    return lower.slice(0, -1);
  }
  return lower;
}

interface MergedPage {
  page: string;
  clicks: number;
  impressions: number;
  position: number;
}

function mergePageRows(rows: readonly QueryPageRow[]): MergedPage[] {
  const byPage = new Map<string, MergedPage>();
  for (const row of rows) {
    const page = normalisePage(row.page);
    const existing = byPage.get(page);
    if (!existing) {
      byPage.set(page, {
        page,
        clicks: row.clicks,
        impressions: row.impressions,
        position: row.position,
      });
      continue;
    }
    const totalImpressions = existing.impressions + row.impressions;
    const weighted =
      totalImpressions > 0
        ? (existing.position * existing.impressions + row.position * row.impressions) /
          totalImpressions
        : existing.position;
    existing.clicks += row.clicks;
    existing.impressions = totalImpressions;
    existing.position = weighted;
  }
  return Array.from(byPage.values());
}

export function findQueryOverlap(
  rows: readonly QueryPageRow[],
  opts?: OverlapOptions,
): OverlapQuery[] {
  const minPageImpressions = opts?.minPageImpressions ?? DEFAULT_MIN_PAGE_IMPRESSIONS;
  const minTotalImpressions = opts?.minTotalImpressions ?? DEFAULT_MIN_TOTAL_IMPRESSIONS;
  const maxQueries = opts?.maxQueries ?? DEFAULT_MAX_QUERIES;

  const byQuery = new Map<string, QueryPageRow[]>();
  for (const row of rows) {
    const key = row.query.trim().toLowerCase();
    const bucket = byQuery.get(key);
    if (bucket) {
      bucket.push(row);
    } else {
      byQuery.set(key, [row]);
    }
  }

  const results: OverlapQuery[] = [];
  for (const [query, queryRows] of byQuery) {
    const merged = mergePageRows(queryRows).filter(
      (p) => p.impressions >= minPageImpressions,
    );
    if (merged.length < 2) {
      continue;
    }
    const totalImpressions = merged.reduce((sum, p) => sum + p.impressions, 0);
    if (totalImpressions < minTotalImpressions) {
      continue;
    }
    const totalClicks = merged.reduce((sum, p) => sum + p.clicks, 0);
    const pages = merged
      .map<OverlapPage>((p) => ({
        page: p.page,
        clicks: p.clicks,
        impressions: p.impressions,
        position: p.position,
      }))
      .sort((a, b) => b.impressions - a.impressions);
    results.push({
      query,
      total_clicks: totalClicks,
      total_impressions: totalImpressions,
      pages,
    });
  }

  results.sort((a, b) => b.total_impressions - a.total_impressions);
  return results.slice(0, maxQueries);
}

export function summarisePagePairs(
  overlaps: readonly OverlapQuery[],
  limit: number = DEFAULT_PAIR_LIMIT,
): PagePair[] {
  const pairs = new Map<string, PagePair>();
  for (const overlap of overlaps) {
    if (overlap.pages.length < 2) {
      continue;
    }
    const first = overlap.pages[0].page;
    const second = overlap.pages[1].page;
    const pageA = first < second ? first : second;
    const pageB = first < second ? second : first;
    const key = `${pageA}\u0000${pageB}`;
    const existing = pairs.get(key);
    if (existing) {
      existing.shared_queries += 1;
      existing.shared_impressions += overlap.total_impressions;
    } else {
      pairs.set(key, {
        page_a: pageA,
        page_b: pageB,
        shared_queries: 1,
        shared_impressions: overlap.total_impressions,
      });
    }
  }
  const sorted = Array.from(pairs.values()).sort(
    (a, b) => b.shared_impressions - a.shared_impressions,
  );
  return sorted.slice(0, limit);
}
