'use client'

/**
 * 成绩单面板（只读，只给内部员工）：把每天巡察算出的 scorecard 原样写出来，不取数、不带按钮。
 * 规则手册 v1.1 E-19 / E-20；修复方案第 1 刀 ②。客户版接口不含这一栏（growth-client-view 白名单）。
 */

import React from 'react'
import type { AdsScorecard, BudgetVerdict, ScorecardUnit } from '@/lib/ads-strategy/portfolio/scorecard'
import type { FunnelRole } from '@/lib/ads-strategy/portfolio/roles'
import { OUTCOME_STEP_LABEL } from '@/lib/ads-strategy/portfolio/outcome-ladder'

const ROLE_LABEL: Record<FunnelRole, string> = {
  awareness: '认知',
  acquisition: '获客',
  retargeting: '再营销',
  expansion: '扩量',
  mixed: '角色混合',
  unknown: '角色未知',
}

const money = (n: number) => `$${n.toFixed(2)}`
const pct = (x: number) => `${Math.round(x * 100)}%`
const tail = (id: string) => '…' + id.slice(-4)

export function unitNote(u: ScorecardUnit): string {
  switch (u.separate) {
    case null:
      return ''
    case 'result_type_differs':
      return '结果种类跟客户主结果不一样，单列'
    case 'mixed_result_types':
      return '系列下各组结果种类混着，按主结果数'
    case 'result_type_unknown':
      return '判不出结果种类（比如网站转化），按主结果数'
    case 'experiment':
      return '对照测试中，不进预算比较'
    case 'not_result_unit':
      return u.role === 'mixed' || u.role === 'unknown'
        ? '说不清这个组是拉新还是再营销，没进预算比较'
        : '不出结果（比如视频播放），不进预算比较'
  }
}

export function budgetLines(v: BudgetVerdict, nameOf: (id: string) => string): string[] {
  const names = (ids: string[]) => ids.map(nameOf).join('、')
  const lines: string[] = []

  switch (v.state) {
    case 'no_mismatch':
      lines.push(`钱分得跟结果对得上（各组最大差距 ${pct(v.maxGap ?? 0)}，超过 ${pct(v.threshold)} 才算错配）`)
      break
    case 'mismatch':
      lines.push('钱跟结果对不上')
      if (v.under.length > 0) lines.push(`花得多、结果少：${names(v.under)}`)
      if (v.over.length > 0) lines.push(`结果多、钱给少了：${names(v.over)}`)
      if (v.overHeld.length > 0) lines.push(`结果多，但今天数据不全，先不判加钱：${names(v.overHeld)}`)
      break
    case 'insufficient':
      lines.push('样本还不够，判不了')
      for (const t of v.thin) lines.push(`${nameOf(t.id)} 还差 ${t.need} 个`)
      break
    case 'not_comparable':
      if (v.reason === 'single_unit') lines.push('只有一个组在花钱，没得比')
      else if (v.reason === 'outcome_not_configured') lines.push('还没设置「广告结果怎么算」，判不了')
      else if (v.reason === 'primary_not_attributable') lines.push('有组的结果归不到具体哪个组，判不了')
      else lines.push('判不了')
      break
  }

  // 样本不够的组没进比较；「对得上 / 对不上」时也要写出来，免得被当成「都看过了」
  if ((v.state === 'no_mismatch' || v.state === 'mismatch') && v.thin.length > 0) {
    lines.push(`样本还不够、没进这次比较：${v.thin.map(t => `${nameOf(t.id)} 还差 ${t.need} 个`).join('、')}`)
  }

  if (v.notLikeForLike.length > 0) {
    lines.push(`注意：${names(v.notLikeForLike)} 结果种类跟主结果不一样，系统仍按主结果拿它比，这条结论只作参考`)
  }

  return lines
}

function vsTargetText(u: ScorecardUnit): string {
  switch (u.vsTarget) {
    case 'at_or_below':
      return `不高于目标 ${money(u.targetCost ?? 0)}`
    case 'above':
      return u.targetCost !== null ? `高于目标 ${money(u.targetCost)}` : '高于目标'
    case 'no_target':
      return '不跟目标比'
    case null:
      return '—'
  }
}

function resultsText(u: ScorecardUnit): string {
  if (u.results === null) return '未知'
  if (u.resultType !== null) return `${u.results} 个${OUTCOME_STEP_LABEL[u.resultType]}`
  return `${u.results} 个（按主结果数）`
}

function sampleText(u: ScorecardUnit): string {
  if (u.sampleGap === null) return '未知'
  if (u.sampleGap === 0) return '够了'
  return `还差 ${u.sampleGap} 个`
}

export default function ScorecardPanel({ scorecard }: { scorecard: AdsScorecard | { error: string } | undefined }) {
  if (scorecard === undefined) {
    return (
      <section className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-800">每个组这 7 天的成绩</h3>
        <p className="text-sm text-gray-500">今天还没有成绩单：每天的广告巡察跑过一次才会出现。</p>
      </section>
    )
  }

  if ('error' in scorecard) {
    return (
      <section className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-800">每个组这 7 天的成绩</h3>
        <p className="text-sm text-red-700">成绩单今天没算出来（{scorecard.error}），页面其余判断不受影响。</p>
      </section>
    )
  }

  const { window: win, completeness, units, budget, accountsSkipped } = scorecard
  const multiAccount = new Set(budget.map(v => v.adAccountId)).size > 1
  const sortedUnits = [...units].sort((a, b) => b.spend - a.spend)

  const nameOfFor = (adAccountId: string) => (id: string) => {
    const u = units.find(x => x.id === id && x.adAccountId === adAccountId)
    return u?.name ?? id
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
      <h3 className="text-sm font-semibold text-gray-800">每个组这 7 天的成绩</h3>

      <p className="text-xs text-gray-500">
        {win.start} → {win.end} · 每个组按它自己那种结果数 · 只读，不会自动改预算
      </p>

      {completeness === 'partial' && (
        <p className="text-xs text-amber-800 bg-amber-50 rounded px-2 py-1">
          今天广告数据没拉全：只写哪里钱花多了，「该多给钱」今天先不判。
        </p>
      )}

      {accountsSkipped.map(s => (
        <p key={s.adAccountId} className="text-xs text-gray-500">
          账户 {tail(s.adAccountId)} 没算：
          {s.reason === 'shared' ? '这个账户登记给了不止一个客户' : '分不清账户里哪些组是这个客户的'}
        </p>
      ))}

      <div className="space-y-2">
        <p className="text-xs font-medium text-gray-600">钱分得对不对</p>
        {budget.length === 0 ? (
          <p className="text-xs text-gray-500">这 7 天没有能比较的组。</p>
        ) : (
          budget.map(v => {
            const lines = budgetLines(v, nameOfFor(v.adAccountId))
            const headline = lines[0] ?? ''
            const rest = lines.slice(1)
            const accountSuffix = multiAccount ? ` · 账户 ${tail(v.adAccountId)}` : ''
            return (
              <div
                key={`${v.adAccountId}-${v.role}`}
                className={`rounded-lg bg-gray-50 px-3 py-2${v.state === 'mismatch' ? ' border-l-4 border-amber-400' : ''}`}
              >
                <p className="text-sm text-gray-800">
                  {ROLE_LABEL[v.role]}{accountSuffix}：{headline}
                </p>
                {rest.map((line, i) => (
                  <p key={i} className="text-xs text-gray-600">{line}</p>
                ))}
              </div>
            )
          })
        )}
      </div>

      {units.length === 0 ? (
        <p className="text-xs text-gray-500">这 7 天没有花钱的组。</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr>
                <th className="text-left text-gray-500 font-normal pr-3 pb-1 whitespace-nowrap">组</th>
                <th className="text-left text-gray-500 font-normal pr-3 pb-1 whitespace-nowrap">花费</th>
                <th className="text-left text-gray-500 font-normal pr-3 pb-1 whitespace-nowrap">结果</th>
                <th className="text-left text-gray-500 font-normal pr-3 pb-1 whitespace-nowrap">单个成本</th>
                <th className="text-left text-gray-500 font-normal pr-3 pb-1 whitespace-nowrap">跟目标比</th>
                <th className="text-left text-gray-500 font-normal pr-3 pb-1 whitespace-nowrap">样本</th>
              </tr>
            </thead>
            <tbody>
              {sortedUnits.map(u => (
                <tr key={`${u.adAccountId}-${u.level}-${u.id}`}>
                  <td className="pr-3 py-1 align-top text-gray-700 min-w-[8rem]">
                    <span>{u.name ?? u.id}{u.level === 'campaign' ? ' （整个系列分钱）' : ''}</span>
                    {u.separate !== null && <span className="block text-gray-500">{unitNote(u)}</span>}
                  </td>
                  <td className="pr-3 py-1 align-top text-gray-700 whitespace-nowrap">{money(u.spend)}</td>
                  <td className="pr-3 py-1 align-top text-gray-700 whitespace-nowrap">{resultsText(u)}</td>
                  <td className="pr-3 py-1 align-top text-gray-700 whitespace-nowrap">{u.costPerResult === null ? '—' : money(u.costPerResult)}</td>
                  <td className="pr-3 py-1 align-top text-gray-700 whitespace-nowrap">{vsTargetText(u)}</td>
                  <td className="pr-3 py-1 align-top text-gray-700 whitespace-nowrap">{sampleText(u)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-gray-500">
        预算判断跟系统每天的「钱花多了 / 该多给钱」两条规则用的是同一套算法，这里只是把它写出来。
      </p>
    </section>
  )
}
