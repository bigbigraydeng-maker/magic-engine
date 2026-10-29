'use client'

/**
 * 点开一个人：他是谁、怎么联系、往来记录、记一笔、改到哪一步。
 *
 * 看板的列很窄（一列只放得下名字和一句话），所以详情走抽屉 —— 宽屏从右侧
 * 滑出，手机上铺满整屏。prospecting 的看板也是这个交互。
 */

import { phoneRegionLabel } from '@/lib/crm/phone-region'
import { ReturningRoute } from './ReturningRoute'
import { AssigneeSelect } from './AssigneeSelect'
import type { ContactRow } from '../all/_components/contact-table-types'
import { CallButton } from './CallButton'
import { useCallback, useEffect, useState } from 'react'
import { ComposeNote, type StageOption } from './ComposeNote'
import { WhatsAppReply } from './WhatsAppReply'
import { ContactTimeline, type TimelineSummary, type TimelineAiBrief, type StageSource } from './ContactTimeline'
import { briefAge } from '@/lib/crm/brief-age'
import { MessengerReply } from './MessengerReply'
import { EmailReply } from './EmailReply'
import { ComposeEmail } from './ComposeEmail'
import { PostCallEmailBar } from './PostCallEmailBar'
import { ProfileCard } from './ProfileCard'
import { ReturnLeadPanel } from './ReturnLeadPanel'
import { DncBanner } from './DncBanner'
import { MarkWonPanel } from './MarkWonPanel'
import { ImportantMarkerEditor } from './ImportantMarkerEditor'
import { BookingsBlock } from './bookings/BookingsBlock'
import { BackToPayments } from './BackToPayments'
import { useBodyScrollLock } from './useBodyScrollLock'
import { drawerActions, nextStageChoices, type Channel } from '@/lib/crm/drawer-actions'
import type { Segment } from '@/lib/crm/segments'
import { intentNote, type NextAction } from '@/lib/crm/next-action'

export interface DrawerRow {
  contactId: string
  name: string
  phone: string | null
  email: string | null
  stage: string | null
  stageLabel: string | null
  reason?: string
  /**
   * 「回头客」（之前咨询过、我们联系过、今天又填了咨询表）。跟列表行同一份判据，
   * 抽屉靠它**立刻**画出顶部横幅，不用等往来记录接口回来（见 `lib/crm/returning-lead`）。
   * 🔴 `toDrawerRow` 是一个字段一个字段映射的 —— 加了这里不加那里，列表上有「🔥 回头」、
   * 抽屉却不显示横幅（2026-10-27 tsc 报出来才发现；之前 tsc 被主干一个语法错的文件遮住了）。
   */
  returning?: ContactRow['returning']
  dueAt?: string | null
  /** 他现在在哪一批 —— 决定给哪几个按钮。 */
  segment?: Segment
  /**
   * 「要记住的事」（⭐ 重要标记）—— 员工手填的提醒 + 到期日。
   *
   * 2026-09-27 R1 加：这一格原来只长在「全部客人」那一页，抽屉这边没有，
   * 于是同一个客人在两页上能做的事不一样。今日待办还有一条 `crm_important_due`
   * 依赖它。取数侧见 `today/route.ts`。
   */
  important?: { note: string | null; dueAt: string | null } | null
  /** 他实际能被联系到的渠道 —— 决定按钮的措辞（没电话的人不给「没打通」）。 */
  suggestedChannel?: Channel
  /**
   * 库里有号码，但那个号打不通。
   *
   * 🔴 **抽屉必须跟卡片说同一件事**（Codex 复审 2026-08-16）。坏号的人只要还有
   * 邮箱或 Messenger 就会留在名单上，卡片已经把拨号动作换成「这个号打不通」；
   * 但点进抽屉之后，这里原先只看有没有号码就无条件渲染一个 `tel:` 链接 ——
   * 销售照样一点就拨那个已知打不通的号。
   */
  phoneUnusable?: boolean
  /**
   * 这个人现在被标成「别再联系」——**任何渠道都不许再发**。
   *
   * 抽屉里要给一条**取消**的路：早前的判词把「不打算去」当成过「别再联系」，
   * 被误判的人收不到我们任何消息，而在这之前系统里根本没有取消入口
   * （见 `lib/crm/dnc` 与 `api/.../dnc` 路由）。
   */
  doNotContact?: boolean
  /**
   * 「该做什么」—— 阶段 / 冷热 / 意向合成的那一个概念（PM 2026-10-10）。
   * 列表接口算好传进来；没有（老调用方）就退回只显示阶段按钮。
   */
  nextAction?: NextAction
  /** 最新 AI 摘要的意向。只用来显示一行「AI 初判（未校准）」小字，不影响任何按钮或排序。 */
  intent?: 'high' | 'medium' | 'low' | 'unknown' | null
  /**
   * 这条线索的跟进人（`contacts.assigned_to`）—— 字面邮箱或 null。
   *
   * part 2 的 round-robin 新进线时自动写入；part 3 这里给员工看 + 改。
   * 列表接口把它跟别的字段一起透下来；下拉里的候选从 `/crm/assignees` 另拉。
   */
  assignedTo?: string | null
}

const STAGE_SOURCE_LABEL: Record<StageSource, string> = {
  human: '人工标的',
  ai_conversation: 'AI 从对话里读的',
  order_system: '订单系统',
}

/**
 * New Asian Logistics —— 只有这一个客户把人标「已成交」时要先录金额并回传 Meta 广告。
 * 同一个字面量在 `nal-mark-won/route.ts` 另有一份，是既有惯例（`ContactDetail.tsx` 那份已在
 * 2026-09-28 CRM 重整 B2 随「全部客人」换用本组件一起删掉，不再有第三份）；按设计稿 R3
 * 要统一改成读 `leads_config.crm.onWon` 配置、不认客户 id。
 */
const NAL_CLIENT_ID = '4ae76381-cd45-43bd-85cd-98cfd7604007'

export interface DrawerNav {
  /** 「客人在等你 · 第 12 位 / 共 217 位」这类文案，drawer-nav.ts 的 positionLabel 原样传入。 */
  positionLabel: string
  /** 上一位 / 下一位——调用方负责算下一步该做什么（留在原地换人 / 去问服务端要下一页 / 报到头了）。 */
  onPrev: () => void
  onNext: () => void
  /** 正在拉下一页——按钮先禁掉，不许连点叠多次请求（跟 all/page.tsx 现有 sectionsLoading 同款防抖）。 */
  busy: boolean
}

export function PersonDrawer({
  clientId,
  row,
  stages,
  viewerEmail,
  onClose,
  onSaved,
  nav,
  scrollToBookings = false,
}: {
  clientId: string
  row: DrawerRow
  stages: StageOption[]
  /** 从这里发出去的私信挂在谁名下 —— 发送框要当面说清楚。 */
  viewerEmail: string | null
  onClose: () => void
  onSaved: (msg: string, reload?: boolean) => void
  /**
   * 上一位 / 下一位——不传就不渲染这一行（今天要联系那页的看板式交互暂不需要）。
   * 2026-09-28 CRM 重整 B2 给「全部客人」加：调用方（crm/all/page.tsx）负责用
   * `lib/crm/drawer-nav.ts` 算出下一步该做什么，这里只管画按钮、转发点击。
   */
  nav?: DrawerNav
  /** 一打开就滚到「订单与付款」（付款总览页原地弹出时用）。 */
  scrollToBookings?: boolean
}) {
  const [composing, setComposing] = useState(false)
  const [changingStage, setChangingStage] = useState(false)
  /** NAL 专属：标「已成交」前先录金额。 */
  const [markingWon, setMarkingWon] = useState(false)
  /** 阶段的「其他」展开没有 —— 默认只给下一步 + 一个出口。 */
  const [allStages, setAllStages] = useState(false)
  /** 「上次说到这」默认只露四行，长的可展开看全。 */
  const [lastTextOpen, setLastTextOpen] = useState(false)
  /** 「更多」折叠区 —— 次要控件都收在这里，屏幕上只留一个主按钮（PM：按钮太多）。 */
  const [moreOpen, setMoreOpen] = useState(false)
  /** 一键动作正在写 —— 防双击记成两笔。 */
  const [quickBusy, setQuickBusy] = useState(false)
  /** 记完一笔换个 key，让时间线重新拉一次 —— 刚记的那条要立刻出现在上面。 */
  const [timelineKey, setTimelineKey] = useState(0)
  /** 刚点了拨打的时间：往来记录据此自动刷新，直到这通电话变成正式记录。 */
  const [dialedAt, setDialedAt] = useState<number | null>(null)
  /**
   * 顶上那张「上次说到这」卡片的内容，由 `ContactTimeline` 算好回传。
   * `useCallback` 是必须的：这个函数进了那边的 `load` 依赖，每次渲染换一个新
   * 引用会让它无限重拉。
   */
  const [summary, setSummary] = useState<TimelineSummary | null>(null)
  const onSummary = useCallback((s: TimelineSummary | null) => setSummary(s), [])
  // AI 概况（conversation_briefs 最新一份）—— 抽屉打开 / 换人时单独取一次。
  // 不并进时间线接口：那个接口 2026-10-10 起有测试守着「不查 conversation_briefs」；
  // 也不并进列表接口：全带会把那页拖慢。换人时先清空，不让上一个人的概况留着。
  const [aiBrief, setAiBrief] = useState<TimelineAiBrief | null>(null)
  const age = aiBrief ? briefAge(aiBrief.generatedAt) : null
  // 这张 AI 卡生成**之后**他又有了新动作（又填了表、又回了消息、又点了链接）—— 卡里的
  // 「客户尚未回复」之类说法就不对了，必须当场说出来，别让员工拿一张过期的卡当现状。
  // PM 2026-10-27：卡 10/26 生成、说「客户尚未回复」，而她今天又填了表。
  // 时间读不出来就不提醒，不猜（跟上面 briefAge 同一个原则）。
  const newerActivity = (() => {
    const gen = aiBrief?.generatedAt ? Date.parse(aiBrief.generatedAt) : NaN
    const last = summary?.engagement?.lastActiveAt ? Date.parse(summary.engagement.lastActiveAt) : NaN
    return Number.isFinite(gen) && Number.isFinite(last) && last > gen
  })()
  const contactId = row.contactId
  useEffect(() => {
    let alive = true
    setAiBrief(null)
    setLastTextOpen(false)
    const ctrl = new AbortController()
    void (async () => {
      try {
        const res = await fetch(
          `/api/clients/${clientId}/crm/contacts/${contactId}/brief`,
          { signal: ctrl.signal },
        )
        if (!res.ok) {
          // 「确实没简报」和「接口 4xx/5xx」在界面上都表现为不显示概况卡 ——
          // 打一条日志，让排查时能区分，不然两者看起来一模一样。
          console.warn(`[drawer] AI 概况取失败 contact=${contactId} status=${res.status}`)
          return
        }
        const json = (await res.json()) as { brief?: TimelineAiBrief | null }
        if (alive) setAiBrief(json.brief ?? null)
      } catch {
        // 取不到就不显示概况卡 —— 抽屉其余部分照常，不挡人干活。
      }
    })()
    return () => {
      alive = false
      ctrl.abort()
    }
  }, [clientId, contactId])

  const changeStage = async (toStage: string, label: string) => {
    if (!window.confirm(`到哪一步了：${row.stageLabel ?? '还没标'} → 改成「${label}」？`)) return
    setChangingStage(false)
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/contacts/${row.contactId}/stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // 🔴 expectedFromStage: row.stage —— 跟进团队一起翻同一份名单（PM 2026-09-27
        // 确认），带上「我看到的是哪一档」，库里跟这个不一致就说明中间被别人先改过了，
        // 不能盲写覆盖（见 lib/crm/advance-contact-stage.ts 头注）。
        body: JSON.stringify({ toStage, expectedFromStage: row.stage }),
      })
      if (res.status === 409) {
        const json = (await res.json().catch(() => null)) as { actualStage?: string | null } | null
        const actualLabel = stages.find((s) => s.stageKey === json?.actualStage)?.label ?? json?.actualStage ?? '未知'
        // reload:true —— 得让父级重拉，不然这个抽屉还留着我们这边已经过时的那份数据。
        onSaved(`这位客人的跟进阶段被别人改过了（现在是「${actualLabel}」），刷新后再改`, true)
        return
      }
      if (!res.ok) throw new Error()
      setTimelineKey((k) => k + 1)
      onSaved('✓ 改好了')
    } catch {
      onSaved('没改上，再试一次')
    }
  }


  /**
   * 一键动作 —— 「没打通」「发出去了，等他回」。
   *
   * 这是这一页最高频的结果，让它零成本：一次点击，不用打字、不用二次确认。
   * 那句话由 lib/crm/drawer-actions 给定（不在这里现编），因为它会被解析成
   * outcome，决定这个人明天落到哪一批。
   */
  const quickLog = async (note: string) => {
    if (quickBusy) return
    setQuickBusy(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/touchpoints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactId: row.contactId,
          direction: 'outbound',
          note,
          // 每次点击一个新键 —— 同一个人今天可以打两次都没接。
          clientRef: globalThis.crypto.randomUUID(),
        }),
      })
      if (!res.ok) throw new Error()
      setTimelineKey((k) => k + 1)
      onSaved(`✓ 记下了：${note}`, false)
    } catch {
      onSaved('没记上，再点一下试试', false)
    } finally {
      setQuickBusy(false)
    }
  }

  // 这一刻该给哪几个按钮 / 哪几个阶段 —— 判断全在 lib 里，页面不自己拍。
  useBodyScrollLock()
  const actions = drawerActions(row.segment ?? 'stale_conversation', row.suggestedChannel ?? 'phone')
  const stageChoices = nextStageChoices(stages, row.stage)

  return (
    <>
      {/* 点旁边空白关掉 */}
      <div
        onClick={onClose}
        className="fixed inset-0 z-40 bg-me-charcoal/25"
        aria-hidden
      />

      <aside className="fixed inset-y-0 right-0 z-50 flex w-full flex-col bg-me-ivory shadow-2xl sm:max-w-[580px]">
        <header className="flex items-start justify-between gap-3 border-b border-me-charcoal/10 bg-white px-4 py-3">
          <div className="min-w-0">
            <BackToPayments key={row.contactId} clientId={clientId} />
            <h2 className="truncate text-lg font-black text-me-charcoal">{row.name}</h2>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg px-2 py-1 text-sm font-bold text-me-charcoal/40 hover:bg-me-charcoal/5"
          >
            关闭
          </button>
        </header>

        {nav && (
          <div className="flex items-center gap-2 border-b border-me-charcoal/10 bg-white px-4 py-2">
            <button
              type="button"
              onClick={nav.onPrev}
              disabled={nav.busy}
              className="rounded-lg border border-me-charcoal/15 px-2.5 py-1 text-xs font-bold text-me-charcoal hover:bg-me-ivory disabled:opacity-40"
            >
              ← 上一位
            </button>
            <span className="flex-1 truncate text-center text-[11px] font-semibold text-me-charcoal/45">
              {nav.busy ? '正在拿下一位…' : nav.positionLabel}
            </span>
            <button
              type="button"
              onClick={nav.onNext}
              disabled={nav.busy}
              className="rounded-lg border border-me-charcoal/15 px-2.5 py-1 text-xs font-bold text-me-charcoal hover:bg-me-ivory disabled:opacity-40"
            >
              下一位 →
            </button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          {/*
            开口前要知道的三样，摆在**第一屏**（PM 2026-08-17，CTS 销售视角）。

            抽屉原先的顺序是：联系方式 → 阶段 → 按钮 → 回私信 → 往来记录。
            可销售脑子里的顺序是「他上次说了什么 → 我现在说什么 → 号码在哪」——
            最该先看的那句话在最下面，还得再往下滚到那一段的末尾才看得到。

            这三样都来自往来记录本身，不额外拉一次接口：`ContactTimeline`
            算好之后回传（判据只有一份）。
          */}
          {/* 🔥 回头客 —— 抽屉里最该先看到的一件事（PM 2026-10-27）。
              之前咨询过、我们联系过，今天又填了咨询表：他特意回来的，意向比任何一条普通回复都强。
              横幅用列表行里的 `returning` 先画出来（不用等往来记录加载），故事线来自往来记录接口，
              到了再补上。两边都是同一份判据（lib/crm/returning-lead）。 */}
          {(summary?.engagement?.returning ?? row.returning) && (
            <div
              className="mb-3 rounded-xl border border-[#C2453A]/35 bg-[#C2453A]/[0.07] px-3 py-2.5"
              data-testid="returning-banner"
            >
              <p className="text-[13px] font-black text-[#C2453A]">🔥 他又回来了 —— 意向很强，今天优先联系</p>
              {summary?.engagement?.journey ? (
                <ReturningRoute journey={summary.engagement.journey} />
              ) : (
                summary?.engagement && summary.engagement.story.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5" data-testid="returning-story">
                    {summary.engagement.story.map((line) => (
                      <li key={line} className="text-[12px] leading-relaxed text-me-charcoal/85">
                        {line.startsWith('🔥 ') ? <span className="font-bold">{line}</span> : line}
                      </li>
                    ))}
                  </ul>
                )
              )}
            </div>
          )}
          {/* 往来一览 —— 一行字讲清「我们联系过他什么、他做过什么」。以前要滚到最底下的往来记录里才看得出
              我们有没有发过邮件（PM 2026-10-27：「看不出来我们是否发了邮件，但 AI 摘要里说的确实发过」）。 */}
          {summary?.engagement?.line && (
            <p className="mb-2 text-[12px] font-semibold text-me-charcoal/65" data-testid="engagement-line">
              📋 {summary.engagement.line}
            </p>
          )}
          {summary?.formFactsLine && (
            <p className="mb-2 text-[12px] font-bold text-me-charcoal/70" data-testid="form-facts-line">
              {summary.formFactsLine}
            </p>
          )}

          {/* AI 概况 —— 摆在第一屏最上面（PM 2026-10-26）。CTS 员工日常不用翻全部历史，
              看这张卡就知道这个客人是谁、到哪一步、想要什么、我们承诺过什么；要查证点下面
              「看完整往来原文」。
              🔴 这是 AI 生成、**未经人工核实**（提示词已知偶尔编商业细节，例如价格有效期），
                 卡上明确标注「以原文为准」，不让员工把它当成板上钉钉的事实。
                 不放「下一步」——那是下面「该做什么」卡的事，避免两处打架。 */}
          {aiBrief && (
            <div className="mb-3 rounded-xl border border-me-ochre/30 bg-me-ochre/[0.06] px-3 py-2.5" data-testid="ai-overview">
              <p className="mb-1.5 text-[10px] font-black uppercase tracking-[0.12em] text-me-ochre">
                AI 概况 · 未核实，以原文为准
              </p>
              {/* 生成时间：简报里常带「明天 11 点」「等待了 825 小时」这类跟生成时刻绑死的说法，
                  不写时间员工没法判断新不新。超过 3 天多提醒一句。读不出时间就不写，不猜。 */}
              {age && (
                <p
                  className={`mb-1.5 text-[11px] ${age.stale ? 'font-bold text-[#C2453A]' : 'text-me-charcoal/50'}`}
                  data-testid="ai-overview-age"
                >
                  {age.label}
                  {age.stale ? ' · 里面的时间说法可能已过时，请核对原文' : ''}
                </p>
              )}
              {newerActivity && (
                <p className="mb-1.5 text-[11px] font-bold text-[#C2453A]" data-testid="ai-overview-newer-activity">
                  ⚠️ 这张卡生成之后他又有新动作（见上面的往来一览），卡里「尚未回复」之类的说法可能已不对，以最新记录为准
                </p>
              )}
              <p className="text-[13px] leading-relaxed text-me-charcoal/90">{aiBrief.summary}</p>
              {aiBrief.customerNeeds.length > 0 && (
                <div className="mt-2 flex gap-2">
                  <span className="min-w-[52px] text-[11px] font-bold text-me-charcoal/50">想要什么</span>
                  <span className="flex-1 text-[12px] leading-relaxed text-me-charcoal/85">
                    {aiBrief.customerNeeds.join('；')}
                  </span>
                </div>
              )}
              {aiBrief.promisesMade.length > 0 && (
                <div className="mt-1.5 flex gap-2">
                  <span className="min-w-[52px] text-[11px] font-bold text-me-charcoal/50">我们承诺过</span>
                  <span className="flex-1 text-[12px] leading-relaxed text-me-charcoal/85">
                    {aiBrief.promisesMade.join('；')}
                  </span>
                </div>
              )}
              {aiBrief.objections.length > 0 && (
                <div className="mt-1.5 flex gap-2">
                  <span className="min-w-[52px] text-[11px] font-bold text-[#C2453A]/80">顾虑</span>
                  <span className="flex-1 text-[12px] leading-relaxed text-me-charcoal/85">
                    {aiBrief.objections.join('；')}
                  </span>
                </div>
              )}
            </div>
          )}
          {summary && (summary.lastText || summary.tour || summary.travelWindow) && (
            <div className="mb-3 rounded-xl border border-me-ochre/25 bg-me-ochre/[0.06] px-3 py-2.5">
              {summary.lastText && (
                <>
                  <p className="text-[10px] font-black uppercase tracking-[0.12em] text-me-ochre">
                    上次说到这
                  </p>
                  <p
                    className={`mt-1 whitespace-pre-line text-[13px] leading-relaxed text-me-charcoal/85 ${lastTextOpen ? '' : 'line-clamp-4'}`}
                  >
                    <span className="font-bold">{summary.lastWho}：</span>
                    {summary.lastText}
                  </p>
                  {summary.lastText.length > 160 && (
                    <button
                      type="button"
                      onClick={() => setLastTextOpen((v) => !v)}
                      className="mt-1 text-[12px] font-bold text-me-ochre"
                    >
                      {lastTextOpen ? '收起' : '展开看全文'}
                    </button>
                  )}
                </>
              )}
              {(summary.tour || summary.travelWindow) && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {summary.tour && (
                    <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-me-charcoal/75">
                      广告表单里点过：{summary.tour}
                    </span>
                  )}
                  {summary.travelWindow && (
                    <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-me-charcoal/75">
                      {summary.travelWindow} 走
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 联系方式 —— 手机上点一下就拨 */}
          <div className="flex flex-wrap gap-2">
            {/* 号码打不通就**不给拨号链接** —— 号码照旧显示出来（要改号得先看得见），
                但点不动，并说清该做什么。给一个已知打不通的号配一个拨号按钮，
                等于请他再白打一次。 */}
            {row.phone && row.phoneUnusable && (
              <span className="rounded-lg border border-me-stone bg-black/[0.04] px-3 py-2 text-sm font-semibold text-me-charcoal/45 line-through">
                📞 {row.phone}
              </span>
            )}
            {row.phone && row.phoneUnusable && (
              <span className="w-full text-xs font-semibold text-me-charcoal/55">
                ⚠️ 这个号打不通 —— 用下面的邮箱 / 私信联系，顺便问他要个新号
              </span>
            )}
            {row.phone && !row.phoneUnusable && (
              <a
                href={`tel:${row.phone}`}
                className="rounded-lg border border-me-stone bg-white px-3 py-2 text-sm font-semibold text-me-charcoal"
              >
                📞 {row.phone}
                {phoneRegionLabel(row.phone) && (
                  <span className="ml-1.5 text-[11px] font-bold text-me-charcoal/50">
                    {phoneRegionLabel(row.phone)}号码
                  </span>
                )}
              </a>
            )}
            {row.phone && !row.phoneUnusable && !row.doNotContact && (
              <CallButton
                clientId={clientId}
                contactId={row.contactId}
                onDialed={() => {
                  setDialedAt(Date.now())
                  setTimelineKey((k) => k + 1)
                }}
              />
            )}
            {row.email && (
              <>
                <a
                  href={`mailto:${row.email}`}
                  className="break-all rounded-lg border border-me-stone bg-white px-3 py-2 text-sm font-semibold text-me-charcoal"
                >
                  ✉️ {row.email}
                </a>
                {/* mailto 靠电脑里设好的邮件程序，没设就没反应——旁边永远有一个有反馈的「复制」。 */}
                <CopyEmailButton email={row.email} />
              </>
            )}
            {row.doNotContact && (
              <DncBanner clientId={clientId} contactId={row.contactId} name={row.name} onSaved={onSaved} />
            )}
            {!row.phone && !row.email && (
              <span className="text-xs text-me-charcoal/45">没留电话和邮箱，只能在私信里回他</span>
            )}
          </div>

          {/* 客人档案：名字（可改）/ 昵称 / 邮箱 / 电话（可加）。PM 2026-10-22：先把字段做好，以后有机会再完善。 */}
          <ProfileCard clientId={clientId} contactId={row.contactId} onChanged={() => onSaved('✓ 档案已保存', true)} />

          {/* 跟进人（issue #3158 part 3）—— 这一条线索分给谁跟。part 2 的 round-robin
              在新进线时自动写入；这里让员工看得见 + 改得动。放在档案下面、「该做什么」上面：
              销售开口前先知道「这单归我吗」，再往下看该做什么。 */}
          <AssigneeSelect
            clientId={clientId}
            contactId={row.contactId}
            current={row.assignedTo ?? null}
            viewerEmail={viewerEmail}
            onSaved={onSaved}
          />

          {/* 该做什么 —— 三行：动作 + 为什么 / AI 建议 / 到哪一步了（点开可改）。
              这一块取代了原来并排的三套状态（阶段按钮、冷热标签、意向小圆标），PM 2026-10-10：
              页面少信息多引导，只留一个概念告诉人该做什么。 */}
          <div className="mt-3 rounded-xl border border-me-charcoal/10 bg-white px-3 py-2.5" data-testid="next-action-card">
            {row.nextAction ? (
              <>
                <p className="text-base font-black text-me-charcoal">{row.nextAction.verbLabel}</p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-me-charcoal/75">
                  {row.nextAction.reason}
                </p>
                {row.nextAction.aiSuggestion && (
                  <p className="mt-1.5 text-[13px] text-me-charcoal/85">
                    <span className="font-bold">AI 建议：</span>
                    {row.nextAction.aiSuggestion}
                  </p>
                )}
                {intentNote(row.intent ?? null) && (
                  <p className="mt-1 text-[11px] text-me-charcoal/40">{intentNote(row.intent ?? null)}</p>
                )}
              </>
            ) : (
              row.reason && <p className="text-[13px] text-me-charcoal/75">{row.reason}</p>
            )}
            {stages.length > 0 && (
              <p className="mt-2 text-[12px] text-me-charcoal/55" data-testid="stage-line">
                到哪一步了：{row.stageLabel ?? '还没标'}
                {summary?.stageSource ? ` · ${STAGE_SOURCE_LABEL[summary.stageSource]}` : ''}
              </p>
            )}
            {/* 不是有效咨询 → 退回（系统从原因里学）；已退回的人 → 一键拉回。客户没配「非咨询」阶段时不渲染。 */}
            <ReturnLeadPanel
              clientId={clientId}
              contactId={row.contactId}
              currentStage={row.stage}
              stages={stages}
              onDone={(msg) => {
                setTimelineKey((k) => k + 1)
                onSaved(msg, true)
              }}
            />
          </div>

          {/* 现在该做什么 —— 最多两个按钮，措辞按他能被联系到的渠道走。
              一个从没被联系过的人只有两种结果：打通了，或者没打通。
              其余控件在这一刻都是噪音，而噪音的代价是销售不用这一页。 */}
          <div className="mt-3">
            {/*
              🔴 `markingWon` 必须判在最前面。第一版把它写在 `!composing` 的 else 分支里，
              于是只有「正在记一笔」时才可能出现 —— 而点「已成交」只设 markingWon、
              不设 composing，所以那个面板永远不出现。是新加的测试抓到的。
            */}
            {markingWon ? (
              <MarkWonPanel
                contactId={row.contactId}
                onCancel={() => setMarkingWon(false)}
                onDone={(msg, reload) => {
                  setMarkingWon(false)
                  setTimelineKey((k) => k + 1)
                  onSaved(msg, reload)
                }}
              />
            ) : !composing ? (
              <div className="flex gap-2">
                {actions
                  .filter((a) => a.kind === 'log')
                  .map((a) => (
                    <button
                      key={a.kind}
                      onClick={() => setComposing(true)}
                      className="w-full rounded-lg bg-me-charcoal py-2.5 text-[15px] font-black text-white"
                    >
                      {a.label}
                    </button>
                  ))}
              </div>
            ) : (
              <ComposeNote
                clientId={clientId}
                row={{ contactId: row.contactId, stage: row.stage }}
                // 下拉里也只给下一步 —— 10 项的下拉是 PM 点名的噪音之一
                stages={stageChoices.suggested}
                onCancel={() => setComposing(false)}
                onDone={(msg) => {
                  setComposing(false)
                  setTimelineKey((k) => k + 1)
                  // 不重拉整块看板 —— 抽屉还开着，脚下的列表跳动会让人失去位置。
                  onSaved(msg, false)
                }}
              />
            )}
          </div>

          {/* 「更多」—— 次要控件都收在这里，屏幕上只留一个主按钮（PM：按钮太多）。
              markingWon / composing 那两个面板占屏时整块藏起来，别跟它们抢。 */}
          {!markingWon && !composing && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setMoreOpen((v) => !v)}
                aria-expanded={moreOpen}
                className="text-xs font-bold text-me-charcoal/45 hover:text-me-charcoal/70"
              >
                {moreOpen ? '收起 ▴' : '更多 ▾'}
              </button>
              {moreOpen && (
                <div className="mt-2 space-y-3 rounded-xl border border-me-charcoal/10 bg-white p-3" data-testid="drawer-more">
                  {/* 一键结果：没打通 / 发出去了等他回 */}
                  {actions
                    .filter((a) => a.kind !== 'log')
                    .map((a) => (
                      <button
                        key={a.kind}
                        disabled={quickBusy}
                        onClick={() => void quickLog(a.cannedNote ?? '')}
                        className="shrink-0 rounded-lg border border-me-charcoal/25 bg-white px-4 py-2.5 text-[15px] font-bold text-me-charcoal/75 disabled:opacity-40"
                      >
                        {a.label}
                      </button>
                    ))}
                  {/* 改到哪一步 */}
                  {stages.length > 0 && (
                    <div>
                      <button
                        onClick={() => setChangingStage((v) => !v)}
                        className="rounded-full border border-me-charcoal/15 bg-white px-3 py-1.5 text-xs font-bold text-me-charcoal/70"
                      >
                        改「到哪一步了」▾
                      </button>
                      {changingStage && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {/* 只给下一步 + 一个「谈崩了」的出口。
                              铺 9 个阶段的问题不是占地方，是每多一个选项就多一次犹豫 ——
                              而「新线索」直接跳「已付全款」的情况根本不存在。 */}
                          {(allStages
                            ? [...stageChoices.suggested, ...stageChoices.rest]
                            : stageChoices.suggested
                          ).map((s) => (
                            <button
                              key={s.stageKey}
                              onClick={() => {
                                // 🔴 判据照抄「全部客人」那一页（ContactDetail），一个字没改：
                                // 只有 NAL 把人标成「已成交」时要先录金额、再回传广告转化。
                                // 两页必须说同一件事，否则销售在一页能标、另一页标不了。
                                // 那个客户 id 按设计稿要在后续轮改成读配置，这一轮先保持一致。
                                if (clientId === NAL_CLIENT_ID && s.marketingAction === 'won') {
                                  setChangingStage(false)
                                  setMarkingWon(true)
                                  return
                                }
                                void changeStage(s.stageKey, s.label)
                              }}
                              className="rounded-full bg-white px-3 py-1.5 text-[13px] font-bold text-me-charcoal shadow-sm"
                            >
                              {s.label}
                            </button>
                          ))}
                          {!allStages && stageChoices.rest.length > 0 && (
                            <button
                              onClick={() => setAllStages(true)}
                              className="rounded-full border border-dashed border-me-charcoal/25 px-3 py-1.5 text-[13px] font-bold text-me-charcoal/50"
                            >
                              其他 {stageChoices.rest.length} 个…
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {/* 要记住的事 */}
                  <ImportantMarkerEditor
                    clientId={clientId}
                    row={{ contactId: row.contactId, important: row.important ?? null }}
                    // 不重拉整块看板 —— 抽屉还开着，脚下的列表跳动会让人失去位置（同 ComposeNote）。
                    onSaved={(msg) => onSaved(msg, false)}
                  />
                </div>
              )}
            </div>
          )}

          {/* 订单与付款：没开通这项功能或没权限的人，这一块什么都不渲染 */}
          <BookingsBlock key={row.contactId} clientId={clientId} contactId={row.contactId} scrollIntoViewOnReady={scrollToBookings} />

          {/* 往来记录：表单 / 电话 / 私信 / 邮件（以后是外呼），一条线倒序 */}
          <div className="mt-5">
            <p className="mb-2 text-[11px] font-black uppercase tracking-[0.14em] text-me-ochre">
              往来记录
            </p>
            <ContactTimeline
              key={row.contactId}
              refreshKey={timelineKey}
              clientId={clientId}
              contactId={row.contactId}
              onSummary={onSummary}
              dialedAt={dialedAt}
              collapsible
            />
          </div>

          {/* 回复框放在往来记录之后（先读后回，跟聊天类产品一样）：原来它在上面，一个空的邮件回复框就有 320 像素高，
              把往来记录整个顶到屏幕下面（PM 2026-10-14 好用性调整）。 */}
          <div className="mt-5 space-y-3 empty:hidden" data-testid="drawer-replies">
          {/* 通话后选模板发邮件：功能没开通 / 没有模板时什么都不渲染，容器照样是空的。 */}
          <PostCallEmailBar
            key={row.contactId}
            clientId={clientId}
            contactId={row.contactId}
            dialedAt={dialedAt}
            onSent={() => {
              setTimelineKey((k) => k + 1)
              onSaved('✓ 邮件已发出', false)
            }}
          />
          {/* 在这一页直接回私信 —— 没有私信线的人这里什么都不渲染。
              110 位 CTS 客人只有 Facebook 身份，卡上写着「只能在 Messenger
              回他」，之前却要跳去另一个页面才回得了。 */}
          <MessengerReply
            clientId={clientId}
            contactId={row.contactId}
            customerName={row.name}
            viewerEmail={viewerEmail}
            phone={row.phoneUnusable ? null : row.phone}
            email={row.email}
            onSent={() => {
              setTimelineKey((k) => k + 1)
              onSaved('✓ 私信已发出', false)
            }}
          />

          {/* WhatsApp 那条线（2026-09-28）。整个 WhatsApp 方案的前提是「客人在
              WhatsApp 说话、顾问在 ME 里回」，而在这一块之前 ME 里根本没有能回
              WhatsApp 的地方 —— 顾问只能用自己手机回，那条线系统完全看不见，
              于是天天误报「这个客人没人跟进」。跟上下两块一样自判断：
              没有 WhatsApp 会话就什么都不渲染。 */}
          <WhatsAppReply
            clientId={clientId}
            contactId={row.contactId}
            customerName={row.name}
            viewerEmail={viewerEmail}
            phone={row.phoneUnusable ? null : row.phone}
            email={row.email}
            onSent={(kind) => {
              setTimelineKey((k) => k + 1)
              onSaved(kind === 'approved' ? '✓ 已批准，系统正在发送' : '✓ WhatsApp 已发出', false)
            }}
          />

          {/* 同一个人可能既有私信线又有邮件线（换过渠道联系）—— 两块各自判断
              有没有对应的会话，都没有就都不渲染，不会显示空的入口。 */}
          <EmailReply
            clientId={clientId}
            contactId={row.contactId}
            customerName={row.name}
            viewerEmail={viewerEmail}
            onSent={() => {
              setTimelineKey((k) => k + 1)
              onSaved('✓ 邮件已发出', false)
            }}
          />
          {/* 没有邮件往来的人：EmailReply 什么都不渲染，这里补「写第一封」。两者互斥，判断在服务端。 */}
          <ComposeEmail
            clientId={clientId}
            contactId={row.contactId}
            onSent={() => {
              setTimelineKey((k) => k + 1)
              onSaved('✓ 邮件已发出', false)
            }}
          />
          </div>
        </div>
      </aside>
    </>
  )
}

function CopyEmailButton({ email }: { email: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(email)
          .then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          })
          .catch(() => undefined)
      }}
      className="rounded-lg border border-me-stone bg-white px-3 py-2 text-xs font-semibold text-me-charcoal/70"
    >
      {copied ? '已复制' : '复制'}
    </button>
  )
}
