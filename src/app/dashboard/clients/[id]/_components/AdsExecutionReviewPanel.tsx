'use client'

import { useEffect, useState } from 'react'

import type {
  AdsExecutionReviewPanel as AdsExecutionReviewPanelData,
  ExecutionReviewItem,
} from '@/lib/ads/ads-execution-review-panel'

const ERROR_TEXT = 'text-sm text-[#C2453A]'

type LoadState = 'loading' | 'forbidden' | 'error' | 'ready'

function VerdictBadge({ item }: { item: ExecutionReviewItem }) {
  if (item.phase === 'pending') {
    return (
      <span className="text-xs font-medium text-me-ochre">{item.phase_label}</span>
    )
  }
  if (item.phase === 'incomplete') {
    return <span className="text-xs font-medium text-me-charcoal/55">{item.phase_label}</span>
  }
  if (!item.verdict_label) {
    return <span className="text-xs font-medium text-me-charcoal/55">{item.phase_label}</span>
  }
  const tone =
    item.verdict === 'useful' || item.verdict === 'improved'
      ? 'bg-emerald-50 text-emerald-900'
      : item.verdict === 'not_useful' || item.verdict === 'worse'
        ? 'bg-red-50 text-red-900'
        : 'bg-me-stone/80 text-me-charcoal'
  return (
    <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${tone}`}>
      {item.verdict_label}
    </span>
  )
}

function BeforeAfter({ item }: { item: ExecutionReviewItem }) {
  if (!item.before_display && !item.after_display) return null
  return (
    <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
      <div className="rounded-xl border border-black/8 bg-[#faf9f6] px-3 py-2 text-center">
        <dt className="text-me-charcoal/55">改之前</dt>
        <dd className="mt-0.5 font-semibold text-me-charcoal">{item.before_display ?? '—'}</dd>
      </div>
      <div className="rounded-xl border border-black/8 bg-[#faf9f6] px-3 py-2 text-center">
        <dt className="text-me-charcoal/55">改之后</dt>
        <dd className="mt-0.5 font-semibold text-me-charcoal">{item.after_display ?? '—'}</dd>
      </div>
    </dl>
  )
}

function ReviewRow({ item }: { item: ExecutionReviewItem }) {
  return (
    <li className="rounded-2xl border border-black/10 bg-white px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-me-stone/80 px-2 py-0.5 text-xs font-semibold text-me-charcoal">
            {item.kind_label}
          </span>
          <VerdictBadge item={item} />
        </div>
        <time className="text-xs text-me-charcoal/70" dateTime={item.executed_at ?? undefined}>
          {item.executed_at_display}
        </time>
      </div>
      {item.what_done ? (
        <p className="mt-2 text-sm font-medium text-me-charcoal">{item.what_done}</p>
      ) : (
        <p className="mt-2 text-sm text-me-charcoal/65">做了什么：还没有记下。</p>
      )}
      <BeforeAfter item={item} />
      {item.phase === 'concluded' && item.summary ? (
        <p className="mt-2 text-sm text-me-charcoal/80 leading-relaxed">{item.summary}</p>
      ) : null}
      {item.phase === 'concluded' && (item.verdict === 'unclear' || item.verdict === 'unsure' || item.verdict === 'not_useful') && item.reason ? (
        <p className="mt-1 text-xs text-me-charcoal/60">原因：{item.reason}</p>
      ) : null}
      {item.phase === 'pending' && item.observation_window_days !== null ? (
        <p className="mt-2 text-sm text-me-charcoal/70">
          观察 {item.observation_window_days} 天，{item.phase_label}。
        </p>
      ) : null}
    </li>
  )
}

export function AdsExecutionReviewPanel({ clientId }: { clientId: string }) {
  const [load, setLoad] = useState<LoadState>('loading')
  const [panel, setPanel] = useState<AdsExecutionReviewPanelData | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/ads-execution-review`)
        if (cancelled) return
        if (res.status === 401 || res.status === 403) return setLoad('forbidden')
        const json = (await res.json().catch(() => ({}))) as {
          success?: boolean
          panel?: AdsExecutionReviewPanelData
        }
        if (!res.ok || json.success !== true || !json.panel) return setLoad('error')
        setPanel(json.panel)
        setLoad('ready')
      } catch {
        if (!cancelled) setLoad('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [clientId])

  if (load === 'loading') {
    return (
      <section className="rounded-2xl border border-black/10 bg-white p-4" aria-busy="true">
        <p className="text-sm text-me-charcoal/70">正在读取改完后的成绩…</p>
        <div className="mt-3 h-20 animate-pulse rounded-xl bg-me-stone/70" />
      </section>
    )
  }

  if (load === 'forbidden') {
    return (
      <section className="rounded-2xl border border-black/10 bg-white p-4">
        <p className={ERROR_TEXT}>改完后的成绩只有有权限的人才能看。</p>
      </section>
    )
  }

  if (load === 'error' || !panel) {
    return (
      <section className="rounded-2xl border border-black/10 bg-white p-4">
        <p className={ERROR_TEXT}>改完后的成绩读取失败，请刷新；还不行就找开发。</p>
      </section>
    )
  }

  return (
    <section
      className="rounded-2xl border border-black/10 bg-white p-4 md:p-5"
      aria-labelledby="ads-execution-review-heading"
    >
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="ads-execution-review-heading" className="text-base font-semibold text-me-charcoal">
            改完后的成绩
          </h2>
          <p className="mt-1 text-xs text-me-charcoal/65 leading-relaxed">
            调过日预算或暂停过的组，观察几天后会写清有用、没用还是看不出。只读，不会再去改广告。
          </p>
        </div>
        <p className="text-[11px] text-me-charcoal/50">最近 {panel.limit} 条 · 新西兰时间</p>
      </div>

      {panel.items.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-black/15 px-3 py-4 text-sm text-me-charcoal/70">
          还没有已执行的调预算或暂停记录（点了确认并真的改完 Meta 之后才会出现在这里）。
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {panel.items.map((item) => (
            <ReviewRow key={item.action_id} item={item} />
          ))}
        </ul>
      )}
    </section>
  )
}
