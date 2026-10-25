'use client'

/**
 * 「CRM 管理」内部导航 —— 页面切换 + 相关工具的入口，crm/* 页面共用。
 *
 *   全部客人   = 翻看所有人 / 查某个客人的来往记录（桌面横表，点行开抽屉）
 *   决策清单   = 只读版的优先级视图（CI-WP01 / Issue #1009）——只看是谁 / 为什么 /
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
 * 2026-09-28（WP-B6）：「今天要联系」这一项去掉了——它的独有功能（私信/邮件/
 * WhatsApp 回复、一键动作、同行批量发送、分段「今天进度」）B2/B3/B5 已经全部搬进
 * 「全部客人」，页面本身也删了（改成跳转 /crm/all，见 crm/page.tsx）。
 *
 * 同行渠道 / 我的客人两项按行业开关显示 —— 复用 industryFeatureFlags，跟首页
 * 「工具」页签的判据是同一份，不会出现两处标准不一致。
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { industryFeatureFlags } from '@/lib/clients/industry-features'
import { NewMessagesBanner } from './NewMessagesBanner'

const PROBE_TTL_MS = 5 * 60 * 1000
const probeCache = new Map<string, { ok: boolean; at: number }>()

/** The cached probe answer for this client, or null when there is none or it is older than 5 minutes. */
function readProbeCache(clientId: string): boolean | null {
  const hit = probeCache.get(clientId)
  if (hit === undefined || Date.now() - hit.at > PROBE_TTL_MS) return null
  return hit.ok
}

/** Test hook: forget every cached probe answer. */
export function resetPaymentsProbeCache(): void {
  probeCache.clear()
}

export function CrmTabs({ clientId, active }: { clientId: string; active: 'all' | 'decisions' | 'payments' | 'sales' }) {
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

  // 「付款总览」页签：只有探针返回 200 才显示；403/404/出错/还没回来一律不显示（不暴露这个功能存在）。
  // 结果按客户缓存 5 分钟（出错不缓存），所以在 CRM 各页之间切换时页签不会消失再弹出来。
  const [showPayments, setShowPayments] = useState(() => readProbeCache(clientId) === true)
  useEffect(() => {
    const cached = readProbeCache(clientId)
    setShowPayments(cached === true)
    if (cached !== null) return
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/crm/bookings/access`)
        if (res.status === 200 || res.status === 403 || res.status === 404) {
          probeCache.set(clientId, { ok: res.status === 200, at: Date.now() })
        }
        if (!cancelled) setShowPayments(res.status === 200)
      } catch {
        // 网络出错：不显示，也不缓存（下次再试）
      }
    })()
    return () => {
      cancelled = true
    }
  }, [clientId])

  return (
    <>
      {/* 新消息提醒：页面不会自己刷新，隔 30 秒问一次有没有客人发来新消息（读失败什么都不做）。 */}
      <NewMessagesBanner clientId={clientId} />
    <div className="flex flex-wrap items-center gap-3">
      <div className="inline-flex rounded-lg border border-me-charcoal/15 p-0.5">
        <Link href={`${base}/all`} title="这个客户的所有客人：翻看、搜人、改他到哪一步。点右边「✨ Magic Engine 智能」能看今天该先联系谁。" className={cls(active === 'all')}>全部客人</Link>
        {showPayments && (
          <Link href={`${base}/payments`} title="按出发日期看每个团收了多少定金尾款、谁还没收齐、哪些已过期。" className={cls(active === 'payments')}>付款总览</Link>
        )}
        {/* 销售进度页和付款总览走同一道名单闸，同一个探针：能看付款总览的人才看得到它。 */}
        {showPayments && (
          <Link href={`/dashboard/clients/${clientId}/sales-progress`} title="每个团卖了多少、还差多少人成行。" className={cls(active === 'sales')}>销售进度</Link>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-me-charcoal/45">
        <span>相关工具：</span>
        <Link
          href={`/dashboard/clients/${clientId}/messenger`}
          title="Facebook / WhatsApp 的对话列表，可以在这里直接回客人。"
          className="hover:text-me-charcoal hover:underline"
        >
          客户消息
        </Link>
        <Link
          href={`/dashboard/clients/${clientId}/business-inbox`}
          title="已连接邮箱里同步进来的邮件清单（每小时一次）。只能看，回信仍然去邮箱里回。"
          className="hover:text-me-charcoal hover:underline"
        >
          商务收件箱
        </Link>
        {flags.agents && (
          <Link
            href={`/dashboard/clients/${clientId}/agents`}
            title="送客给我们的旅行社同行，以及他们各自手上的客人进展。"
            className="hover:text-me-charcoal hover:underline"
          >
            🤝 同行渠道
          </Link>
        )}
        {/*
          「我的客人」入口 2026-10-26 去掉：那一页是给「按房子跟客人的中介」做的，
          对不按房子经营的客户（例如 CTS）点进去只会看到一句「用它反而绕远」+
          一个跳回「全部客人」的按钮，而这句话要等 3 秒（实测 /crm/contacts 接口 3046ms）
          才显示出来。页面本身留着，按房子经营的客户仍能用网址进；只是不再摆在这里误导人。
        */}
      </div>
    </div>
    </>
  )
}
