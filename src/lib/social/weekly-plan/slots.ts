/**
 * Turn a resolved mix and three weekly counts into ordered slots.
 * Counts are integers. The mix is percent and is scaled if it does not sum to 100.
 */

import type { CountSource, PlanFormat, WeeklyPlanSlot } from './types'

const GROUP_LABELS: Readonly<Record<string, string>> = {
  travel_mood: '旅行氛围',
  practical_info: '实用信息',
  guest_stories: '客人故事',
  tour_intro: '线路介绍',
  expertise_history: '专业和历史',
  how_to_ship: '怎么寄',
  packaging_prohibited_damage: '包装、禁运和破损',
  warehouse_loading_arrival: '仓库、装货和到达',
  route_service_scenes: '线路和服务现场',
  other: '其他',
}

const FORMAT_LABEL: Readonly<Record<PlanFormat, string>> = {
  reel: 'Reel',
  post: '图文',
  story: 'Story',
}

const SOURCE_LABEL: Readonly<Record<CountSource, string>> = {
  client_week: '条数用的是客户填的每周数量',
  client_quota: '条数用的是客户填的发布名额',
  industry: '条数用的是行业模板，客户没填',
  stage: '条数用的是起步阶段的默认量，客户没填',
  none: '条数没有来源',
}

export function groupLabel(key: string | null, names: Readonly<Record<string, string>>): string {
  if (key === null) return '未分组'
  return names[key] ?? GROUP_LABELS[key] ?? key
}

export function emphasiseExplain(mix: Record<string, number>, key: string | null): Record<string, number> {
  if (key === null || !Object.prototype.hasOwnProperty.call(mix, key)) return mix
  const donor = Object.keys(mix).filter((name) => name !== key).sort((a, b) => mix[b] - mix[a] || a.localeCompare(b))[0]
  if (!donor) return mix
  const move = Math.min(10, mix[donor])
  return { ...mix, [donor]: mix[donor] - move, [key]: mix[key] + move }
}

export function spreadGroups(total: number, mix: Record<string, number> | null): Array<string | null> {
  if (total === 0) return []
  if (mix === null) return Array.from({ length: total }, () => null)
  const usable = Object.entries(mix).filter(([, value]) => value > 0)
  const sum = usable.reduce((acc, [, value]) => acc + value, 0)
  if (sum <= 0) return Array.from({ length: total }, () => null)
  const rows = usable.map(([key, value]) => {
    const exact = (total * value) / sum
    return { key, n: Math.floor(exact), frac: exact - Math.floor(exact) }
  })
  let left = total - rows.reduce((acc, row) => acc + row.n, 0)
  const byFrac = [...rows].sort((a, b) => b.frac - a.frac || a.key.localeCompare(b.key))
  for (const row of byFrac) {
    if (left <= 0) break
    row.n += 1
    left -= 1
  }
  return takeSpread(rows)
}

function takeSpread(rows: Array<{ key: string; n: number }>): string[] {
  const left = rows.map((row) => ({ key: row.key, n: row.n }))
  const out: string[] = []
  const total = left.reduce((acc, row) => acc + row.n, 0)
  while (out.length < total) {
    left.sort((a, b) => b.n - a.n || a.key.localeCompare(b.key))
    const next = left.find((row) => row.n > 0)
    if (!next) break
    out.push(next.key)
    next.n -= 1
  }
  return out
}

export function buildSlots(input: {
  counts: { reel: number; post: number; story: number }
  sources: { reel: CountSource; post: CountSource; story: CountSource }
  groups: ReadonlyArray<string | null>
  names: Readonly<Record<string, string>>
  themes: ReadonlyArray<{ id: string; label: string }>
  themeRead: 'ok' | 'none' | 'unreadable'
}): WeeklyPlanSlot[] {
  const formats = expandFormats(input.counts)
  return formats.map((format, index) => slotAt(input, format, input.groups[index] ?? null, index))
}

function expandFormats(counts: { reel: number; post: number; story: number }): PlanFormat[] {
  return [
    ...Array.from({ length: counts.reel }, () => 'reel' as const),
    ...Array.from({ length: counts.post }, () => 'post' as const),
    ...Array.from({ length: counts.story }, () => 'story' as const),
  ]
}

function slotAt(
  input: Parameters<typeof buildSlots>[0],
  format: PlanFormat,
  group: string | null,
  index: number,
): WeeklyPlanSlot {
  const theme = input.themes.length > 0 ? input.themes[index % input.themes.length] : null
  return {
    index: index + 1,
    format,
    contentGroup: group,
    contentGroupLabel: groupLabel(group, input.names),
    theme: theme?.label ?? null,
    themeId: theme?.id ?? null,
    reason: slotReason(format, groupLabel(group, input.names), input.sources[format], theme?.label ?? null, input.themeRead),
  }
}

function slotReason(
  format: PlanFormat,
  group: string,
  source: CountSource,
  theme: string | null,
  themeRead: 'ok' | 'none' | 'unreadable',
): string {
  const themeLine = themeLineOf(theme, themeRead)
  const story = format === 'story' ? 'Story 不卖货，只作提醒。' : ''
  return `${FORMAT_LABEL[format]}，内容组「${group}」。${SOURCE_LABEL[source]}。${themeLine}${story}`
}

function themeLineOf(theme: string | null, themeRead: 'ok' | 'none' | 'unreadable'): string {
  if (theme) return `主题跟上广告在推的「${theme}」。`
  if (themeRead === 'unreadable') return '广告主题读不到，这条不编主题。'
  return '这周没有广告主题，这条不编主题。'
}
