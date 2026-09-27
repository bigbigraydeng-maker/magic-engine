'use client'

/**
 * 「CRM 管理」内部导航 —— 三页切换 + 相关工具的入口，crm/* 三页共用。
 *
 *   今天要联系 = 系统排好的、今天该打谁（手机端行动队列，能记笔记 / 打电话 / 发私信）
 *   全部客人   = 翻看所有人 / 查某个客人的来往记录（桌面横表）
 *   决策清单   = 只读版「今天要联系」（CI-WP01 / Issue #1009）——只看是谁 / 为什么 /
 *                建议怎么办，没有任何能点的写操作，给不需要亲自动手的人看
 * 板桥定：说「客人」不说「联系人」；标签让同事不迷路「查人到底点哪个」。
 *
 * 2026-09-28（CRM 重整 B1）：首页原来散着 6 张卡片（今天该联系谁 / 全部客人 /
 * 客户消息 / 商务收件箱 / 同行渠道 / 我的客人），PM 要求收成 1 张「CRM 管理」——
 * 这个组件因此多担一份职责：进来之后要能摸到原来那 6 个目的地，不能少一个。
 * 「客户消息」「商务收件箱」「同行渠道」「我的客人」不在 crm/* 路由下，点过去就
 * 离开了这一组标签（那几页目前没有挂这份导航），所以视觉上跟前三个主标签分开一段、
 * 弱化一级，标明「相关工具」，不是同一层级的页面切换。
 *
 * 🔴「今天要联系」暂时留着（魏征 2026-09-28 复审点名）：这一页文件头注写着
 * 「销售在外面用这一页」，是真实在用的工具。它的独有功能（私信/邮件回复、
 * 同行批量发送、今天进度）还没搬进「全部客人」，这时候拿掉入口 = 功能凭空消失
 * 只能靠背网址。等 B6（那些功能全部搬完、页面本身删除）时才把这一项去掉。
 *
 * 同行渠道 / 我的客人两项按行业开关显示 —— 复用 industryFeatureFlags，跟首页
 * 「工具」页签的判据是同一份，不会出现两处标准不一致。
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { industryFeatureFlags } from '@/lib/clients/industry-features'

export function CrmTabs({ clientId, active }: { clientId: string; active: 'today' | 'all' | 'decisions' }) {
  const base = `/dashboard/clients/${clientId}/crm`
  const cls = (on: boolean) =>
    `rounded-md px-4 py-1.5 text-sm font-bold transition ${
      on ? 'bg-me-charcoal text-white' : 'text-me-charcoal/60 hover:text-me-charcoal'
    }`

  const [industry, setIndustry] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}`)
        if (!res.ok) return
        const json = (await res.json()) as { client?: { industry?: string | null } }
        if (!cancelled) setIndustry(json.client?.industry ?? null)
      } catch {
        // 拿不到就不显示条件项 —— 默认隐藏，不默认显示（跟 industry-features 的既有约定一致）。
      }
    })()
    return () => {
      cancelled = true
    }
  }, [clientId])
  const flags = industryFeatureFlags(industry)

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="inline-flex rounded-lg border border-me-charcoal/15 p-0.5">
        <Link href={base} className={cls(active === 'today')}>今天要联系</Link>
        <Link href={`${base}/all`} className={cls(active === 'all')}>全部客人</Link>
        <Link href={`${base}/decisions`} className={cls(active === 'decisions')}>决策清单（只读）</Link>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-me-charcoal/45">
        <span>相关工具：</span>
        <Link href={`/dashboard/clients/${clientId}/messenger`} className="hover:text-me-charcoal hover:underline">
          客户消息
        </Link>
        <Link href={`/dashboard/clients/${clientId}/business-inbox`} className="hover:text-me-charcoal hover:underline">
          商务收件箱
        </Link>
        {flags.agents && (
          <Link href={`/dashboard/clients/${clientId}/agents`} className="hover:text-me-charcoal hover:underline">
            🤝 同行渠道
          </Link>
        )}
        {flags.listings && (
          <Link href={`/dashboard/clients/${clientId}/contacts`} className="hover:text-me-charcoal hover:underline">
            我的客人
          </Link>
        )}
      </div>
    </div>
  )
}
