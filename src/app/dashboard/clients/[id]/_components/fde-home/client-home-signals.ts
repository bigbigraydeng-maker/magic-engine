import type { StatusTone } from '@/components/ui/me-theme'

export type TodayActionPriority = 'high' | 'normal'

export interface TodayAction {
  id: string
  priority: TodayActionPriority
  title: string
  description: string
  href: string
  cta: string
}

export interface HomeStatusCard {
  label: string
  value: string
  sub: string
  tone: StatusTone
  href: string
  linkLabel: string
}

export interface ClientHomeSignals {
  loading: boolean
  headline: string
  updatedAt: string | null
  cards: HomeStatusCard[]
  todayActions: TodayAction[]
}

type AdVerdict = 'healthy' | 'watch' | 'alert' | 'insufficient_history' | 'paused'

const VERDICT_TONE: Record<AdVerdict, StatusTone> = {
  alert: 'rej',
  watch: 'exec',
  healthy: 'track',
  insufficient_history: 'attn',
  paused: 'attn',
}

export function toneForAdVerdict(v: string | null | undefined): StatusTone {
  if (!v || !(v in VERDICT_TONE)) return 'attn'
  return VERDICT_TONE[v as AdVerdict]
}

export function summarizeLiveSpend(accounts: Array<{ active?: Array<{ spendToday: number | null; dailyBudget: number | null }> }>): {
  spend: number | null
  budget: number | null
} {
  let spend = 0
  let budget = 0
  let spendKnown = false
  let budgetKnown = false
  for (const acc of accounts) {
    for (const row of acc.active ?? []) {
      if (row.spendToday != null) {
        spend += row.spendToday
        spendKnown = true
      }
      if (row.dailyBudget != null) {
        budget += row.dailyBudget
        budgetKnown = true
      }
    }
  }
  return { spend: spendKnown ? spend : null, budget: budgetKnown ? budget : null }
}

export function executionProgressTone(done: number, open: number): StatusTone {
  if (open === 0) return 'track'
  const ratio = done / Math.max(done + open, 1)
  if (ratio >= 0.55) return 'track'
  if (ratio >= 0.35) return 'exec'
  return 'rej'
}
