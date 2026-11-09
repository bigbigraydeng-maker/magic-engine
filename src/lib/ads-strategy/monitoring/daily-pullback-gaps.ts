/**
 * 每日广告回拉「日结果」局部失败 —— 纯解析（读 cron_run_logs.summary.errors）。
 *
 * 只认会影响成绩单 / 诊断 / 经营状态链路的来源；ad_config 另有 ads_config_unreadable。
 */

export type DailyPullbackGapSource =
  | 'ad_daily'
  | 'ad_health'
  | 'ad_diagnostics'
  | 'ads_growth_state'
  | 'ad_daily_secondary'

export interface PullbackErrorRow {
  client_id?: string
  source?: string
  error?: string
}

export interface DailyPullbackGap {
  clientId: string
  sources: DailyPullbackGapSource[]
  detail: string
}

const GAP_SOURCES = new Set<string>([
  'ad_daily',
  'ad_health',
  'ad_diagnostics',
  'ads_growth_state',
  'ad_daily_secondary',
])

const SOURCE_LABEL: Record<DailyPullbackGapSource, string> = {
  ad_daily: '广告每日结果',
  ad_health: '广告体检叙事',
  ad_diagnostics: '广告诊断',
  ads_growth_state: '广告经营状态',
  ad_daily_secondary: '副账户每日结果',
}

function isGapSource(s: string): s is DailyPullbackGapSource {
  return GAP_SOURCES.has(s)
}

function redactError(raw: string): string {
  return raw
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .slice(0, 80)
}

/** 从一轮 summary.errors 抽出按客户聚合的缺口（best-effort 源不进 failed 计数，但必须可见）。 */
export function collectDailyPullbackGaps(
  errors: readonly PullbackErrorRow[] | undefined,
): DailyPullbackGap[] {
  if (!errors?.length) return []

  const byClient = new Map<string, { sources: Set<DailyPullbackGapSource>; sample: string }>()
  for (const row of errors) {
    const source = row.source ?? ''
    if (!isGapSource(source)) continue
    const clientId = row.client_id?.trim() || '?'
    const cur = byClient.get(clientId) ?? { sources: new Set(), sample: '' }
    cur.sources.add(source)
    if (!cur.sample && row.error) cur.sample = redactError(row.error)
    byClient.set(clientId, cur)
  }

  const out: DailyPullbackGap[] = []
  for (const [clientId, { sources, sample }] of byClient) {
    const ordered = [...sources]
    const labels = ordered.map((s) => SOURCE_LABEL[s]).join('、')
    out.push({
      clientId,
      sources: ordered,
      detail: sample ? `${labels}（${sample}）` : labels,
    })
  }
  return out
}

export function formatDailyPullbackGapWhat(clientName: string, gap: DailyPullbackGap): string {
  const labels = gap.sources.map((s) => SOURCE_LABEL[s]).join('、')
  return `${clientName} 昨天的广告每日回拉有环节没办成：${labels}。成绩单或提醒可能缺这一块，广告不会被自动改动。`
}
