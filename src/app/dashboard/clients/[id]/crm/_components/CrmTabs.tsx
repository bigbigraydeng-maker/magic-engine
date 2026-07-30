'use client'

/**
 * CRM 两页之间的切换标签，两页共用。
 *   今天要联系 = 系统排好的、今天该打谁（手机端行动队列）
 *   全部客人   = 翻看所有人 / 查某个客人的来往记录（桌面横表）
 * 板桥定：说「客人」不说「联系人」；两个标签让同事不迷路「查人到底点哪个」。
 */

import Link from 'next/link'

export function CrmTabs({ clientId, active }: { clientId: string; active: 'today' | 'all' }) {
  const base = `/dashboard/clients/${clientId}/crm`
  const cls = (on: boolean) =>
    `rounded-md px-4 py-1.5 text-sm font-bold transition ${
      on ? 'bg-me-charcoal text-white' : 'text-me-charcoal/60 hover:text-me-charcoal'
    }`
  return (
    <div className="inline-flex rounded-lg border border-me-charcoal/15 p-0.5">
      <Link href={base} className={cls(active === 'today')}>今天要联系</Link>
      <Link href={`${base}/all`} className={cls(active === 'all')}>全部客人</Link>
    </div>
  )
}
