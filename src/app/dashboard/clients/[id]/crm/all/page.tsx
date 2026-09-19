'use client'

/**
 * 全部客人 —— 一张横表，一行一个客人，点一行就地展开这个人的全渠道往来记录，
 * 能顺手记一笔、改跟进到哪一步。区别于「今天要联系」（只显示今天该打的人）：
 * 这页是「翻看所有人 / 客户打回来了要查这是谁」用的。
 *
 * 交互照抄 admin/prospecting：<table> + expandedId + 点行 toggleDetail 展开一块
 * 详情行。文案照 crm/page.tsx（今天那页）的大白话口径，记一笔直接复用 ComposeNote。
 *
 * 板桥定的几条落地：进线时间显示真实首条触点（后端已算）不是导入日期；状态拆成
 * 「跟进到哪步」+「现在冷热」两列；每个空格填人话绝不留白；顶部搜索 + 表头排序 +
 * 总数；渠道/方向标签带 fallback（DB 加新枚举前端不炸）。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { CrmTabs } from '../_components/CrmTabs'
import { ComposeNote, type StageOption } from '../_components/ComposeNote'
import { DncBanner } from '../_components/DncBanner'

/**
 * New Asian Logistics——同一个字面量在 `nal-messenger-lead-sync-run.ts`/
 * `nal-mark-won/route.ts` 各自声明一份是既有惯例（跟 CTS_CLIENT_ID 一样）。
 * 只有这一个客户在工作台里把联系人标"已成交"会顺带触发回传 Meta 广告转化 API——
 * 见 `nal-crm-won-to-capi-design-v1.md`：CTS 的成交回传走的是另一条独立通道
 * （Google 表格同步），不能让这里的改动波及它。
 */
const NAL_CLIENT_ID = '4ae76381-cd45-43bd-85cd-98cfd7604007'

/**
 * NAL 专属：标已成交时弹出的金额/到账日期录入。
 *
 * 幂等键在挂载时生成一次、整个提交生命周期复用（照抄 `ComposeNote` 同一个理由：
 * 双击/网络重试要复用同一个键，在点击那一刻才生成的话每次点击都是新键，
 * 重复提交就挡不住了）。
 */
function MarkWonPanel({
  contactId,
  onDone,
  onCancel,
}: {
  contactId: string
  /** 第二个参数 = 要不要顺手重拉列表；失败时传 false。 */
  onDone: (msg: string, reload?: boolean) => void
  onCancel: () => void
}) {
  const [amount, setAmount] = useState('')
  const [occurredAt, setOccurredAt] = useState(() => new Date().toISOString().slice(0, 10))
  const [busy, setBusy] = useState(false)
  const [idempotencyKey] = useState(() => crypto.randomUUID())

  const submit = async () => {
    const amountMajor = Number(amount)
    if (!amountMajor || amountMajor <= 0) {
      onDone('请填一个大于 0 的金额', false)
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/admin/conversions/nal-mark-won', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactId,
          amountMajor,
          occurredAt: new Date(occurredAt).toISOString(),
          idempotencyKey,
        }),
      })
      const body = (await res.json()) as { message?: string; error?: string }
      if (!res.ok) {
        onDone(`没记上：${body.error ?? '出错了'}`, false)
        return
      }
      onDone(body.message ?? '记好了', true)
    } catch {
      onDone('没记上，再试一次', false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-me-ochre/25 bg-me-gold/10 p-3" onClick={(e) => e.stopPropagation()}>
      <div className="text-xs font-bold text-me-charcoal">这笔生意多少钱？（到账后再回传给广告平台）</div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <span className="text-xs text-me-charcoal/50">NZD $</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="金额"
            className="w-28 rounded-lg border border-me-stone bg-white px-2 py-1.5 text-sm text-me-charcoal focus:border-me-ochre focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-me-charcoal/50">到账日期</span>
          <input
            type="date"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
            className="rounded-lg border border-me-stone bg-white px-2 py-1.5 text-sm text-me-charcoal focus:border-me-ochre focus:outline-none"
          />
        </div>
        <button
          disabled={busy}
          onClick={() => void submit()}
          className="rounded-lg bg-me-charcoal px-3 py-1.5 text-xs font-black text-white disabled:opacity-50"
        >
          {busy ? '记录中…' : '确认已成交'}
        </button>
        <button onClick={onCancel} className="rounded-lg border border-me-stone px-3 py-1.5 text-xs font-semibold text-me-charcoal">
          取消
        </button>
      </div>
    </div>
  )
}

interface ContactRow {
  contactId: string
  name: string
  firstSeenAt: string
  lastTouchAt: string | null
  phone: string | null
  /** 号码在库里但打不通 —— 跟「今天该联系谁」那一页说同一件事。 */
  phoneUnusable?: boolean
  /** 被标成「别再联系」—— 展开里给一条取消的路（见 DncBanner）。 */
  doNotContact?: boolean
  email: string | null
  hasMessenger: boolean
  stage: string | null
  stageLabel: string | null
  segment: string
  segmentLabel: string
  temperature: 'hot' | 'warm' | 'cold' | 'off'
  custom: Record<string, string | null>
}

interface CustomColumnMeta {
  key: string
  label: string
}

type TimelineEntry =
  | {
      kind: 'touch'
      at: string
      channel: string
      direction: 'inbound' | 'outbound'
      summary: string | null
      tour: string | null
      outcome: string | null
      travelWindow: string | null
      callbackAt: string | null
      competitor: string | null
    }
  | {
      kind: 'message'
      at: string
      direction: 'inbound' | 'outbound'
      senderName: string | null
      body: string
    }
  | {
      kind: 'stage'
      at: string
      fromStage: string | null
      toStage: string | null
      fromLabel: string | null
      toLabel: string | null
      changedBy: string | null
      note: string | null
    }

// 渠道 / 方向标签一律带 fallback：DB 先加第 7 个渠道、前端没跟上时显示原值，不炸。
const CHANNEL_LABEL: Record<string, string> = {
  meta_lead_form: 'FB 表单',
  phone: '电话',
  email: '邮件',
  messenger: '私信',
  web_form: '官网表单',
  whatsapp: 'WhatsApp',
}
const DIRECTION_LABEL: Record<string, string> = {
  inbound: '客户来找的',
  outbound: '我联系的',
}
const OUTCOME_LABEL: Record<string, string> = {
  no_answer: '没接通',
  bad_number: '号码不通',
  do_not_contact: '别再联系',
  not_interested: '没兴趣',
  // 少了这一条，「暂时不考虑」这个结论在时间线上完全不显示 ——
  // 软硬拒绝分开这件事，在最主要的翻查视图里就等于没做。
  not_interested_now: '暂时不考虑',
  spoke: '聊上了',
  callback_set: '约了回电',
}

// 冷热上色：烫的标红、温的标赭、冷的中性、已结论的灰。
const TEMP_CLS: Record<ContactRow['temperature'], string> = {
  hot: 'bg-[#C2453A]/12 text-[#C2453A]',
  warm: 'bg-me-ochre/12 text-me-ochre',
  cold: 'bg-me-ivory text-me-charcoal/55',
  off: 'bg-me-charcoal/5 text-me-charcoal/45',
}

function ts(v: string | null | undefined): number {
  if (!v) return 0
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? 0 : t
}

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' })
}

/** 「今天 / 昨天 / 3天前 / 7/2」—— 最近联系用相对时间，不是干日期。 */
function relTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return '今天'
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000)
  if (days === 1) return '昨天'
  if (days >= 2 && days < 30) return `${days}天前`
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

/** 一条时间线条目（触点 / 阶段流转）。 */
function TimelineItem({ e }: { e: TimelineEntry }) {
  if (e.kind === 'stage') {
    return (
      <li className="flex gap-3">
        <span className="mt-0.5 shrink-0 text-xs text-me-charcoal/35">{relTime(e.at)}</span>
        <div className="min-w-0 text-sm text-me-charcoal/70">
          <span className="rounded bg-me-ochre/12 px-1.5 py-0.5 text-xs font-bold text-me-ochre">改了跟进阶段</span>
          <span className="ml-2">
            {e.fromLabel ?? '还没标'} → <span className="font-semibold text-me-charcoal">{e.toLabel ?? '—'}</span>
          </span>
          {e.note && <span className="ml-2 text-me-charcoal/45">· {e.note}</span>}
        </div>
      </li>
    )
  }
  if (e.kind === 'message') {
    // 私信 / 邮件原文。方向决定气泡:入站=客人(白底),出站=我们(灰底)。
    // sender 名放前面,一眼知道谁说的,系统自动回复(出站)也不会被当成客人的话。
    const inbound = e.direction === 'inbound'
    return (
      <li className="flex gap-3">
        <span className="mt-1 shrink-0 text-xs text-me-charcoal/35">{relTime(e.at)}</span>
        <div className={`min-w-0 flex-1 ${inbound ? '' : 'flex justify-end'}`}>
          <div
            className={`inline-block max-w-[85%] rounded-2xl px-3 py-1.5 text-sm leading-relaxed ${
              inbound ? 'bg-white text-me-charcoal ring-1 ring-black/5' : 'bg-me-charcoal/5 text-me-charcoal/80'
            }`}
          >
            <span className="mr-1.5 text-[11px] font-bold text-me-charcoal/45">
              {inbound ? e.senderName || '客户' : e.senderName || '我们'}
            </span>
            <span className="whitespace-pre-wrap break-words">{e.body}</span>
          </div>
        </div>
      </li>
    )
  }
  const badge = (text: string) => (
    <span className="rounded bg-white px-1.5 py-0.5 text-[11px] font-semibold text-me-charcoal/60 ring-1 ring-black/5">
      {text}
    </span>
  )
  const outcomeLabel = e.outcome ? OUTCOME_LABEL[e.outcome] : null
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 shrink-0 text-xs text-me-charcoal/35">{relTime(e.at)}</span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-bold text-me-charcoal/70">{DIRECTION_LABEL[e.direction] ?? e.direction}</span>
          <span className="text-xs text-me-charcoal/40">·</span>
          <span className="text-xs text-me-charcoal/50">{CHANNEL_LABEL[e.channel] ?? e.channel}</span>
          {outcomeLabel && badge(outcomeLabel)}
          {e.tour && badge(`团：${e.tour}`)}
          {e.travelWindow && badge(`想去：${e.travelWindow}`)}
          {e.callbackAt && badge(`约回电：${fmtDate(e.callbackAt)}`)}
          {e.competitor && badge(`提到：${e.competitor}`)}
        </div>
        {e.summary && <p className="mt-0.5 text-sm leading-relaxed text-me-charcoal/75">{e.summary}</p>}
      </div>
    </li>
  )
}

/** 展开区：往来时间线 + 记一笔 + 改状态。一次只有一行展开。 */
function ContactDetail({
  clientId,
  row,
  stages,
  timeline,
  omitted,
  loading,
  onWrote,
}: {
  clientId: string
  row: ContactRow
  stages: StageOption[]
  timeline: TimelineEntry[] | null
  omitted: number
  loading: boolean
  /** 第二个参数 = 要不要顺手重拉列表；失败时传 false。 */
  onWrote: (msg: string, reload?: boolean) => void
}) {
  const [composing, setComposing] = useState(false)
  const [changingStage, setChangingStage] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [markingWon, setMarkingWon] = useState(false)

  const changeStage = async (toStage: string, label: string) => {
    if (!window.confirm(`现在：${row.stageLabel ?? '还没标到哪一步'} → 改成「${label}」？`)) return
    setChangingStage(false)
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/contacts/${row.contactId}/stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toStage }),
      })
      if (!res.ok) throw new Error()
      onWrote('✓ 改好了')
    } catch {
      onWrote('没改上，再试一次')
    }
  }

  const shown = timeline ? (showAll ? timeline : timeline.slice(0, 5)) : []
  const hidden = timeline ? timeline.length - shown.length : 0

  return (
    <div className="space-y-4">
      {/* 联系方式 —— 展开里再给一次，方便直接拨号/发信 */}
      <div className="flex flex-wrap gap-2">
        {/* 号码打不通就不给拨号链接 —— 号码照旧显示（要改号得先看得见），
            但点不动。两个 CRM 入口必须说同一件事，否则销售两边都不再信。 */}
        {row.phone && row.phoneUnusable && (
          <span className="rounded-lg border border-me-stone bg-black/[0.04] px-3 py-1.5 text-sm font-semibold text-me-charcoal/45 line-through">
            📞 {row.phone}
          </span>
        )}
        {row.phone && row.phoneUnusable && (
          <span className="w-full text-xs font-semibold text-me-charcoal/55">
            ⚠️ 这个号打不通 —— 用邮件 / 私信联系，顺便问他要个新号
          </span>
        )}
        {row.phone && !row.phoneUnusable && (
          <a href={`tel:${row.phone}`} className="rounded-lg border border-me-stone px-3 py-1.5 text-sm font-semibold text-me-charcoal">
            📞 {row.phone}
          </a>
        )}
        {row.email && (
          <a href={`mailto:${row.email}`} className="break-all rounded-lg border border-me-stone px-3 py-1.5 text-sm font-semibold text-me-charcoal">
            ✉️ {row.email}
          </a>
        )}
        {/* 「可能被误判成永久拒联」那条人工任务的 href 就落在这一页 ——
            控件必须在这里，不然 FDE 照着任务点进来会找不到任务里说的按钮。 */}
        {row.doNotContact && (
          <DncBanner
            clientId={clientId}
            contactId={row.contactId}
            name={row.name}
            onSaved={onWrote}
          />
        )}
      </div>

      {/* 往来时间线 */}
      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-me-charcoal/40">往来记录</p>
        {loading && <p className="text-sm text-me-charcoal/40">加载中…</p>}
        {!loading && timeline && timeline.length === 0 && omitted === 0 && (
          <p className="text-sm text-me-charcoal/45">还没有任何往来记录 —— 打完 / 聊完顺手在下面记一笔。</p>
        )}
        {!loading && timeline && timeline.length > 0 && (
          <>
            <ul className="space-y-2.5">
              {shown.map((e, i) => (
                <TimelineItem key={i} e={e} />
              ))}
            </ul>
            {hidden > 0 && (
              <button
                onClick={() => setShowAll(true)}
                className="mt-2 text-xs font-bold text-me-charcoal/55 hover:text-me-charcoal"
              >
                看更早的 {hidden} 条 ↓
              </button>
            )}
          </>
        )}
        {!loading && omitted > 0 && (
          <p className="mt-2 text-xs text-me-charcoal/40">另有 {omitted} 条图片 / 表情 / 附件没显示。</p>
        )}
      </div>

      {/* 记一笔 + 改状态 */}
      <div className="flex flex-wrap items-center gap-2 border-t border-black/5 pt-3">
        {!composing && (
          <button
            onClick={() => setComposing(true)}
            className="rounded-lg bg-me-charcoal px-4 py-2 text-sm font-black text-white"
          >
            记一笔
          </button>
        )}
        {stages.length > 0 && (
          <button
            onClick={() => setChangingStage((v) => !v)}
            className="rounded-full border border-black/10 px-3 py-1.5 text-xs font-semibold text-me-charcoal/60"
          >
            跟进到哪步：{row.stageLabel ?? '还没标'}
          </button>
        )}
      </div>

      {changingStage && (
        <div className="flex flex-wrap gap-1.5">
          {stages
            .filter((s) => s.stageKey !== row.stage)
            .map((s) => (
              <button
                key={s.stageKey}
                onClick={() => {
                  // NAL + "已成交"档：不是简单改个状态字，还要录金额、顺带回传
                  // 广告平台——弹金额面板，不走普通的"改到哪步"确认框。
                  // 见 nal-crm-won-to-capi-design-v1.md：只对 NAL 生效，CTS 走
                  // 另一条独立的成交回传通道（Google 表格同步），不能碰这里。
                  if (clientId === NAL_CLIENT_ID && s.marketingAction === 'won') {
                    setChangingStage(false)
                    setMarkingWon(true)
                    return
                  }
                  void changeStage(s.stageKey, s.label)
                }}
                className="rounded-full bg-me-ivory px-3 py-1.5 text-xs font-bold text-me-charcoal"
              >
                {s.label}
              </button>
            ))}
        </div>
      )}

      {markingWon && (
        <MarkWonPanel
          contactId={row.contactId}
          onCancel={() => setMarkingWon(false)}
          onDone={(msg, reload) => {
            setMarkingWon(false)
            onWrote(msg, reload)
          }}
        />
      )}

      {composing && (
        <ComposeNote
          clientId={clientId}
          row={{ contactId: row.contactId, stage: row.stage }}
          stages={stages}
          onCancel={() => setComposing(false)}
          onDone={(msg) => {
            setComposing(false)
            onWrote(msg)
          }}
        />
      )}
    </div>
  )
}

export default function CrmAllContactsPage() {
  const params = useParams()
  const clientId = params.id as string

  const [rows, setRows] = useState<ContactRow[]>([])
  const [columns, setColumns] = useState<CustomColumnMeta[]>([])
  const [total, setTotal] = useState(0)
  const [stages, setStages] = useState<StageOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const [q, setQ] = useState('')
  const [sortKey, setSortKey] = useState<'firstSeenAt' | 'lastTouchAt'>('lastTouchAt')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [timeline, setTimeline] = useState<TimelineEntry[] | null>(null)
  const [timelineOmitted, setTimelineOmitted] = useState(0)
  const [timelineLoading, setTimelineLoading] = useState(false)
  // 防乱序：快速点开 A 又点开 B 时，A 的时间线不能盖到 B 底下。
  const timelineReqRef = useRef<string | null>(null)

  const loadList = useCallback(async () => {
    setError(null)
    try {
      const [res, stageRes] = await Promise.all([
        fetch(`/api/clients/${clientId}/crm/contacts`),
        fetch(`/api/clients/${clientId}/pipeline-stages`),
      ])
      const json = (await res.json()) as {
        contacts?: ContactRow[]
        columns?: CustomColumnMeta[]
        totalContacts?: number
        error?: string
      }
      if (!res.ok) {
        setError(json.error ?? '加载失败')
        return
      }
      setRows(json.contacts ?? [])
      setColumns(json.columns ?? [])
      setTotal(json.totalContacts ?? 0)
      if (stageRes.ok) {
        const s = (await stageRes.json()) as { stages?: StageOption[] }
        // marketingAction 之前被这里的映射漏掉了——NAL"标已成交"要靠它判断该弹
        // 金额面板还是走普通改状态，没有它这条判断永远是 false（2026-09-15 修）。
        setStages(
          (s.stages ?? []).map((x) => ({ stageKey: x.stageKey, label: x.label, marketingAction: x.marketingAction })),
        )
      }
    } catch {
      setError('加载失败，检查网络后再试。')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => {
    void loadList()
  }, [loadList])

  const loadTimeline = useCallback(
    async (contactId: string) => {
      setTimeline(null)
      setTimelineOmitted(0)
      setTimelineLoading(true)
      timelineReqRef.current = contactId
      try {
        const res = await fetch(`/api/clients/${clientId}/crm/contacts/${contactId}/timeline`)
        const json = (await res.json()) as { timeline?: TimelineEntry[]; omittedMessages?: number }
        if (timelineReqRef.current !== contactId) return
        setTimeline(res.ok ? (json.timeline ?? []) : [])
        setTimelineOmitted(res.ok ? (json.omittedMessages ?? 0) : 0)
      } catch {
        if (timelineReqRef.current === contactId) setTimeline([])
      } finally {
        if (timelineReqRef.current === contactId) setTimelineLoading(false)
      }
    },
    [clientId],
  )

  /**
   * 直达链接 `?contact=<id>` —— 列表加载完自动展开那个人并滚过去。
   *
   * 🔴 今日待办的人工任务靠这个才算「直达」（Codex 复审 2026-08-16）。原先这页
   * 根本不读这个参数，点进来只是打开整张 583 行的表，FDE 还得自己搜名字 ——
   * 那不叫直达，那叫「我给了你一个入口，剩下你自己找」。
   *
   * 只认一次：认完就清掉，之后同事点谁就是谁，不会被链接拽回去。
   * 用 `window.location.search` 而不是 `useSearchParams`，免得为一个可选参数
   * 给整页套 Suspense 边界。
   */
  const [deepLinkId, setDeepLinkId] = useState<string | null>(null)
  useEffect(() => {
    setDeepLinkId(new URLSearchParams(window.location.search).get('contact'))
  }, [])

  useEffect(() => {
    if (!deepLinkId || rows.length === 0) return
    setDeepLinkId(null)
    // 这个人不在表里（换客户了 / 记录被删）——**必须说出来**，
    // 否则页面一声不吭，FDE 只会以为链接坏了。
    if (!rows.some((r) => r.contactId === deepLinkId)) {
      setToast('这个人不在这份名单里了 —— 用上面的搜索框找找看')
      window.setTimeout(() => setToast(null), 4000)
      return
    }
    setExpandedId(deepLinkId)
    void loadTimeline(deepLinkId)
    // 展开那一行渲染完再滚 —— 直接滚会停在旧位置。
    window.setTimeout(() => {
      document.getElementById(`contact-${deepLinkId}`)?.scrollIntoView({ block: 'center' })
    }, 120)
  }, [deepLinkId, rows, loadTimeline])

  const toggleDetail = (contactId: string) => {
    if (expandedId === contactId) {
      setExpandedId(null)
      setTimeline(null)
      timelineReqRef.current = null
      return
    }
    setExpandedId(contactId)
    void loadTimeline(contactId)
  }

  // 写完（记一笔 / 改阶段）后：刷新列表拿到最新冷热/阶段/最近联系，并重拉这个人的
  // 时间线；保持展开不收起，同事不丢位置。
  /**
   * 写完（记一笔 / 改阶段 / 取消别再联系）之后。
   *
   * 🔴 `reload` 必须一路传到这里（Codex 复审 2026-08-16）。取消「别再联系」
   * 那一步是**两步写**：触点先写、镜像列后放。第二步失败时接口回 500，
   * 但触点已经落库了 —— 这时候若照旧重拉列表，判据会算出「他不是拒联了」，
   * 黄条和重试按钮当场消失，而镜像列还是 true。人看到一句「没改上」，
   * 却连再点一次的地方都没有了。失败就别刷新，把按钮留在原地。
   */
  const afterWrite = (msg: string, reload = true) => {
    setToast(msg)
    if (reload) {
      void loadList()
      if (expandedId) void loadTimeline(expandedId)
    }
    window.setTimeout(() => setToast(null), 2400)
  }

  const toggleSort = (key: 'firstSeenAt' | 'lastTouchAt') => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const kw = q.trim().toLowerCase()
  const filtered = kw
    ? rows.filter(
        (r) =>
          r.name.toLowerCase().includes(kw) ||
          (r.phone ?? '').replace(/\s/g, '').includes(kw.replace(/\s/g, '')) ||
          (r.email ?? '').toLowerCase().includes(kw),
      )
    : rows
  const sorted = [...filtered].sort((a, b) => {
    const av = sortKey === 'firstSeenAt' ? ts(a.firstSeenAt) : ts(a.lastTouchAt)
    const bv = sortKey === 'firstSeenAt' ? ts(b.firstSeenAt) : ts(b.lastTouchAt)
    return sortDir === 'desc' ? bv - av : av - bv
  })

  const colCount = 6 + columns.length
  const sortArrow = (key: 'firstSeenAt' | 'lastTouchAt') =>
    sortKey === key ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <div>
        <Link href={`/dashboard/clients/${clientId}`} className="text-sm text-me-charcoal/40 hover:text-me-charcoal">
          ← 返回客户
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-black text-me-charcoal">全部客人</h1>
          <CrmTabs clientId={clientId} active="all" />
        </div>
        <p className="mt-1 text-sm text-me-charcoal/45">
          翻看所有人、查某个客人的来往记录。想知道今天该打谁，点上面「今天要联系」。
        </p>
      </div>

      {toast && (
        <div className="sticky top-2 z-10 rounded-xl bg-me-charcoal px-4 py-2 text-center text-sm font-black text-white">
          {toast}
        </div>
      )}

      {loading && rows.length === 0 && <p className="py-16 text-center text-sm text-me-charcoal/40">加载中…</p>}

      {error && (
        <div className="rounded-xl border border-[#C2453A]/30 bg-[#C2453A]/8 p-4">
          <p className="text-sm font-semibold text-[#C2453A]">{error}</p>
          <button onClick={() => void loadList()} className="mt-2 text-sm font-black text-me-charcoal underline">
            重试
          </button>
        </div>
      )}

      {!error && !loading && (
        <>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="🔍 客户打回来了？按名字 / 电话 / 邮箱找他"
            className="w-full rounded-xl border border-black/10 bg-white px-4 py-2.5 text-sm focus:border-me-charcoal focus:outline-none"
          />

          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-me-charcoal/50">
              {kw ? `找到 ${sorted.length} 人` : `共 ${total} 位客人`}
            </p>
          </div>

          {/* 刚搬过来时安抚一句，别让「全空的跟进阶段」像没做完的作业 */}
          {total > 0 && rows.every((r) => !r.stage) && (
            <p className="rounded-lg bg-me-ivory px-3 py-2 text-xs leading-relaxed text-me-charcoal/55">
              刚搬过来，大家的「跟进到哪步」都还空着 —— 聊完顺手标一下就行，不用一次标完。右边「现在冷热」是系统自动算的，现在就能用。
            </p>
          )}

          <div className="overflow-x-auto rounded-xl border border-me-charcoal/10 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-me-charcoal/10 text-left text-xs text-me-charcoal/50">
                  <th className="px-4 py-3">客人</th>
                  <th className="cursor-pointer select-none px-4 py-3" onClick={() => toggleSort('firstSeenAt')}>
                    进线时间{sortArrow('firstSeenAt')}
                  </th>
                  <th className="cursor-pointer select-none px-4 py-3" onClick={() => toggleSort('lastTouchAt')}>
                    最近联系{sortArrow('lastTouchAt')}
                  </th>
                  <th className="px-4 py-3">联系方式</th>
                  {columns.map((c) => (
                    <th key={c.key} className="px-4 py-3">{c.label}</th>
                  ))}
                  <th className="px-4 py-3">跟进到哪步</th>
                  <th className="px-4 py-3">现在冷热</th>
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={colCount} className="px-4 py-10 text-center text-me-charcoal/40">
                      {kw ? '没找到这个人。' : '还没有客人。'}
                    </td>
                  </tr>
                )}
                {sorted.map((r) => {
                  const expanded = expandedId === r.contactId
                  const contactCell =
                    r.phone || r.email ? (
                      <span className="text-me-charcoal/70">{r.phone ?? r.email}</span>
                    ) : r.hasMessenger ? (
                      <span className="text-me-charcoal/45">仅 FB 私信</span>
                    ) : (
                      <span className="text-me-charcoal/35">没留联系方式</span>
                    )
                  return [
                    <tr
                      key={r.contactId}
                      // 直达链接靠它定位（?contact=<id> 展开后滚到这一行）
                      id={`contact-${r.contactId}`}
                      onClick={() => toggleDetail(r.contactId)}
                      className={`border-b border-me-charcoal/5 cursor-pointer hover:bg-me-ivory/40 ${expanded ? 'bg-me-ivory/50' : ''}`}
                    >
                      <td className="px-4 py-3 font-medium text-me-charcoal">{r.name}</td>
                      <td className="px-4 py-3 text-me-charcoal/60">{fmtDate(r.firstSeenAt)}</td>
                      <td className="px-4 py-3 text-me-charcoal/60">
                        {r.lastTouchAt ? relTime(r.lastTouchAt) : <span className="text-me-charcoal/35">还没联系过</span>}
                      </td>
                      <td className="px-4 py-3">{contactCell}</td>
                      {columns.map((c) => (
                        <td key={c.key} className="px-4 py-3 text-me-charcoal/60">
                          {r.custom[c.key] ?? <span className="text-me-charcoal/35">还没聊到</span>}
                        </td>
                      ))}
                      <td className="px-4 py-3">
                        {r.stageLabel ? (
                          <span className="text-me-charcoal/70">{r.stageLabel}</span>
                        ) : (
                          <span className="text-me-charcoal/35">还没标</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs ${TEMP_CLS[r.temperature]}`}>
                          {r.segmentLabel}
                        </span>
                      </td>
                    </tr>,
                    expanded && (
                      <tr key={`${r.contactId}-detail`} className="border-b border-me-charcoal/5 bg-me-ivory/30">
                        <td colSpan={colCount} className="px-6 py-4">
                          <ContactDetail
                            clientId={clientId}
                            row={r}
                            stages={stages}
                            timeline={timeline}
                            omitted={timelineOmitted}
                            loading={timelineLoading}
                            onWrote={afterWrite}
                          />
                        </td>
                      </tr>
                    ),
                  ]
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
