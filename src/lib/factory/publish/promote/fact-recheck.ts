import type { SocialFactSource } from '@/lib/social/weekly-loop/fact-aliases'
import type { OkFactSource } from '@/lib/social/weekly-loop/reel-facts'
import {
  checkReelFacts,
  factCheckToday,
  factProblemLines,
} from '@/lib/social/weekly-loop/reel-facts'

export interface FactRecheckSummary {
  verdict: 'pass' | 'fail' | 'needs_human' | 'not_applicable'
  catalog_version: number | null
  /** Up to 3 plain-language lines for what did not pass. */
  problems: string[]
  overlay_checked: boolean
  note: string | null
}

export type FactRecheck =
  | { ok: true; summary: FactRecheckSummary }
  | { ok: false; status: number; error: string; summary: FactRecheckSummary }

export type FactSourceLoader = (
  clientId: string,
  today: string,
) => Promise<SocialFactSource>

function blocked(
  status: number,
  error: string,
  summary: FactRecheckSummary,
): FactRecheck {
  return { ok: false, status, error, summary }
}

function emptySummary(
  verdict: FactRecheckSummary['verdict'],
  note: string | null,
): FactRecheckSummary {
  return {
    verdict,
    catalog_version: null,
    problems: [],
    overlay_checked: false,
    note,
  }
}

/** Loads the catalog; anything but a usable catalog (or "this client has none") blocks. */
async function loadSource(
  load: FactSourceLoader,
  clientId: string,
  today: string,
  prefix: string,
): Promise<OkFactSource | FactRecheck> {
  let source: SocialFactSource
  try {
    source = await load(clientId, today)
  } catch {
    return blocked(503, `${prefix}读不到团目录，先不公开`, emptySummary('needs_human', null))
  }
  if (source.ok) return source
  if (source.reason === 'catalog_not_published') {
    return { ok: true, summary: emptySummary('not_applicable', '这位客户没有已发布的团目录，不核对') }
  }
  return blocked(503, `${prefix}读不到团目录，先不公开：${source.reason}`, emptySummary('needs_human', null))
}

/** Re-checks one reel against the catalog published right now, at the moment it is about to become public. Fail-closed: only a pass (or a client with no published catalog) goes through. */
export async function recheckReelFacts(input: {
  loadFactSource: FactSourceLoader
  order: { id: string; client_id: string; brief: unknown; output: unknown }
  now: Date
  only?: 'first_comment'
}): Promise<FactRecheck> {
  const today = factCheckToday(input.now)
  const { order } = input
  const prefix = input.only === 'first_comment' ? '首评' : ''

  const loaded = await loadSource(input.loadFactSource, order.client_id, today, prefix)
  if (!('catalogVersion' in loaded)) return loaded
  const source = loaded

  const { result, overlayChecked } = checkReelFacts({
    brief: order.brief,
    output: order.output,
    orderId: order.id,
    source,
    today,
    only: input.only,
  })
  const problems = factProblemLines(result.items, 3)
  const note =
    input.only === undefined && !overlayChecked
      ? '画面字幕没有文本，未核'
      : null
  const summary: FactRecheckSummary = {
    verdict: result.verdict,
    catalog_version: source.catalogVersion,
    problems,
    overlay_checked: overlayChecked,
    note,
  }

  if (result.verdict === 'pass') {
    return { ok: true, summary }
  }

  const tail = '。改好片里文案或团目录后重新预览'
  if (result.verdict === 'fail') {
    return blocked(
      422,
      `${prefix}和团目录对不上，先不公开：${problems.join('；')}${tail}`,
      summary,
    )
  }
  return blocked(
    409,
    `${prefix}要人核对，先不公开：${problems.join('；')}${tail}`,
    summary,
  )
}
