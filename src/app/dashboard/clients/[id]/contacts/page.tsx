'use client'

/**
 * 我的客人 —— 中介在车里、在开放日现场用手机开的那一页。
 *
 * 整条链上只有一步机器做不了：**这个咨询是不是真买家，只有跟他谈过的人知道**。
 * 所以这一页只干一件事：让中介在 5 分钟内把「每个人到哪一步了」说清楚。
 * 每多一次点击、每多一个跳转，这件事就少发生一次。
 *
 * 因此定死三条：
 *   1. 改状态就在这一行完成 —— 不进详情页、不开抽屉、不弹确认框（点错了再点回来就是）
 *   2. 手指点得中 —— 每个能点的东西至少 44px 高，两列铺开，不做横向滚动
 *   3. 先乐观改，再发请求；失败当场把这一行退回原样并说明白
 *
 * 文案口径：说「谁带来的」「到哪一步了」，不说阶段 / 归因 / 漏斗这些内部词。
 */

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

interface SourceLine {
  text: string
  confidence: 'ad' | 'channel' | 'entry'
}

interface Suggestion {
  toStage: string
  label: string
  why: string
}

interface Person {
  contactId: string
  name: string
  source: SourceLine | null
  lastTouchAt: string | null
  lastTouchText: string | null
  aiSummary: string | null
  stage: string | null
  stageLabel: string | null
  suggestion: Suggestion | null
}

interface Group {
  listingId: string | null
  title: string
  subtitle: string | null
  people: Person[]
}

interface Stage {
  stageKey: string
  label: string
}

interface Board {
  /**
   * 这一页适不适用于这个客户。整页是围绕「按房子分组」建的（中介在开放日现场用
   * 手机标客人）。2026-08-02 PM 在**旅游**客户 CTS 身上打开它，看到的是
   * 「按房子分开列」+ 一大坨没分组的人 —— 文案在说房子、客户没有房子。
   * 不适用时不渲染这一页，直接指回「客户跟进」。
   */
  applicable?: boolean
  /** 有没有真的录了房子 —— 页头要不要提「按房子分开列」看它。 */
  hasListings?: boolean
  stages: Stage[]
  groups: Group[]
  totalPeople: number
}

/** 「今天 / 昨天 / 3天前 / 7月2日」—— 中介看的是「多久没理他了」，不是精确日期。 */
function relTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return '今天'
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000)
  if (days === 1) return '昨天'
  if (days >= 2 && days < 30) return `${days}天前`
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

/**
 * 来源那一行的措辞按把握度分三档 —— 把「这条广告带来的」和「只知道他从私信进来」
 * 说成同一句话，就是在骗中介，也会把「哪条广告有效」算脏。
 */
function sourceText(s: SourceLine): string {
  if (s.confidence === 'ad') return `广告带来的：${s.text}`
  if (s.confidence === 'channel') return `来自 ${s.text}`
  return `从${s.text}找上门`
}

function SourceChip({ source }: { source: SourceLine | null }) {
  if (!source) {
    return (
      <span className="inline-block rounded bg-me-charcoal/5 px-2 py-0.5 text-[11px] text-me-charcoal/40">
        没记下他是怎么来的
      </span>
    )
  }
  const strong = source.confidence === 'ad'
  return (
    <span
      className={`inline-block max-w-full break-words rounded px-2 py-0.5 text-[11px] font-semibold ${
        strong ? 'bg-me-ochre/12 text-me-ochre' : 'bg-me-charcoal/5 text-me-charcoal/55'
      }`}
    >
      {sourceText(source)}
    </span>
  )
}

/** 一个人一张卡。展开后就地铺出所有档位，点一下即落库。 */
function PersonCard({
  person,
  stages,
  onPick,
  pending,
  error,
}: {
  person: Person
  stages: Stage[]
  onPick: (contactId: string, toStage: string) => void
  pending: boolean
  error: string | null
}) {
  const [open, setOpen] = useState(false)

  const pick = (key: string) => {
    setOpen(false)
    onPick(person.contactId, key)
  }

  return (
    <li className="rounded-xl bg-white p-3 ring-1 ring-black/5">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 break-words text-[15px] font-bold text-me-charcoal">{person.name}</p>
        {person.lastTouchAt && (
          <span className="shrink-0 pt-0.5 text-xs text-me-charcoal/35">
            {relTime(person.lastTouchAt)}
          </span>
        )}
      </div>

      <div className="mt-1.5">
        <SourceChip source={person.source} />
      </div>

      {person.lastTouchText && (
        <p className="mt-2 line-clamp-3 break-words text-sm leading-relaxed text-me-charcoal/70">
          {person.lastTouchText}
        </p>
      )}

      {person.aiSummary && (
        <p className="mt-2 break-words rounded-lg bg-me-charcoal/[0.04] px-2.5 py-2 text-[13px] leading-relaxed text-me-charcoal/60">
          <span className="font-bold text-me-charcoal/45">系统读下来：</span>
          {person.aiSummary}
        </p>
      )}

      {/* 建议只在这个人还没标过、且系统读到他问得很具体时出现。点一下就落库。 */}
      {person.suggestion && !pending && (
        <button
          type="button"
          onClick={() => pick(person.suggestion!.toStage)}
          className="mt-2.5 flex min-h-[44px] w-full items-center justify-between gap-2 rounded-lg bg-me-ochre/10 px-3 text-left text-sm font-bold text-me-ochre transition active:bg-me-ochre/20"
        >
          <span className="min-w-0 break-words">
            要不要标成「{person.suggestion.label}」？
            <span className="block text-[11px] font-normal text-me-ochre/70">
              {person.suggestion.why}
            </span>
          </span>
          <span className="shrink-0 text-xs">标上 →</span>
        </button>
      )}

      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={pending}
          className={`flex min-h-[44px] flex-1 items-center justify-between gap-2 rounded-lg px-3 text-left text-sm font-bold transition ${
            person.stageLabel
              ? 'bg-me-charcoal text-white active:bg-me-charcoal/85'
              : 'bg-me-charcoal/8 text-me-charcoal/60 active:bg-me-charcoal/15'
          } ${pending ? 'opacity-50' : ''}`}
        >
          <span className="min-w-0 break-words">
            {pending ? '正在保存…' : (person.stageLabel ?? '还没标 —— 他到哪一步了？')}
          </span>
          <span className="shrink-0 text-xs opacity-60">{open ? '收起' : '改'}</span>
        </button>
      </div>

      {open && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          {stages.map((s) => {
            const current = s.stageKey === person.stage
            return (
              <button
                key={s.stageKey}
                type="button"
                onClick={() => pick(s.stageKey)}
                className={`min-h-[44px] break-words rounded-lg px-2 text-sm font-semibold transition ${
                  current
                    ? 'bg-me-charcoal text-white'
                    : 'bg-me-charcoal/5 text-me-charcoal/75 active:bg-me-charcoal/15'
                }`}
              >
                {s.label}
              </button>
            )
          })}
        </div>
      )}

      {error && <p className="mt-2 break-words text-xs font-semibold text-red-600">{error}</p>}
    </li>
  )
}

export default function MyContactsPage() {
  const params = useParams<{ id: string }>()
  const clientId = params.id

  const [board, setBoard] = useState<Board | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const [rowError, setRowError] = useState<Record<string, string | null>>({})

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/contacts`)
      const json = (await res.json()) as Board & { error?: string }
      if (!res.ok) {
        setLoadError(json.error ?? '打不开，请稍后再试一次')
        return
      }
      setBoard(json)
    } catch {
      setLoadError('网络不太好，刷新一下再试')
    }
  }, [clientId])

  useEffect(() => {
    void load()
  }, [load])

  /** 先把界面改了，再发请求；失败就退回原样 —— 中介在路上，等转圈是最贵的。 */
  const setStageLocally = useCallback((contactId: string, stageKey: string | null, stages: Stage[]) => {
    setBoard((prev) => {
      if (!prev) return prev
      const label = stageKey ? (stages.find((s) => s.stageKey === stageKey)?.label ?? stageKey) : null
      return {
        ...prev,
        groups: prev.groups.map((g) => ({
          ...g,
          people: g.people.map((p) =>
            p.contactId === contactId
              ? { ...p, stage: stageKey, stageLabel: label, suggestion: null }
              : p,
          ),
        })),
      }
    })
  }, [])

  const pickStage = useCallback(
    async (contactId: string, toStage: string) => {
      if (!board) return
      const before = board.groups.flatMap((g) => g.people).find((p) => p.contactId === contactId)
      if (!before) return

      setRowError((m) => ({ ...m, [contactId]: null }))
      setPending((m) => ({ ...m, [contactId]: true }))
      setStageLocally(contactId, toStage, board.stages)

      try {
        const res = await fetch(`/api/clients/${clientId}/crm/contacts/${contactId}/stage`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ toStage }),
        })
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as { error?: string }
          setStageLocally(contactId, before.stage, board.stages)
          setRowError((m) => ({ ...m, [contactId]: json.error ?? '没保存上，再点一次' }))
        }
      } catch {
        setStageLocally(contactId, before.stage, board.stages)
        setRowError((m) => ({ ...m, [contactId]: '网络断了，没保存上' }))
      } finally {
        setPending((m) => ({ ...m, [contactId]: false }))
      }
    },
    [board, clientId, setStageLocally],
  )

  // 不适用这一页的客户（不是地产、也没录过房子）：不铺一屏说房子的界面给他，
  // 直接指到真正该去的那页。跟导航里「行程单」「房子」同样的处理口径 ——
  // 入口都在，页面自己说清楚适不适用。
  if (board && board.applicable === false) {
    return (
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        <h1 className="text-xl font-black text-me-charcoal">我的客人</h1>
        <div className="mt-3 rounded-2xl border border-me-charcoal/10 bg-white p-5">
          <p className="text-sm leading-relaxed text-me-charcoal/70">
            这一页是给<strong>按房子跟客人的中介</strong>做的 —— 手机上一屏把「谁到哪一步了」标完。
            这个客户没有按房子经营，用它反而绕远。
          </p>
          <a
            href={`/dashboard/clients/${clientId}/crm`}
            className="mt-4 inline-block rounded-xl bg-me-charcoal px-4 py-2.5 text-sm font-bold text-white"
          >
            去「客户跟进」看今天该联系谁 →
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <header>
        <h1 className="text-xl font-black text-me-charcoal">我的客人</h1>
        <p className="mt-1 text-sm leading-relaxed text-me-charcoal/55">
          {board?.hasListings ? '按房子分开列。' : ''}
          每个人点一下就能说清楚他到哪一步了 —— 你标的这一下，是系统唯一学不会的东西。
        </p>
      </header>

      {loadError && (
        <div className="rounded-xl bg-red-50 p-4 text-sm font-semibold text-red-700 ring-1 ring-red-200">
          {loadError}
        </div>
      )}

      {!board && !loadError && <p className="text-sm text-me-charcoal/45">正在打开…</p>}

      {board && board.totalPeople === 0 && (
        <div className="rounded-xl bg-white p-6 text-center ring-1 ring-black/5">
          <p className="text-sm font-bold text-me-charcoal">这里还没有人。</p>
          <p className="mt-1.5 text-sm leading-relaxed text-me-charcoal/55">
            广告跑起来、有人来问房子之后，他们会自动出现在这里，你只要说一句「这个人到哪一步了」。
          </p>
        </div>
      )}

      {board?.groups.map((g) => (
        <section key={g.listingId ?? 'none'} className="space-y-2">
          <div className="px-0.5">
            <h2 className="break-words text-base font-black text-me-charcoal">{g.title}</h2>
            <p className="mt-0.5 text-xs text-me-charcoal/45">
              {g.subtitle ? `${g.subtitle} · ` : ''}
              {g.people.length} 个人
            </p>
          </div>
          <ul className="space-y-2">
            {g.people.map((p) => (
              <PersonCard
                key={p.contactId}
                person={p}
                stages={board.stages}
                onPick={pickStage}
                pending={pending[p.contactId] === true}
                error={rowError[p.contactId] ?? null}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
