'use client'

/**
 * 一套房的档案面板:AI 出稿 → 人逐栏校正 → 点生效。
 *
 * 三件事在这一页同时成立,少一件这页就白做:
 *   ① **每一栏都看得见来源**(有出处 / AI 判断 / 缺)—— 否则人会把 AI 猜的
 *      当成查到的拿去跟卖家谈
 *   ② **草稿和生效分开** —— AI 出的东西没人看过就不该影响投放
 *   ③ **旧版本留着且只读** —— 「当初以为什么」是学习的对照面,改了就没了
 *
 * 状态三态(加载 / 出错 / 就绪)照 ListingsClient 的写法,别让 FDE 每页重学一遍。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { listingBriefStatusLabel, type ListingBriefStatus } from '@/lib/listings/brief-constants'
import type { ListingBriefRow } from '@/lib/listings/brief-queries'
import type { ListingBriefContent } from '@/lib/listings/brief-schema'
import {
  AngleRankingEditor,
  BuyerSegmentsEditor,
  HesitationsEditor,
  MarketSnapshotEditor,
  UnitVariantsEditor,
} from './BriefFieldEditors'
import { BriefFactsEditor, GapsEditor, SourcesOverview } from './BriefFactsEditor'
import { AdReferencePanel } from './AdReferencePanel'

type State =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; briefs: ListingBriefRow[] }

const STATUS_CLS: Record<ListingBriefStatus, string> = {
  draft:      'bg-me-ochre/15 text-me-ochre border-me-ochre/35',
  active:     'bg-[#5C8A4A]/12 text-[#5C8A4A] border-[#5C8A4A]/30',
  superseded: 'bg-me-ivory text-me-charcoal/40 border-black/10',
}

/** 把一行档案抽成可编辑的内容副本(数据库那边这些列可能是 null)。 */
function toContent(b: ListingBriefRow): ListingBriefContent {
  return {
    buyer_segments:  b.buyer_segments ?? [],
    angle_ranking:   b.angle_ranking ?? [],
    hesitations:     b.hesitations ?? [],
    unit_variants:   b.unit_variants ?? [],
    market_snapshot: b.market_snapshot ?? {
      median_price: null, yoy_change_pct: null, rental_yield: null,
      area_avg_yield: null, comparables: [],
    },
    facts: b.facts ?? {
      price_method: null, completion_status: null, school_zone: null,
      nearby: [], vendor_motivation: null,
    },
    gaps:    b.gaps ?? [],
    sources: b.sources ?? [],
  }
}

export function ListingBriefClient({ listingId }: { listingId: string }) {
  const [state, setState]         = useState<State>({ phase: 'loading' })
  const [selectedId, setSelected] = useState<string | null>(null)
  const [draft, setDraft]         = useState<ListingBriefContent | null>(null)
  const [busy, setBusy]           = useState<'generate' | 'save' | 'activate' | null>(null)
  const [notice, setNotice]       = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const [warnings, setWarnings]   = useState<string[]>([])
  const [listingUrl, setUrl]      = useState('')

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const res = await fetch(`/api/listings/${listingId}/brief`)
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(error ?? `HTTP ${res.status}`)
      }
      const { briefs } = (await res.json()) as { briefs: ListingBriefRow[] }
      setState({ phase: 'ready', briefs: briefs ?? [] })
      const first = briefs?.find(b => b.status === 'draft') ?? briefs?.[0] ?? null
      setSelected(first?.id ?? null)
      setDraft(first ? toContent(first) : null)
    } catch (err) {
      setState({ phase: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [listingId])

  useEffect(() => { load() }, [load])

  const briefs = state.phase === 'ready' ? state.briefs : []
  const selected = useMemo(
    () => briefs.find(b => b.id === selectedId) ?? null,
    [briefs, selectedId],
  )
  const readOnly = selected?.status === 'superseded'

  const pick = (b: ListingBriefRow) => {
    setSelected(b.id)
    setDraft(toContent(b))
    setNotice(null)
  }

  /** 生成后就地插到最前并选中 —— 人刚点完就想看结果,不该再找一遍。 */
  const runGenerate = async () => {
    setBusy('generate'); setNotice(null); setWarnings([])
    try {
      const res = await fetch(`/api/listings/${listingId}/brief/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing_url: listingUrl.trim() || null }),
      })
      const json = (await res.json()) as { brief?: ListingBriefRow; error?: string; warnings?: string[] }
      setWarnings(json.warnings ?? [])
      if (!res.ok || !json.brief) throw new Error(json.error ?? `HTTP ${res.status}`)
      setState({ phase: 'ready', briefs: [json.brief, ...briefs] })
      pick(json.brief)
      setNotice({ tone: 'ok', text: `第 ${json.brief.version} 版草稿出来了。逐栏看一遍，确认无误再点生效。` })
    } catch (err) {
      setNotice({ tone: 'bad', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(null)
    }
  }

  const replaceBrief = (saved: ListingBriefRow, all?: ListingBriefRow[]) => {
    const base = all ?? briefs
    setState({ phase: 'ready', briefs: base.map(b => (b.id === saved.id ? saved : b)) })
  }

  const runSave = async () => {
    if (!selected || !draft) return
    setBusy('save'); setNotice(null)
    try {
      const res = await fetch(`/api/listings/${listingId}/brief/${selected.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      const json = (await res.json()) as { brief?: ListingBriefRow; error?: string }
      if (!res.ok || !json.brief) throw new Error(json.error ?? `HTTP ${res.status}`)
      replaceBrief(json.brief)
      setDraft(toContent(json.brief))
      setNotice({ tone: 'ok', text: '改动已保存。' })
    } catch (err) {
      setNotice({ tone: 'bad', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(null)
    }
  }

  /** 生效会把旧的那版顶成「旧版本」,所以本地也要整表刷新,不能只换一行。 */
  const runActivate = async () => {
    if (!selected) return
    setBusy('activate'); setNotice(null)
    try {
      const res = await fetch(`/api/listings/${listingId}/brief/${selected.id}/activate`, { method: 'POST' })
      const json = (await res.json()) as { brief?: ListingBriefRow; error?: string }
      if (!res.ok || !json.brief) throw new Error(json.error ?? `HTTP ${res.status}`)
      await load()
      setNotice({ tone: 'ok', text: `第 ${json.brief.version} 版已生效，之前生效的那版转成旧版本留档。` })
    } catch (err) {
      setNotice({ tone: 'bad', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(null)
    }
  }

  if (state.phase === 'loading') {
    return <p className="text-sm font-semibold text-me-charcoal/40">加载中…</p>
  }
  if (state.phase === 'error') {
    return (
      <div className="rounded-xl border border-[#C2453A]/30 bg-[#C2453A]/8 p-4">
        <p className="text-sm font-black text-[#C2453A]">读取档案失败</p>
        <p className="mt-1 text-sm font-semibold text-me-charcoal/70">{state.message}</p>
        <button onClick={load} className="mt-3 rounded-lg border border-[#C2453A]/30 bg-white px-3 py-1 text-xs font-black text-[#C2453A]">
          重试
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <GenerateBar
        url={listingUrl}
        onUrl={setUrl}
        busy={busy === 'generate'}
        disabled={busy !== null}
        onRun={runGenerate}
      />

      {notice && (
        <p className={`rounded-lg border px-3 py-2 text-sm font-bold ${
          notice.tone === 'ok'
            ? 'border-[#5C8A4A]/30 bg-[#5C8A4A]/8 text-[#5C8A4A]'
            : 'border-[#C2453A]/30 bg-[#C2453A]/8 text-[#C2453A]'
        }`}>
          {notice.text}
        </p>
      )}

      {warnings.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-me-ochre/30 bg-me-ochre/8 px-3 py-2 text-xs font-bold text-me-ochre">
          {warnings.map((w, i) => <li key={i}>· {w}</li>)}
        </ul>
      )}

      {briefs.length === 0 && <EmptyState />}

      {briefs.length > 0 && (
        <VersionTabs briefs={briefs} selectedId={selectedId} onPick={pick} />
      )}

      {selected && draft && (
        <div className="space-y-6 rounded-xl border border-black/10 bg-me-ivory/40 p-4 sm:p-5">
          {readOnly && (
            <p className="rounded-lg border border-black/10 bg-white px-3 py-2 text-xs font-bold text-me-charcoal/55">
              这是旧版本，只能看不能改 —— 当初的判断留着，才有得跟后来的结果对照。
            </p>
          )}
          <fieldset disabled={readOnly} className={readOnly ? 'space-y-6 opacity-70' : 'space-y-6'}>
            <BuyerSegmentsEditor
              value={draft.buyer_segments}
              sources={draft.sources}
              onChange={v => setDraft({ ...draft, buyer_segments: v as ListingBriefContent['buyer_segments'] })}
            />
            <AngleRankingEditor
              value={draft.angle_ranking}
              sources={draft.sources}
              onChange={v => setDraft({ ...draft, angle_ranking: v })}
            />
            <HesitationsEditor
              value={draft.hesitations}
              sources={draft.sources}
              onChange={v => setDraft({ ...draft, hesitations: v as ListingBriefContent['hesitations'] })}
            />
            <UnitVariantsEditor
              value={draft.unit_variants}
              sources={draft.sources}
              onChange={v => setDraft({ ...draft, unit_variants: v })}
            />
            <MarketSnapshotEditor
              value={draft.market_snapshot}
              sources={draft.sources}
              onChange={v => setDraft({ ...draft, market_snapshot: v })}
            />
            <BriefFactsEditor
              value={draft.facts}
              sources={draft.sources}
              onChange={v => setDraft({ ...draft, facts: v })}
            />
            <GapsEditor value={draft.gaps} onChange={v => setDraft({ ...draft, gaps: v })} />
          </fieldset>

          {/* 实测摆在判断的**下面**、编辑区**外面**:先看该怎么打，再看我们投过什么。
              放进编辑区就等于暗示它可以改上面的排序 —— 那正是要防的那件事。 */}
          <AdReferencePanel block={selected.ad_reference ?? null} />

          <section>
            <p className="mb-2 text-[11px] font-black uppercase tracking-[.1em] text-me-charcoal/45">
              这份档案的来源
            </p>
            <SourcesOverview sources={draft.sources} />
          </section>

          {!readOnly && (
            <div className="flex flex-wrap gap-2 border-t border-black/10 pt-4">
              <button
                onClick={runSave}
                disabled={busy !== null}
                className="rounded-lg border border-black/12 bg-white px-4 py-2 text-sm font-black text-me-charcoal disabled:opacity-50"
              >
                {busy === 'save' ? '保存中…' : '保存改动'}
              </button>
              {selected.status !== 'active' && (
                <button
                  onClick={runActivate}
                  disabled={busy !== null}
                  className="rounded-lg bg-me-charcoal px-4 py-2 text-sm font-black text-white disabled:opacity-50"
                >
                  {busy === 'activate' ? '生效中…' : '让这一版生效'}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function GenerateBar({
  url, onUrl, busy, disabled, onRun,
}: {
  url: string
  onUrl: (v: string) => void
  busy: boolean
  disabled: boolean
  onRun: () => void
}) {
  return (
    <div className="rounded-xl border border-black/10 bg-white p-4">
      <p className="text-sm font-black text-me-charcoal">让 AI 先做一遍功课</p>
      <p className="mt-1 text-xs font-semibold text-me-charcoal/50">
        贴上房源页链接，AI 会把页面读完、再去查这个区的行情，出一份草稿。
        查不到的它会写进「还缺什么」，不会编一个数糊弄你。
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          value={url}
          onChange={e => onUrl(e.target.value)}
          placeholder="https://…  房源页链接（不给也能跑，但结果会空很多）"
          className="w-full rounded-lg border border-black/12 bg-white px-3 py-2 text-sm font-semibold text-me-charcoal focus:border-me-ochre focus:outline-none focus:ring-2 focus:ring-me-ochre/20"
        />
        <button
          onClick={onRun}
          disabled={disabled}
          className="shrink-0 rounded-lg bg-me-charcoal px-4 py-2 text-sm font-black text-white disabled:opacity-50"
        >
          {busy ? '做功课中…（约 1 分钟）' : '生成草稿'}
        </button>
      </div>
    </div>
  )
}

function VersionTabs({
  briefs, selectedId, onPick,
}: {
  briefs: ListingBriefRow[]
  selectedId: string | null
  onPick: (b: ListingBriefRow) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {briefs.map(b => (
        <button
          key={b.id}
          onClick={() => onPick(b)}
          className={
            b.id === selectedId
              ? 'flex items-center gap-2 rounded-lg border border-me-charcoal bg-me-charcoal px-3 py-1.5 text-xs font-black text-white'
              : 'flex items-center gap-2 rounded-lg border border-black/12 bg-white px-3 py-1.5 text-xs font-bold text-me-charcoal/60 hover:border-me-ochre'
          }
        >
          第 {b.version} 版
          <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-bold leading-none ${
            b.id === selectedId ? 'border-white/30 bg-white/15 text-white' : STATUS_CLS[b.status]
          }`}>
            {listingBriefStatusLabel(b.status)}
          </span>
        </button>
      ))}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-black/10 bg-white p-8 text-center">
      <p className="font-black text-me-charcoal">这套房还没有档案</p>
      <p className="mx-auto mt-2 max-w-lg text-sm font-semibold text-me-charcoal/55">
        档案记两件事：投放之前我们<strong>以为</strong>谁会买、该打什么；跑完之后<strong>实际</strong>是谁来了、
        哪条真的管用。两栏一对照，下一套房才知道该怎么打。
      </p>
    </div>
  )
}
