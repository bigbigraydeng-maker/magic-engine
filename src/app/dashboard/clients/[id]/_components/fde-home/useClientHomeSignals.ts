'use client'

import { useCallback, useEffect, useState } from 'react'
import type { StatusTone } from '@/components/ui/me-theme'
import {
  ClientHomeSignals,
  TodayAction,
  executionProgressTone,
  summarizeLiveSpend,
  toneForAdVerdict,
} from './client-home-signals'

interface CardRow {
  status?: string
  what?: string
}

function fmtMoney(n: number | null, currency = 'NZD'): string {
  if (n == null) return '—'
  return `$${n.toFixed(0)} ${currency}`
}

export function useClientHomeSignals(clientId: string, showAdApproval: boolean): ClientHomeSignals {
  const [state, setState] = useState<ClientHomeSignals>({
    loading: true,
    headline: '正在读取客户状态…',
    updatedAt: null,
    cards: [],
    todayActions: [],
  })

  const load = useCallback(async () => {
    setState(s => ({ ...s, loading: true }))
    try {
      const [
        healthRes,
        liveRes,
        planRes,
        benchRes,
        execRes,
        cardsRes,
        dailyRes,
      ] = await Promise.all([
        fetch(`/api/clients/${clientId}/ad-health`, { cache: 'no-store' }).catch(() => null),
        fetch(`/api/clients/${clientId}/ad-health/live`, { cache: 'no-store' }).catch(() => null),
        fetch(`/api/clients/${clientId}/marketing-plan`, { cache: 'no-store' }).catch(() => null),
        fetch(`/api/clients/${clientId}/workbench-summary`, { cache: 'no-store' }).catch(() => null),
        fetch(`/api/clients/${clientId}/execution`, { cache: 'no-store' }).catch(() => null),
        fetch(`/api/clients/${clientId}/confirmation-cards`, { cache: 'no-store' }).catch(() => null),
        fetch(`/api/clients/${clientId}/zhuge/daily-recommendation`, { cache: 'no-store' }).catch(() => null),
      ])

      const cards: ClientHomeSignals['cards'] = []
      const todayActions: TodayAction[] = []
      let headline = '整体在跟，先看今天要你做的几件事。'
      let updatedAt: string | null = null

      if (healthRes?.ok) {
        const h = await healthRes.json() as {
          latest?: { headline?: string; overall_verdict?: string; insight_date?: string } | null
        }
        if (h.latest?.headline) headline = h.latest.headline
        if (h.latest?.insight_date) {
          updatedAt = new Date(h.latest.insight_date).toLocaleString('zh-CN', { timeZone: 'Pacific/Auckland' })
        }
        let spendLine = h.latest?.headline ?? '打开广告健康看详情'
        let adsTone: StatusTone = toneForAdVerdict(h.latest?.overall_verdict)
        if (liveRes?.ok) {
          const live = await liveRes.json() as { view?: { accounts?: Parameters<typeof summarizeLiveSpend>[0]; readAtIso?: string } }
          if (live.view?.readAtIso) {
            updatedAt = new Date(live.view.readAtIso).toLocaleString('zh-CN', { timeZone: 'Pacific/Auckland' })
          }
          const sums = summarizeLiveSpend(live.view?.accounts ?? [])
          if (sums.spend != null && sums.budget != null) {
            spendLine = `今天 ${fmtMoney(sums.spend)} / 日预算约 ${fmtMoney(sums.budget)}`
          } else if (sums.spend != null) {
            spendLine = `今天已花 ${fmtMoney(sums.spend)}`
          }
          if (h.latest?.overall_verdict === 'alert') adsTone = 'rej'
        }
        cards.push({
          label: '广告',
          value: h.latest?.overall_verdict === 'alert' ? '要处理' : h.latest?.overall_verdict === 'watch' ? '留意' : '在跟',
          sub: spendLine,
          tone: adsTone,
          href: `/dashboard/clients/${clientId}/ads-health`,
          linkLabel: '去广告健康 →',
        })
      }

      if (planRes?.ok) {
        const p = await planRes.json() as {
          plans?: Array<{ title: string; status: string; approved_at?: string | null }>
        }
        const active = (p.plans ?? []).find(pl => pl.status === 'approved' || pl.status === 'active')
          ?? (p.plans ?? []).find(pl => pl.status === 'draft')
        if (active) {
          const stable = active.status === 'approved' || Boolean(active.approved_at)
          cards.push({
            label: '推广计划',
            value: stable ? '稳住' : '要看一眼',
            sub: active.title,
            tone: stable ? 'track' : 'exec',
            href: `/dashboard/clients/${clientId}/promo-plan`,
            linkLabel: '去推广计划 →',
          })
        }
      }

      let done = 0
      let open = 0
      if (execRes?.ok) {
        const e = await execRes.json() as { items?: Array<{ status: string }> }
        const items = e.items ?? []
        done = items.filter(i => i.status === 'completed').length
        open = items.filter(i => i.status === 'pending' || i.status === 'in_progress').length
        const total = done + open
        if (total > 0) {
          cards.push({
            label: '任务',
            value: open === 0 ? '清掉了' : open <= 3 ? '有点卡' : '在推进',
            sub: total > 0 ? `${done} / ${total} 件已完成` : '还没有执行项',
            tone: executionProgressTone(done, open),
            href: `/dashboard/clients/${clientId}/execution`,
            linkLabel: '去任务 →',
          })
        }
      } else if (benchRes?.ok) {
        const b = await benchRes.json() as { summary?: { execution?: { pending?: number; in_progress?: number } } }
        const pending = b.summary?.execution?.pending ?? 0
        const prog = b.summary?.execution?.in_progress ?? 0
        open = pending + prog
        if (open > 0) {
          cards.push({
            label: '任务',
            value: '待跟进',
            sub: `${open} 件还没做完`,
            tone: 'exec',
            href: `/dashboard/clients/${clientId}/execution`,
            linkLabel: '去任务 →',
          })
        }
      }

      let waitingCards = 0
      if (cardsRes?.ok) {
        const c = await cardsRes.json() as { cards?: CardRow[] }
        waitingCards = (c.cards ?? []).filter(row => row.status === 'waiting').length
        if (waitingCards > 0) {
          todayActions.push({
            id: 'confirmation-cards',
            priority: 'high',
            title: `有 ${waitingCards} 张确认卡等你点头`,
            description: '点过确认才会改 Meta 广告或预算；没点之前不会动。',
            href: `/dashboard/clients/${clientId}/confirmation-cards`,
            cta: '去确认卡',
          })
        }
      }

      if (benchRes?.ok) {
        const b = await benchRes.json() as { summary?: { social?: { draft?: number } } }
        const drafts = b.summary?.social?.draft ?? 0
        if (drafts > 0) {
          todayActions.push({
            id: 'social-drafts',
            priority: 'normal',
            title: `审 ${drafts} 条社媒草稿`,
            description: '草稿在每日计划里，合适就批准排期。',
            href: `/dashboard/clients/${clientId}/daily-plan?tab=post`,
            cta: '去审',
          })
        }
      }

      if (dailyRes?.ok) {
        const d = await dailyRes.json() as {
          recommendations?: Array<{ id: string; title: string; description?: string }>
        }
        for (const rec of (d.recommendations ?? []).slice(0, 3)) {
          if (todayActions.length >= 3) break
          if (todayActions.some(a => a.id === rec.id)) continue
          todayActions.push({
            id: rec.id,
            priority: 'normal',
            title: rec.title,
            description: rec.description ?? '在执行看板上点开处理。',
            href: `/dashboard/clients/${clientId}/execution`,
            cta: '去任务',
          })
        }
      }

      if (showAdApproval && waitingCards === 0) {
        // Global ad approval queue — no per-client count API; link only when entry visible.
      }

      if (todayActions.length === 0 && open > 0) {
        todayActions.push({
          id: 'execution-open',
          priority: 'normal',
          title: `推进 ${open} 件未完成任务`,
          description: '执行看板按优先级排好了，先做最上面几条。',
          href: `/dashboard/clients/${clientId}/execution`,
          cta: '打开任务',
        })
      }

      setState({
        loading: false,
        headline,
        updatedAt,
        cards,
        todayActions: todayActions.slice(0, 3),
      })
    } catch {
      setState({
        loading: false,
        headline: '部分信号没读到，请刷新或进侧边栏各功能页查看。',
        updatedAt: null,
        cards: [],
        todayActions: [],
      })
    }
  }, [clientId, showAdApproval])

  useEffect(() => {
    void load()
  }, [load])

  return state
}
