/**
 * Account self-check for the social agent (design docs/specs/2026-11-05-social-agent-account-self-check-loop-v0.1.md).
 * Pure functions: given the recent reels of one account, measure how alike they are and say what to do about it.
 * Reads nothing, writes nothing. A field that cannot be read is reported as 'not_measured', never as 0 or as a pass.
 */

export interface AuditReel {
  id: string
  /** YYYY-MM-DD the work order was made. */
  createdOn: string
  template: string | null
  engine: string | null
  /** Music file as stored (path and extension are normalised away). */
  music: string | null
  scenes: number | null
  brandColor: string | null
  /** Id (first 8 chars) of the reel this one is a variant of; null = original. */
  variantOf: string | null
  /** Content form; when null it is inferred from template / engine. */
  format: string | null
  /** Content pillar (travel: atmosphere / practical / guest story / tour intro / history); null = untagged. */
  pillar: string | null
}

export type MetricStatus = 'ok' | 'over' | 'not_measured'

export interface MetricResult {
  key: 'D1' | 'D2' | 'D3' | 'D4' | 'D5' | 'D6'
  label: string
  status: MetricStatus
  value: string
  threshold: string
}

export interface Finding {
  key: MetricResult['key']
  /** A = reorder the schedule, B = order what is missing, C = a person or a developer must act. */
  tier: 'A' | 'B' | 'C'
  what: string
  how: string
}

export interface AuditThresholds {
  /** Reels looked at for template / visual concentration (the most recent N). */
  recentWindow: number
  maxTemplateShare: number
  maxSameTemplateRun: number
  musicLookbackDays: number
  maxTopMusicShare: number
  topMusicCount: number
  maxSameMusicWithinDays: number
  maxVariantsPerGroupWithinDays: number
  formatLookbackDays: number
  requiredFormats: readonly string[]
  maxPillarDriftPoints: number
  maxVisualSignatureShare: number
  /** Content mix target in percent per pillar (industry recipe); empty = not configured. */
  pillarMix: Readonly<Record<string, number>>
}

/** Travel starting values. Candidates from one account (CTS): they live here (industry layer), not in shared code paths. */
export const TRAVEL_THRESHOLDS: AuditThresholds = {
  recentWindow: 10,
  maxTemplateShare: 0.5,
  maxSameTemplateRun: 2,
  musicLookbackDays: 30,
  maxTopMusicShare: 0.6,
  topMusicCount: 3,
  maxSameMusicWithinDays: 7,
  maxVariantsPerGroupWithinDays: 7,
  formatLookbackDays: 30,
  requiredFormats: ['destination', 'people', 'explainer'],
  maxPillarDriftPoints: 15,
  maxVisualSignatureShare: 0.35,
  pillarMix: { atmosphere: 35, practical: 25, guest_story: 20, tour_intro: 15, history: 5 },
}

/** Forms the factory can already make. Anything else needs a new template or customer material. */
export const FORMS_FACTORY_CAN_MAKE: ReadonlySet<string> = new Set(['destination'])

const DAY_MS = 86_400_000

function dayNumber(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS)
}

export function normaliseMusic(raw: string | null): string | null {
  if (!raw) return null
  const file = raw.split('/').pop() ?? raw
  const stem = file.replace(/\.[a-z0-9]+$/i, '').toLowerCase().replace(/_/g, '-').replace(/-n$/, '')
  return stem || null
}

/** Remotion list / postcard templates are destination content; an external upload is a person-led video. */
export function inferFormat(reel: Pick<AuditReel, 'format' | 'template' | 'engine'>): string | null {
  if (reel.format) return reel.format
  if (reel.engine === 'external_upload') return 'people'
  if (reel.template === 'postcard' || reel.template === 'list') return 'destination'
  return null
}

function newestFirst(reels: readonly AuditReel[]): AuditReel[] {
  return [...reels].sort((a, b) => (a.createdOn === b.createdOn ? a.id.localeCompare(b.id) : b.createdOn.localeCompare(a.createdOn)))
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`
}

function countBy<T>(items: readonly T[], key: (t: T) => string | null): Map<string, number> {
  const m = new Map<string, number>()
  for (const it of items) {
    const k = key(it)
    if (k !== null) m.set(k, (m.get(k) ?? 0) + 1)
  }
  return m
}

function top(m: ReadonlyMap<string, number>): [string, number] | null {
  let best: [string, number] | null = null
  for (const e of m) if (best === null || e[1] > best[1]) best = e
  return best
}

const notMeasured = (key: MetricResult['key'], label: string, threshold: string, why: string): MetricResult =>
  ({ key, label, status: 'not_measured', value: why, threshold })

function d1(recent: readonly AuditReel[], t: AuditThresholds): MetricResult {
  const label = '模板集中度'
  const threshold = `最近 ${t.recentWindow} 条里同一模板 ≤ ${pct(t.maxTemplateShare)}，不连发超过 ${t.maxSameTemplateRun} 条`
  const known = recent.filter((r) => r.template !== null)
  if (known.length === 0) return notMeasured('D1', label, threshold, '工单没有模板字段')
  const [name, n] = top(countBy(known, (r) => r.template)) ?? ['', 0]
  const share = n / known.length
  let run = 0
  let longest = 0
  let prev: string | null = null
  for (const r of known) {
    run = r.template === prev ? run + 1 : 1
    prev = r.template
    longest = Math.max(longest, run)
  }
  const over = share > t.maxTemplateShare || longest > t.maxSameTemplateRun
  return { key: 'D1', label, status: over ? 'over' : 'ok', value: `${name} 占 ${pct(share)}，最长连续 ${longest} 条`, threshold }
}

function d2(reels: readonly AuditReel[], now: string, t: AuditThresholds): MetricResult {
  const label = 'BGM 重复'
  const threshold = `${t.musicLookbackDays} 天内前 ${t.topMusicCount} 首合计 ≤ ${pct(t.maxTopMusicShare)}；同一首 ${t.maxSameMusicWithinDays} 天内不重复`
  const from = dayNumber(now) - t.musicLookbackDays
  const win = reels.filter((r) => normaliseMusic(r.music) !== null && dayNumber(r.createdOn) >= from)
  if (win.length === 0) return notMeasured('D2', label, threshold, '工单没有配乐字段')
  const counts = countBy(win, (r) => normaliseMusic(r.music))
  const topShare = [...counts.values()].sort((a, b) => b - a).slice(0, t.topMusicCount).reduce((a, b) => a + b, 0) / win.length
  let repeats = 0
  const byTrack = new Map<string, number[]>()
  for (const r of win) {
    const k = normaliseMusic(r.music) as string
    byTrack.set(k, [...(byTrack.get(k) ?? []), dayNumber(r.createdOn)])
  }
  for (const days of byTrack.values()) {
    const s = [...days].sort((a, b) => a - b)
    for (let i = 1; i < s.length; i += 1) if (s[i] - s[i - 1] < t.maxSameMusicWithinDays) repeats += 1
  }
  const over = topShare > t.maxTopMusicShare || repeats > 0
  return { key: 'D2', label, status: over ? 'over' : 'ok', value: `${counts.size} 首曲子共 ${win.length} 条，前 ${t.topMusicCount} 首占 ${pct(topShare)}，${t.maxSameMusicWithinDays} 天内重复 ${repeats} 次`, threshold }
}

function d3(reels: readonly AuditReel[], t: AuditThresholds): MetricResult {
  const label = '改版扎堆'
  const threshold = `同一条片的改版 ${t.maxVariantsPerGroupWithinDays} 天内最多 1 条上账号`
  const groups = new Map<string, number[]>()
  for (const r of reels) {
    const key = r.variantOf ?? r.id.slice(0, 8)
    groups.set(key, [...(groups.get(key) ?? []), dayNumber(r.createdOn)])
  }
  let crowded = 0
  for (const days of groups.values()) {
    if (days.length > 1 && Math.max(...days) - Math.min(...days) <= t.maxVariantsPerGroupWithinDays) crowded += 1
  }
  return { key: 'D3', label, status: crowded > 0 ? 'over' : 'ok', value: `${crowded} 组改版在 ${t.maxVariantsPerGroupWithinDays} 天内成批出现`, threshold }
}

function d4(reels: readonly AuditReel[], now: string, t: AuditThresholds): { metric: MetricResult; missing: string[] } {
  const label = '形式覆盖'
  const threshold = `${t.formatLookbackDays} 天内至少各有 1 条：${t.requiredFormats.join(' / ')}`
  const from = dayNumber(now) - t.formatLookbackDays
  const win = reels.filter((r) => dayNumber(r.createdOn) >= from)
  const present = new Set(win.map(inferFormat).filter((f): f is string => f !== null))
  if (win.length === 0 || win.every((r) => inferFormat(r) === null)) {
    return { metric: notMeasured('D4', label, threshold, '看不出这些片是什么形式'), missing: [] }
  }
  const missing = t.requiredFormats.filter((f) => !present.has(f))
  return { metric: { key: 'D4', label, status: missing.length > 0 ? 'over' : 'ok', value: missing.length > 0 ? `缺：${missing.join('、')}` : '都有', threshold }, missing }
}

function d5(reels: readonly AuditReel[], now: string, t: AuditThresholds): MetricResult {
  const label = '内容柱配比'
  const threshold = `各柱与目标配比相差 ≤ ${t.maxPillarDriftPoints} 个百分点`
  const from = dayNumber(now) - t.formatLookbackDays
  const win = reels.filter((r) => r.pillar !== null && dayNumber(r.createdOn) >= from)
  if (win.length === 0 || Object.keys(t.pillarMix).length === 0) return notMeasured('D5', label, threshold, '工单没有标内容柱')
  const counts = countBy(win, (r) => r.pillar)
  let worst = 0
  for (const [pillar, target] of Object.entries(t.pillarMix)) worst = Math.max(worst, Math.abs(((counts.get(pillar) ?? 0) / win.length) * 100 - target))
  return { key: 'D5', label, status: worst > t.maxPillarDriftPoints ? 'over' : 'ok', value: `最偏的一柱差 ${Math.round(worst)} 个百分点`, threshold }
}

function d6(recent: readonly AuditReel[], t: AuditThresholds): MetricResult {
  const label = '视觉单一'
  const threshold = `最近 ${t.recentWindow} 条里同一套（模板 + 品牌色 + 镜头数）≤ ${pct(t.maxVisualSignatureShare)}`
  const known = recent.filter((r) => r.template !== null && r.scenes !== null)
  if (known.length === 0) return notMeasured('D6', label, threshold, '读不到镜头数或品牌色')
  const [sig, n] = top(countBy(known, (r) => `${r.template}|${r.brandColor ?? '?'}|${r.scenes}`)) ?? ['', 0]
  const share = n / known.length
  return { key: 'D6', label, status: share > t.maxVisualSignatureShare ? 'over' : 'ok', value: `${sig} 占 ${pct(share)}`, threshold }
}

function findingsFor(metrics: readonly MetricResult[], missingForms: readonly string[]): Finding[] {
  const out: Finding[] = []
  for (const m of metrics) {
    if (m.status === 'over' && ['D1', 'D2', 'D3', 'D6'].includes(m.key)) {
      out.push({ key: m.key, tier: 'A', what: `${m.label}超线：${m.value}`, how: '排期时把重复的往后排或这次不排（只调还没批的片）。' })
    }
    if (m.key === 'D4' && m.status === 'over') {
      for (const form of missingForms) {
        const canMake = FORMS_FACTORY_CAN_MAKE.has(form)
        out.push({
          key: 'D4', tier: canMake ? 'B' : 'C',
          what: `账号缺「${form}」这一类内容`,
          how: canMake ? '按工厂现有模板给这一类下一张单。' : '工厂还没有这一类的模板，或需要客户提供素材：开发卡 / 客户侧任务。',
        })
      }
    }
    if (m.status === 'not_measured') {
      out.push({ key: m.key, tier: 'C', what: `${m.label}量不出来：${m.value}`, how: '补上工单里缺的字段（形式 / 内容柱 / 模板），否则这一项永远看不见。' })
    }
  }
  return out
}

export interface AuditResult {
  asOf: string
  reelCount: number
  metrics: MetricResult[]
  findings: Finding[]
}

export function auditAccount(reels: readonly AuditReel[], asOf: string, t: AuditThresholds = TRAVEL_THRESHOLDS): AuditResult {
  const sorted = newestFirst(reels)
  const recent = sorted.slice(0, t.recentWindow)
  const four = d4(sorted, asOf, t)
  const metrics = [d1(recent, t), d2(sorted, asOf, t), d3(sorted, t), four.metric, d5(sorted, asOf, t), d6(recent, t)]
  return { asOf, reelCount: sorted.length, metrics, findings: findingsFor(metrics, four.missing) }
}
