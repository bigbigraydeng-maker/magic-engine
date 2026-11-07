'use client'

/**
 * 成绩单区块 = 「在投预算 vs 客户总上限」一行 + 成绩单（只给内部员工，调用方已判断）。
 * 预算合计来自「今日实时」官方账户读数（60 秒缓存），页面上写明读取时间；「哪些组已停」见 use-budget-facts。
 */

import React from 'react'
import type { AdsScorecard } from '@/lib/ads-strategy/portfolio/scorecard'
import type { BudgetHeadroom } from '@/lib/ads-strategy/heartbeat/budget-headroom'
import ScorecardPanel from './scorecard-panel'
import { useBudgetFacts } from './use-budget-facts'

const fmtNzTime = (iso: string) =>
  new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Pacific/Auckland', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso))

const money = (code: string | null, n: number) => `${code ?? ''} ${n.toFixed(2)}`.trim()

export interface HeadroomText {
  tone: 'neutral' | 'amber' | 'red'
  lines: string[]
}

/** 纯文案：把预算合计写成人话。读不到总上限 / 币种不一致时不下结论。 */
export function headroomText(h: BudgetHeadroom, readAtIso: string | null): HeadroomText {
  const when = readAtIso ? `读取时间 ${fmtNzTime(readAtIso)}（直接读 Meta，60 秒缓存）` : '没有读取时间，数字可能不是最新'
  if (h.state === 'unavailable') {
    return { tone: 'amber', lines: ['在投的组用的币种不一样，预算合计算不了', when] }
  }
  const total = money(h.currency, h.totalDaily)
  const lines: string[] = []
  let tone: HeadroomText['tone'] = 'neutral'
  if (h.cap === null || h.headroom === null) {
    lines.push(`在投每天预算合计 ${total}（这个客户还没设总上限）`)
  } else if (h.level === 'over') {
    tone = 'red'
    lines.push(`在投每天预算合计 ${total}，已经超过客户总上限 ${money(h.currency, h.cap)}`)
  } else {
    lines.push(`在投每天预算合计 ${total} · 客户每天总上限 ${money(h.currency, h.cap)} · 还剩 ${money(h.currency, h.headroom)}`)
    if (h.level === 'full') {
      tone = 'amber'
      lines.push('已经顶到上限：再加预算会被系统拦下')
    } else if (h.level === 'tight') {
      tone = 'amber'
      lines.push('快到上限了：加预算前先看还剩多少')
    }
  }
  if (h.unreadableCount > 0) lines.push(`另有 ${h.unreadableCount} 个在投的组读不到日预算（比如预算设在系列层），没算进合计`)
  if (h.unreadableAccounts > 0) lines.push(`有 ${h.unreadableAccounts} 个广告账户这次没读到，合计只会更多、不会更少`)
  lines.push(when)
  return { tone, lines }
}

const TONE_CLASS: Record<HeadroomText['tone'], { box: string; sub: string }> = {
  neutral: { box: 'border-gray-200 bg-white text-gray-800', sub: 'text-gray-600' },
  amber: { box: 'border-amber-200 bg-amber-50 text-amber-900', sub: 'text-amber-800' },
  red: { box: 'border-red-200 bg-red-50 text-red-900', sub: 'text-red-800' },
}

export default function ScorecardSection({ scorecard, clientId }: { scorecard: AdsScorecard | { error: string } | undefined; clientId: string }) {
  const facts = useBudgetFacts(clientId)
  const text = facts.headroom ? headroomText(facts.headroom, facts.readAtIso) : null
  return (
    <>
      {text && (
        <div className={`mb-4 rounded-xl border px-4 py-3 text-sm ${TONE_CLASS[text.tone].box}`} data-testid="budget-headroom">
          <p className="font-medium">{text.lines[0]}</p>
          {text.lines.slice(1).map((line, i) => (
            <p key={i} className={`mt-0.5 text-xs ${TONE_CLASS[text.tone].sub}`}>{line}</p>
          ))}
        </div>
      )}
      <ScorecardPanel scorecard={scorecard} clientId={clientId} stoppedUnitIds={facts.stoppedIds ?? undefined} />
    </>
  )
}
