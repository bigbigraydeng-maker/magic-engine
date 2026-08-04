'use client'

/**
 * 客户配置中心的分组页签。
 *
 * ## 为什么要有它（PM 2026-08-03：「当前的页面太长，不好用」）
 *
 * 这一页原先是 **23 个板块堆在一根 768px 宽的竖列里**，全部展开。两个后果：
 *
 * **① 找不到东西。** 人来这一页永远是为了办**一件**事（连个邮箱、改个关键词），
 * 却要从 22 个不相干的板块里滚过去。滚动条本身就是失败的证据。
 *
 * **② 慢。** 每个板块自己 fetch 自己的数据，打开一次页面同时发 20 多个请求。
 * 分组之后只渲染当前这一组 —— **不是把别的藏起来，是根本不挂载**，
 * 所以那些请求压根不会发出去。这是分页签比折叠面板强的地方。
 *
 * ## 分组按「你来干什么」，不按内部编号
 *
 * 原来的 §0–§4 是按技术性质分的（OAuth 类 / 元数据 / 社媒…）。那是给写代码的人
 * 看的。这里按**来办什么事**分：接通一条管道 / 填客户资料 / 管客人 / 管内容。
 *
 * ## 一条必须守住的：授权回来时要落在对的页签
 *
 * GBP 和邮箱授权完都会跳回这一页并带上 `?mail=ok` / `?gbp=connected`。
 * 那条「✓ 连上了」的提示在「接通」这一组里 —— 要是默认页签不是它，
 * 人授权完看到的是一片跟他无关的东西，会以为没成功。所以带这些参数时
 * **强制切到「接通」**。
 */

import { useSearchParams } from 'next/navigation'
import { useState, type ReactNode } from 'react'

export type SettingsTab = 'connect' | 'profile' | 'crm' | 'content' | 'advanced'

export const SETTINGS_TABS: Array<{
  key: SettingsTab
  icon: string
  label: string
  /** 一句话说清这一组是干什么的 —— 不写的话人还是要靠点开试。 */
  hint: string
}> = [
  { key: 'connect',  icon: '🔌', label: '接通',     hint: '把客户的账号接进来：商家页、公司邮箱、广告' },
  { key: 'profile',  icon: '🏢', label: '客户资料', hint: 'AI 写东西之前会逐条读：行业、产品、关键词、红线' },
  { key: 'crm',      icon: '👥', label: '客人跟进', hint: '跟进步骤、邮件反应、素材上传' },
  { key: 'content',  icon: '📣', label: '内容与社媒', hint: '社媒账号、自动发文、评论自动回复' },
  { key: 'advanced', icon: '⚙️', label: '高级',     hint: '给程序用的接口密钥' },
]

/**
 * 授权回来时带的参数 —— 出现任意一个就强制落在「接通」。
 *
 * `mail` 是邮箱那条（见 api/auth/microsoft/mail/callback），
 * `gbp` 是商家页那条。两条的成功/失败提示都渲染在「接通」这一组里。
 */
const CONNECT_PARAMS = ['mail', 'gbp'] as const

/**
 * 这次打开该落在哪一页签。
 *
 * 抽成纯函数（不直接读 `useSearchParams`）是为了能单测 —— 这里错一次的代价是
 * 「人授权完看到一片跟他无关的东西，以为没成功」，而那种错误在 UI 上很难被发现。
 *
 * 优先级：授权回跳 > `?tab=` > 默认「接通」。
 * 授权回跳排最前，因为那一刻人不是来挑页签的，是来看结果的。
 */
export function pickInitialTab(get: (key: string) => string | null): SettingsTab {
  if (CONNECT_PARAMS.some((p) => get(p))) return 'connect'
  const asked = get('tab')
  return SETTINGS_TABS.find((t) => t.key === asked)?.key ?? 'connect'
}

export function useInitialTab(): SettingsTab {
  const params = useSearchParams()
  return pickInitialTab((k) => params.get(k))
}

export function SettingsTabBar({
  active,
  onPick,
}: {
  active: SettingsTab
  onPick: (t: SettingsTab) => void
}) {
  const current = SETTINGS_TABS.find((t) => t.key === active)
  return (
    <div className="mt-6">
      {/* 窄屏会横向滚动 —— 五个页签在手机上放不下，压成两行比横滑更难点。 */}
      <div
        role="tablist"
        aria-label="配置分组"
        className="-mx-1 flex gap-1 overflow-x-auto border-b border-slate-200 px-1"
      >
        {SETTINGS_TABS.map((t) => {
          const on = t.key === active
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={on}
              type="button"
              onClick={() => onPick(t.key)}
              className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-black transition ${
                on
                  ? 'border-cyan-600 text-slate-900'
                  : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800'
              }`}
            >
              <span className="mr-1.5">{t.icon}</span>
              {t.label}
            </button>
          )
        })}
      </div>
      {current && <p className="mt-2 text-xs text-slate-500">{current.hint}</p>}
    </div>
  )
}

/** 一个板块的外壳。标题 + 内容，样式集中在这里，不在页面里抄 23 遍。 */
export function SettingsSection({
  icon,
  title,
  children,
  first,
}: {
  icon: string
  title: string
  children: ReactNode
  /** 一组里的第一个不加上边距。 */
  first?: boolean
}) {
  return (
    <section className={first ? '' : 'mt-6'}>
      <div className="mb-3 flex items-center gap-2">
        <span className="text-base">{icon}</span>
        <h2 className="font-black text-slate-800">{title}</h2>
      </div>
      {children}
    </section>
  )
}

/**
 * 页签状态。**同时写进地址栏** —— 不写的话，刷新一次就回到第一组，
 * 而这一页上很多操作（授权、保存）都会导致刷新或跳转。
 */
export function useSettingsTab(): [SettingsTab, (t: SettingsTab) => void] {
  const initial = useInitialTab()
  const [tab, setTab] = useState<SettingsTab>(initial)

  const pick = (t: SettingsTab) => {
    setTab(t)
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    url.searchParams.set('tab', t)
    // 用 replaceState 而不是 router.replace：这一页所有面板都是客户端自己
    // fetch 的，走 Next 的导航会把整棵树重挂一遍，等于白省了那些请求。
    window.history.replaceState(null, '', url.toString())
  }

  return [tab, pick]
}
