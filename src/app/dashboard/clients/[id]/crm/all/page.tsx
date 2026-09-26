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
import { TimelineItem } from './_components/TimelineItem'
import { PrioritySectionHeader } from './_components/PrioritySection'
import {
  CHANNEL_LABEL,
  DIRECTION_LABEL,
  OUTCOME_LABEL,
  TEMP_CLS,
  fmtDate,
  relTime,
  ts,
  type ContactRow,
  type CustomColumnMeta,
  type TimelineEntry,
} from './_components/contact-table-types'

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

/**
 * 「⭐置顶」附带的原因 + 到期日编辑。
 *
 * 星本身（pinned_at）在表格那一列直接点，这里只管"标了什么"和"到什么时候"——
 * 对应员工老表 R/S 列的红字。受控 state，按「保存」才落库，不是每敲一个字发一次。
 */
function ImportantMarkerEditor({
  clientId,
  row,
  onSaved,
}: {
  clientId: string
  row: ContactRow
  onSaved: (msg: string) => void
}) {
  const [note, setNote] = useState(row.important?.note ?? '')
  const [dueDate, setDueDate] = useState(row.important?.dueAt ? row.important.dueAt.slice(0, 10) : '')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      const body: { note: string | null; dueAt: string | null } = {
        note: note.trim() === '' ? null : note.trim(),
        // 空 = 清空；非空 date → 当天 12:00 本地时区当作截止时刻（员工只想标一天，不写具体时间）
        dueAt: dueDate === '' ? null : new Date(`${dueDate}T12:00:00`).toISOString(),
      }
      const res = await fetch(`/api/clients/${clientId}/crm/contacts/${row.contactId}/important`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error()
      onSaved('✓ 存好了')
    } catch {
      onSaved('没存上，再试一次')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-me-charcoal/10 bg-me-ivory p-3">
      <div className="text-xs font-bold text-me-charcoal/60">
        ⭐ 重要标记（选填）—— 员工老表 R/S 列的红字放这里
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="约好周三 3 点回电 / 只发邮件不打电话 / ..."
        maxLength={500}
        rows={2}
        className="w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm focus:border-me-charcoal focus:outline-none"
      />
      <div className="flex items-center gap-2 text-sm">
        <span className="text-xs text-me-charcoal/50">到期：</span>
        <input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="rounded-lg border border-black/10 bg-white px-2 py-1 text-sm"
        />
        {dueDate && (
          <button
            type="button"
            onClick={() => setDueDate('')}
            className="text-xs text-me-charcoal/40 hover:text-me-charcoal"
          >
            清除日期
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="ml-auto rounded-lg bg-me-charcoal px-3 py-1 text-xs font-black text-white disabled:opacity-40"
        >
          {busy ? '存中…' : '保存'}
        </button>
      </div>
    </div>
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
      {/* 重要标记放最上面 —— 员工打开抽屉第一眼就该看到"红字"，跟老表习惯一致。 */}
      <ImportantMarkerEditor clientId={clientId} row={row} onSaved={(msg) => onWrote(msg, true)} />

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

type SectionKey = 'waiting' | 'acted' | 'queued' | 'off_list'
interface PrioritySectionData {
  key: SectionKey
  title: string
  hint: string
  total: number
  open: boolean
  page: number
  items: ContactRow[] | null
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
  // 只有防抖后的值进 API —— 否则每敲一个字都打一次请求。
  const [qDebounced, setQDebounced] = useState('')
  // 服务端拒绝 q 里的逗号/括号（PostgREST or() 语法），单独一条提示，不覆盖整页错误。
  const [qError, setQError] = useState<string | null>(null)
  const [stageFilter, setStageFilter] = useState<string[]>([])
  const [page, setPage] = useState(1)
  // C1a 固定 100，先不给改每页条数的入口。
  const [perPage] = useState(100)
  const [sortKey, setSortKey] = useState<'firstSeenAt' | 'lastTouchAt'>('lastTouchAt')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  /**
   * 平铺 / 按优先级分段。默认平铺 —— 这一轮先把分段做出来给人看，
   * 不动任何老用户打开这一页时看到的东西。
   */
  const [grouped, setGrouped] = useState(false)
  const [sections, setSections] = useState<PrioritySectionData[]>([])
  /** 展开哪些段。null = 还没动过，用服务端默认（前两段展开）。 */
  const [openSections, setOpenSections] = useState<SectionKey[] | null>(null)
  /**
   * 每段看到第几页。服务端一段只下发 100 行（`?p_<段>=2` 取下一页）。
   *
   * 🔴 没有这个的那一版：段头写「217 人」、表里只有 100 行、**没有任何入口能看到
   * 剩下 117 个人**。子牙和魏征两边独立判为 BLOCKER，形状跟 2026-08-02
   * 「33 个人从名单上凭空消失」完全一样 —— 人数对、人不在。
   * 服务端 `?p_<段>` 早就收了，只是前端一次都没发过。
   */
  const [sectionPages, setSectionPages] = useState<Partial<Record<SectionKey, number>>>({})
  /** 分段那次请求正在飞 —— 点开一段到数据回来之间要有话说，不能白茫茫一片（魏征 C2）。 */
  const [sectionsLoading, setSectionsLoading] = useState(false)
  /**
   * `?contact=` 只认第一次。
   *
   * 不锁的那一版：每次分段请求都重新读 URL，于是服务端每次都回 focus、
   * 页面每次都把那一段弹回展开 —— 用户**关不掉它**，还每次白跑一遍
   * 「整批拉 1010 人 + 5k 条触点」（魏征 C1 实测）。
   */
  const focusUsedRef = useRef(false)

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [timeline, setTimeline] = useState<TimelineEntry[] | null>(null)
  const [timelineOmitted, setTimelineOmitted] = useState(0)
  const [timelineLoading, setTimelineLoading] = useState(false)
  // 防乱序：快速点开 A 又点开 B 时，A 的时间线不能盖到 B 底下。
  const timelineReqRef = useRef<string | null>(null)

  const loadList = useCallback(async () => {
    setError(null)
    try {
      const params = new URLSearchParams()
      if (grouped) {
        setSectionsLoading(true)
        params.set('view', 'priority')
        if (qDebounced.trim()) params.set('q', qDebounced.trim())
        for (const s of stageFilter) params.append('stage', s)
        if (openSections !== null) params.set('open', openSections.join(','))
        for (const [key, p] of Object.entries(sectionPages)) {
          if (typeof p === 'number' && p > 1) params.set(`p_${key}`, String(p))
        }
        if (!focusUsedRef.current) {
          const focusContactId = new URLSearchParams(window.location.search).get('contact')
          if (focusContactId) params.set('contact', focusContactId)
        }
      } else {
        params.set('page', String(page))
        params.set('perPage', String(perPage))
        if (qDebounced.trim()) params.set('q', qDebounced.trim())
        for (const s of stageFilter) params.append('stage', s)
      }

      const [res, stageRes] = await Promise.all([
        fetch(`/api/clients/${clientId}/crm/contacts?${params.toString()}`),
        fetch(`/api/clients/${clientId}/pipeline-stages`),
      ])
      const json = (await res.json()) as {
        total?: number
        columns?: CustomColumnMeta[]
        items?: ContactRow[]
        view?: string
        sections?: PrioritySectionData[]
        focus?: { found: boolean; section?: SectionKey; page?: number }
        error?: string
      }
      if (!res.ok) {
        // 400 是搜索词非法（逗号/括号）—— 只提示搜索框，别把已有名单清空。
        if (res.status === 400) {
          setQError('搜索里不能有逗号或括号')
          return
        }
        setError(json.error ?? '加载失败')
        return
      }
      setQError(null)
      if (json.view === 'priority') {
        const secs = json.sections ?? []
        setSections(secs)
        setColumns(json.columns ?? [])
        setTotal(secs.reduce((n, s) => n + s.total, 0))
        setRows(secs.flatMap((s) => s.items ?? []))
        // 直达链接落在收起来的段里时，把那一段打开 —— 否则点进来什么都看不到。
        if (json.focus?.found && json.focus.section) {
          focusUsedRef.current = true
          const target = json.focus.section
          setOpenSections((prev) => {
            const base = prev ?? secs.filter((s) => s.open).map((s) => s.key)
            return base.includes(target) ? base : [...base, target]
          })
        }
      } else {
        setRows(json.items ?? [])
        setColumns(json.columns ?? [])
        setTotal(json.total ?? 0)
      }
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
      setSectionsLoading(false)
    }
  }, [clientId, page, perPage, qDebounced, stageFilter, grouped, openSections, sectionPages])

  useEffect(() => {
    void loadList()
  }, [loadList])

  // 搜索词防抖：300ms 内还在敲就不发请求。
  useEffect(() => {
    const t = window.setTimeout(() => setQDebounced(q), 300)
    return () => window.clearTimeout(t)
  }, [q])

  // 换了搜索词或筛选条件就回第一页 —— 否则会停在一个可能不存在的页码上。
  useEffect(() => {
    setPage(1)
  }, [qDebounced, stageFilter])

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

  /**
   * 点星星：置顶 / 取消置顶。
   *
   * 先本地改（乐观更新），失败再翻回来并说一句 —— 星星是即时反馈的控件，
   * 等一个来回才变色会让人以为没点上、连点两下。
   */
  const togglePin = async (row: ContactRow) => {
    const next = row.pinnedAt === null
    /**
     * 🔴 两处都要写。
     *
     * 平铺模式的行来自 `rows`，分段模式的行来自 `sections[].items` —— 只写 `rows`
     * 的那一版，在分段模式下点⭐星星永远不亮（PATCH 发出去了、库也改了，页面零反馈）。
     * 星星是即时反馈的控件，不亮就等于「我点了但没成功」。魏征 B3 / 子牙 P0-1 实测。
     */
    const paint = (pinnedAt: string | null) => {
      setRows((prev) =>
        prev.map((r) => (r.contactId === row.contactId ? { ...r, pinnedAt } : r)),
      )
      setSections((prev) =>
        prev.map((sec) => ({
          ...sec,
          items:
            sec.items?.map((r) => (r.contactId === row.contactId ? { ...r, pinnedAt } : r)) ?? null,
        })),
      )
    }
    paint(next ? new Date().toISOString() : null)
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/contacts/${row.contactId}/pin`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned: next }),
      })
      if (!res.ok) throw new Error()
    } catch {
      paint(row.pinnedAt)
      setToast('置顶失败，请重试')
      window.setTimeout(() => setToast(null), 2400)
    }
  }

  const toggleSort = (key: 'firstSeenAt' | 'lastTouchAt') => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  // 搜索交给服务端了，这里只排当前页。
  const sorted = [...rows].sort((a, b) => {
    const av = sortKey === 'firstSeenAt' ? ts(a.firstSeenAt) : ts(a.lastTouchAt)
    const bv = sortKey === 'firstSeenAt' ? ts(b.firstSeenAt) : ts(b.lastTouchAt)
    return sortDir === 'desc' ? bv - av : av - bv
  })

  const colCount = 7 + columns.length
  const sortArrow = (key: 'firstSeenAt' | 'lastTouchAt') =>
    sortKey === key ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''

  /**
   * 这一段现在显示的是第几个到第几个。
   *
   * ⚠️ 服务端是**翻页不是累加**：`list-sections.ts` 用 `bucket.slice(start, start + perPage)`，
   * 所以 `p_<段>=2` 拿到的是第 101–200 个、**第 1–100 个会消失**。
   * 第一版我按「累加」写，按钮叫「再看 100 个」——那会让前 100 个人凭空不见，
   * 正是这一轮要修的那个毛病换个方向再犯一次。查了 slice 才改成老实的翻页。
   */
  const sectionRange = (s: PrioritySectionData): { from: number; to: number; pages: number } => {
    const page = sectionPages[s.key] ?? 1
    const from = s.total === 0 ? 0 : (page - 1) * perPage + 1
    return { from, to: (page - 1) * perPage + (s.items?.length ?? 0), pages: Math.max(1, Math.ceil(s.total / perPage)) }
  }

  /** 这一段翻到第 n 页。改了 sectionPages 会触发 loadList 重新拉。 */
  const goSectionPage = (key: SectionKey, n: number) => {
    setSectionPages((prev) => ({ ...prev, [key]: Math.max(1, n) }))
  }

  const toggleSection = (key: SectionKey) => {
    setOpenSections((prev) => {
      const base = prev ?? sections.filter((s) => s.open).map((s) => s.key)
      return base.includes(key) ? base.filter((k) => k !== key) : [...base, key]
    })
  }

  const renderRow = (r: ContactRow) => {
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
        <td className="px-2 py-3">
          {/* 点星星不能顺带展开抽屉 —— 两个动作是分开的。 */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              void togglePin(r)
            }}
            title={r.pinnedAt ? '取消置顶' : '置顶'}
            aria-label={r.pinnedAt ? '取消置顶' : '置顶'}
            className={`p-1 text-base leading-none ${
              r.pinnedAt ? 'text-yellow-500' : 'text-me-charcoal/40 hover:text-me-charcoal'
            }`}
          >
            {r.pinnedAt ? '⭐' : '☆'}
          </button>
        </td>
        <td className="px-4 py-3 font-medium text-me-charcoal">
          {r.name}
          {r.important?.note && (
            <span
              title={r.important.note}
              className="ml-2 rounded bg-me-gold/20 px-1.5 py-0.5 text-[10px] font-bold text-me-charcoal/70"
            >
              ⭐ {r.important.note.length > 12 ? `${r.important.note.slice(0, 12)}…` : r.important.note}
            </span>
          )}
          {r.important?.dueAt && new Date(r.important.dueAt) < new Date() && (
            <span className="ml-1 rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-bold text-red-600">
              到期
            </span>
          )}
        </td>
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
  }

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

          {qError && <p className="text-xs font-semibold text-[#C2453A]">{qError}</p>}

          {stages.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-me-charcoal/45">跟进到哪步：</span>
              {stages.map((s) => {
                const on = stageFilter.includes(s.stageKey)
                return (
                  <button
                    key={s.stageKey}
                    onClick={() =>
                      setStageFilter((prev) =>
                        on ? prev.filter((k) => k !== s.stageKey) : [...prev, s.stageKey],
                      )
                    }
                    className={`rounded-full border border-black/10 px-3 py-1 text-xs font-semibold ${
                      on ? 'bg-me-charcoal text-white' : 'text-me-charcoal/60'
                    }`}
                  >
                    {s.label}
                  </button>
                )
              })}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setGrouped((v) => !v)}
              className="rounded-lg border border-me-charcoal/15 px-3 py-1.5 text-xs font-bold text-me-charcoal hover:bg-me-ivory"
            >
              {grouped ? '← 回到平铺名单' : '按「先联系谁」分段'}
            </button>
            {grouped && (
              <span className="text-xs text-me-charcoal/45">
                分段是系统按联系记录算的，跟「今天要联系」那一页同一套口径；段内按「该先联系谁」排，点表头不改顺序
              </span>
            )}
          </div>

          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-me-charcoal/50">
              {grouped ? `共 ${total} 位客人` : `第 ${page} 页，共 ${total} 位客人`}
            </p>
            {!grouped && <p className="text-xs text-me-charcoal/40">排序只对当前页生效</p>}
          </div>

          {/* 刚搬过来时安抚一句，别让「全空的跟进阶段」像没做完的作业 */}
          {/* `rows.length > 0`：分段模式把所有段收起来时 rows 是空数组，
              而 `[].every()` 恒为 true —— 少了这一条，对一个人人都标好阶段的客户
              也会弹出「大家的跟进到哪步都还空着」（魏征 C3 / 子牙 P1-4 实测）。 */}
          {total > 0 && rows.length > 0 && rows.every((r) => !r.stage) && (
            <p className="rounded-lg bg-me-ivory px-3 py-2 text-xs leading-relaxed text-me-charcoal/55">
              刚搬过来，大家的「跟进到哪步」都还空着 —— 聊完顺手标一下就行，不用一次标完。右边「现在冷热」是系统自动算的，现在就能用。
            </p>
          )}

          <div className="overflow-x-auto rounded-xl border border-me-charcoal/10 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-me-charcoal/10 text-left text-xs text-me-charcoal/50">
                  <th className="px-2 py-3">⭐</th>
                  <th className="px-4 py-3">客人</th>
                  {/*
                    分段模式下**不给**排序入口：行来自服务端各段的顺序，点了也不会重排。
                    留着一个点了会变箭头、却一行都不动的按钮，等于告诉人「你排过了」。
                    魏征 B2 实测：箭头会变、顺序一字不动，而平铺那句「排序只对当前页生效」
                    的提示在分段下反而被藏起来了。
                  */}
                  <th
                    className={grouped ? 'px-4 py-3' : 'cursor-pointer select-none px-4 py-3'}
                    onClick={grouped ? undefined : () => toggleSort('firstSeenAt')}
                  >
                    进线时间{grouped ? '' : sortArrow('firstSeenAt')}
                  </th>
                  <th
                    className={grouped ? 'px-4 py-3' : 'cursor-pointer select-none px-4 py-3'}
                    onClick={grouped ? undefined : () => toggleSort('lastTouchAt')}
                  >
                    最近联系{grouped ? '' : sortArrow('lastTouchAt')}
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
                {!grouped && sorted.length === 0 && (
                  <tr>
                    <td colSpan={colCount} className="px-4 py-10 text-center text-me-charcoal/40">
                      {qDebounced.trim() || stageFilter.length > 0 ? '没找到这个人。' : '还没有客人。'}
                    </td>
                  </tr>
                )}
                {!grouped && sorted.map((r) => renderRow(r))}
                {grouped &&
                  sections.map((s) => {
                    const open = openSections === null ? s.open : openSections.includes(s.key)
                    return [
                      <PrioritySectionHeader
                        key={`section-${s.key}`}
                        title={s.title}
                        hint={s.hint}
                        total={s.total}
                        open={open}
                        colSpan={colCount}
                        onToggle={() => toggleSection(s.key)}
                      />,
                      open && s.items !== null && s.items.map((r) => renderRow(r)),
                      open && s.items !== null && s.items.length === 0 && (
                        <tr key={`section-${s.key}-empty`}>
                          <td colSpan={colCount} className="px-4 py-4 text-center text-xs text-me-charcoal/35">
                            这一段现在没有人。
                          </td>
                        </tr>
                      ),
                      // 展开了但数据还在路上：白茫茫一片会让「在加载」「真的空了」「页面坏了」
                      // 三件事长得一模一样（魏征 C2）。CTS 那段 643 人要拉 ~1.4MB，这个窗口是秒级的。
                      open && s.items === null && (
                        <tr key={`section-${s.key}-loading`}>
                          <td colSpan={colCount} className="px-4 py-4 text-center text-xs text-me-charcoal/35">
                            {sectionsLoading ? '正在拿这一段的人…' : '这一段还没取回来，点一下段头重试。'}
                          </td>
                        </tr>
                      ),
                      /*
                       * 🔴 段里还有人没显示出来，必须说出来 + 给得出下一步。
                       *
                       * 服务端一段只下发 100 行。少了这一块的那一版：段头写「217 人」、
                       * 表里 100 行、**剩下 117 个人没有任何入口**。两个复审都判 BLOCKER，
                       * 形状就是 2026-08-02「33 个人凭空消失」——人数对、人不在。
                       */
                      open &&
                        s.items !== null &&
                        s.total > perPage && (
                          <tr key={`section-${s.key}-more`}>
                            <td colSpan={colCount} className="px-4 py-3 text-center text-xs">
                              <span className="text-me-charcoal/45">
                                这一段共 {s.total} 人，正在看第 {sectionRange(s).from}–{sectionRange(s).to} 个
                                （第 {sectionPages[s.key] ?? 1} / {sectionRange(s).pages} 页）
                              </span>
                              <button
                                type="button"
                                disabled={(sectionPages[s.key] ?? 1) <= 1}
                                onClick={() => goSectionPage(s.key, (sectionPages[s.key] ?? 1) - 1)}
                                className="ml-3 rounded-lg border border-me-charcoal/15 px-2.5 py-1 font-bold text-me-charcoal hover:bg-me-ivory disabled:opacity-40"
                              >
                                上一页
                              </button>
                              <button
                                type="button"
                                disabled={(sectionPages[s.key] ?? 1) >= sectionRange(s).pages}
                                onClick={() => goSectionPage(s.key, (sectionPages[s.key] ?? 1) + 1)}
                                className="ml-2 rounded-lg border border-me-charcoal/15 px-2.5 py-1 font-bold text-me-charcoal hover:bg-me-ivory disabled:opacity-40"
                              >
                                下一页
                              </button>
                            </td>
                          </tr>
                        ),
                    ]
                  })}
              </tbody>
            </table>
          </div>

          {!grouped && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-me-charcoal/50">
                共 {total} 人 · 第 {page} / {Math.max(1, Math.ceil(total / perPage))} 页
              </span>
              <div className="flex gap-2">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="rounded-lg border border-black/10 px-3 py-1.5 disabled:opacity-40"
                >
                  上一页
                </button>
                <button
                  disabled={page >= Math.ceil(total / perPage)}
                  onClick={() => setPage((p) => p + 1)}
                  className="rounded-lg border border-black/10 px-3 py-1.5 disabled:opacity-40"
                >
                  下一页
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
