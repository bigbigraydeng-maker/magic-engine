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
 *
 * 2026-11-01（CRM 工作区外壳，设计师复审）：页面切换（全部客人 / 付款总览 / 销售进度）
 * 和「邮件模板」搬到了顶部那一条导航（CrmWorkspaceShell，crm/layout.tsx 与
 * sales-progress/layout.tsx 套上），这里不再重复摆。本组件只剩页面顶部那一行安静的
 * 次要链接（我的待跟进 / 客户消息 / 商务收件箱 / 同行渠道）和「新消息提醒」条。
 * `active` 参数保留是为了不动各页面的调用处，现在不再用它。
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { industryFeatureFlags } from '@/lib/clients/industry-features'
import { afterCrmListReady } from '@/lib/crm/list-ready'
import { NewMessagesBanner } from './NewMessagesBanner'

export function CrmTabs({ clientId }: { clientId: string; active?: 'all' | 'decisions' | 'payments' | 'sales' }) {
  const base = `/dashboard/clients/${clientId}/crm`

  const [industry, setIndustry] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    let cancelled = false
    const cancelWait = afterCrmListReady(() => {
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
    })
    return () => {
      cancelled = true
      cancelWait()
    }
  }, [clientId])
  const flags = industryFeatureFlags(industry)

  const linkCls = 'hover:text-me-charcoal hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-me-charcoal/40 rounded'

  return (
    <>
      {/* 新消息提醒：页面不会自己刷新，隔 30 秒问一次有没有客人发来新消息（读失败什么都不做）。 */}
      <NewMessagesBanner clientId={clientId} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-semibold text-me-charcoal/60">
        <span>更多入口：</span>
        {/*
          「我的待跟进」入口（issue #3158 part 3）—— 其实就是「全部客人」页加上
          `?assignee=me` 筛选条，不是新页面：员工最高频的问题是「我今天要跟谁」，
          放个一键捷径省得先打开全部客人再点筛选。走同一道付费客户闸，不另开门。
        */}
        <Link
          href={`${base}/all?assignee=me`}
          title="只看分给我自己的线索。到了那边可以在筛选条里切「未分配 / 其他同事」。"
          className={linkCls}
        >
          我的待跟进
        </Link>
        <Link
          href={`/dashboard/clients/${clientId}/messenger`}
          title="Facebook / WhatsApp 的对话列表，可以在这里直接回客人。"
          className={linkCls}
        >
          客户消息
        </Link>
        <Link
          href={`/dashboard/clients/${clientId}/business-inbox`}
          title="已连接邮箱里同步进来的邮件清单（每小时一次）。只能看，回信仍然去邮箱里回。"
          className={linkCls}
        >
          商务收件箱
        </Link>
        {flags.agents && (
          <Link
            href={`/dashboard/clients/${clientId}/agents`}
            title="送客给我们的旅行社同行，以及他们各自手上的客人进展。"
            className={linkCls}
          >
            同行渠道
          </Link>
        )}
        {/*
          「我的客人」入口 2026-10-26 去掉：那一页是给「按房子跟客人的中介」做的，
          对不按房子经营的客户（例如 CTS）点进去只会看到一句「用它反而绕远」+
          一个跳回「全部客人」的按钮，而这句话要等 3 秒（实测 /crm/contacts 接口 3046ms）
          才显示出来。页面本身留着，按房子经营的客户仍能用网址进；只是不再摆在这里误导人。
        */}
      </div>
    </>
  )
}
