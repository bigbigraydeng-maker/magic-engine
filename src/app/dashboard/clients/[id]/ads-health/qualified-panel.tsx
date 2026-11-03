'use client'

/**
 * 合格客人面板（只读，只给内部员工）：把巡察算出的「近 30 天带来的客人质量」原样写出来，不取数、不带按钮。
 * 不进预算判断（样本太小）。
 */

import React from 'react'
import type { QualifiedBlock, QualifiedRow } from '@/lib/ads-strategy/portfolio/qualified-leads'

// 组编号尾 6 位：CTS 的组编号尾 4 位全是同一串，分不出来
const tail = (id: string) => '…' + id.slice(-6)

export function qualifiedCell(q: QualifiedRow['qualified']): string {
  if (q.total === 0) return '0'
  const parts: string[] = []
  if (q.human > 0) parts.push(`人 ${q.human}`)
  if (q.system > 0) parts.push(`系统 ${q.system}`)
  if (q.ai > 0) parts.push(`AI ${q.ai}`)
  if (q.unknown > 0) parts.push(`来源认不出 ${q.unknown}`)
  return `${q.total}（${parts.join(' · ')}）`
}

export default function QualifiedPanel({ block }: { block: QualifiedBlock | { error: string } | undefined }) {
  if (block === undefined) return null

  if ('error' in block) {
    return (
      <section className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-800">近 30 天带来的客人质量</h3>
        <p className="text-sm text-red-700">合格客人这一块今天没算出来（{block.error}），其余不受影响。</p>
      </section>
    )
  }

  if (!block.configured) {
    return (
      <section className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-800">近 30 天带来的客人质量</h3>
        <p className="text-sm text-gray-500">还没设置哪些客人阶段算「合格」：到客户设置「广告健康监测」里勾。</p>
      </section>
    )
  }

  const { window: win, observeDays, staleStageKeys, rows, unattributedQualified } = block

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
      <h3 className="text-sm font-semibold text-gray-800">近 30 天带来的客人质量</h3>

      <p className="text-xs text-gray-500">
        {win.start} → {win.end} 第一次进 ME 的客人，按第一次是哪个组带来的算（老客人被广告重新带回来的不算在内）· 只给内部员工看 · 不进预算判断
      </p>

      {staleStageKeys.length > 0 && (
        <p className="text-xs text-amber-800 bg-amber-50 rounded px-2 py-1">
          设置里有 {staleStageKeys.length} 个阶段已经不在客户的阶段表里，没算进去。
        </p>
      )}

      {rows.length === 0 ? (
        <p className="text-xs text-gray-500">这 30 天没有能对上广告组的新客人。</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr>
                <th className="text-left text-gray-500 font-normal pr-3 pb-1 whitespace-nowrap">组</th>
                <th className="text-left text-gray-500 font-normal pr-3 pb-1 whitespace-nowrap">带来客人</th>
                <th className="text-left text-gray-500 font-normal pr-3 pb-1 whitespace-nowrap">合格</th>
                <th className="text-left text-gray-500 font-normal pr-3 pb-1 whitespace-nowrap">跟进过没合格</th>
                <th className="text-left text-gray-500 font-normal pr-3 pb-1 whitespace-nowrap">ME 里没跟进记录</th>
                <th className="text-left text-gray-500 font-normal pr-3 pb-1 whitespace-nowrap">观察中</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={`${row.level}-${row.id}`}>
                  <td className="pr-3 py-1 align-top text-gray-700 min-w-[8rem]">
                    <span>{row.name ?? `未命名组 ${tail(row.id)}`}{row.level === 'campaign' ? '（整个系列分钱）' : ''}</span>
                    {row.stoppedLast7d === true && <span className="block text-gray-500">近 7 天已停投</span>}
                    {row.stoppedLast7d === null && <span className="block text-gray-500">不在今天的广告快照里，投放状态不明</span>}
                  </td>
                  <td className="pr-3 py-1 align-top text-gray-700 whitespace-nowrap">{row.leads}</td>
                  <td className="pr-3 py-1 align-top text-gray-700 whitespace-nowrap">{qualifiedCell(row.qualified)}</td>
                  <td className="pr-3 py-1 align-top text-gray-700 whitespace-nowrap">{row.followedNotQualified}</td>
                  <td className="pr-3 py-1 align-top text-gray-700 whitespace-nowrap">{row.noFollowup}</td>
                  <td className="pr-3 py-1 align-top text-gray-700 whitespace-nowrap">{row.observing}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {unattributedQualified > 0 && (
        <p className="text-xs text-gray-500">
          另有 {unattributedQualified} 个合格客人不是由广告组带来的（官网、邮件、WhatsApp 等，或来源没记下），不在表里。
        </p>
      )}

      <p className="text-xs text-gray-500">
        「ME 里没跟进记录」「观察中」只数还没合格的客人；跟进只认 ME 里记下的、联系上了的电话，一对一邮件、WhatsApp，和员工改的阶段；没接通、空号不算；在 ME 外面打的电话、发的消息看不到。观察中 = 第一次跟进还不满 {observeDays} 天。这一块只看个数，不排名，不进「钱花多了 / 该多给钱」的判断。AI 判得准不准：待上线。
      </p>
    </section>
  )
}
