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

interface ContactRow {
  contactId: string
  name: string
  firstSeenAt: string
  lastTouchAt: string | null
  phone: string | null
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
  loading,
  onWrote,
}: {
  clientId: string
  row: ContactRow
  stages: StageOption[]
  timeline: TimelineEntry[] | null
  loading: boolean
  onWrote: (msg: string) => void
}) {
  const [composing, setComposing] = useState(false)
  const [changingStage, setChangingStage] = useState(false)
  const [showAll, setShowAll] = useState(false)

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
        {row.phone && (
          <a href={`tel:${row.phone}`} className="rounded-lg border border-me-stone px-3 py-1.5 text-sm font-semibold text-me-charcoal">
            📞 {row.phone}
          </a>
        )}
        {row.email && (
          <a href={`mailto:${row.email}`} className="break-all rounded-lg border border-me-stone px-3 py-1.5 text-sm font-semibold text-me-charcoal">
            ✉️ {row.email}
          </a>
        )}
      </div>

      {/* 往来时间线 */}
      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-me-charcoal/40">往来记录</p>
        {loading && <p className="text-sm text-me-charcoal/40">加载中…</p>}
        {!loading && timeline && timeline.length === 0 && (
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
                onClick={() => void changeStage(s.stageKey, s.label)}
                className="rounded-full bg-me-ivory px-3 py-1.5 text-xs font-bold text-me-charcoal"
              >
                {s.label}
              </button>
            ))}
        </div>
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
        setStages((s.stages ?? []).map((x) => ({ stageKey: x.stageKey, label: x.label })))
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
      setTimelineLoading(true)
      timelineReqRef.current = contactId
      try {
        const res = await fetch(`/api/clients/${clientId}/crm/contacts/${contactId}/timeline`)
        const json = (await res.json()) as { timeline?: TimelineEntry[] }
        if (timelineReqRef.current !== contactId) return
        setTimeline(res.ok ? (json.timeline ?? []) : [])
      } catch {
        if (timelineReqRef.current === contactId) setTimeline([])
      } finally {
        if (timelineReqRef.current === contactId) setTimelineLoading(false)
      }
    },
    [clientId],
  )

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
  const afterWrite = (msg: string) => {
    setToast(msg)
    void loadList()
    if (expandedId) void loadTimeline(expandedId)
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
