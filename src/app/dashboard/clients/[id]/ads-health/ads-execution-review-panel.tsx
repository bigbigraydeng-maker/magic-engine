'use client'

import { useEffect, useState } from 'react'

import type { AdsExecutionReviewItem, AdsExecutionReviewPanel } from '@/lib/ads-execution-review/panel'

const ERROR_TEXT = 'text-sm text-[#C2453A]'

type LoadState = 'loading' | 'forbidden' | 'error' | 'ready'

function VerdictBadge({ item }: { item: AdsExecutionReviewItem }) {
  if (item.pending_label) {
    return <span className="text-xs font-medium text-me-ochre">{item.pending_label}</span>
  }
  if (!item.verdict_label) return null
  const tone =
    item.verdict === 'improved' ? 'text-emerald-700' : item.verdict === 'worse' ? 'text-[#C2453A]' : 'text-me-charcoal/70'
  return <span className={`text-xs font-semibold ${tone}`}>{item.verdict_label}</span>
}

function MetricGrid({ item }: { item: AdsExecutionReviewItem }) {
  if (!item.metrics || item.metrics.length === 0) return null
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      {item.metrics.map((metric) => (
        <div key={metric.label} className="rounded-xl border border-black/8 bg-[#faf9f6] px-3 py-2">
          <p className="text-xs font-semibold text-me-charcoal">{metric.label}</p>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-center text-xs">
            <div>
              <dt className="text-me-charcoal/55">改前</dt>
              <dd className="font-semibold text-me-charcoal">{metric.before ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-me-charcoal/55">改后</dt>
              <dd className="font-semibold text-me-charcoal">{metric.after ?? '—'}</dd>
            </div>
          </dl>
        </div>
      ))}
    </div>
  )
}

function ReviewRow({ item }: { item: AdsExecutionReviewItem }) {
  return (
    <li className="rounded-2xl border border-black/10 bg-white px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-me-stone/80 px-2 py-0.5 text-xs font-semibold text-me-charcoal">
            {item.kind_label}
          </span>
          {item.unit_label ? <span className="text-xs text-me-charcoal/55">{item.unit_label}</span> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-me-charcoal/70">
          <VerdictBadge item={item} />
          <time dateTime={item.executed_at ?? undefined}>{item.executed_at_display}</time>
        </div>
      </div>
      {item.what_done ? <p className="mt-2 text-sm text-me-charcoal leading-relaxed">{item.what_done}</p> : null}
      <MetricGrid item={item} />
      {item.summary ? (
        <p className="mt-2 text-sm text-me-charcoal/80 leading-relaxed">{item.summary}</p>
      ) : !item.pending_label ? (
        <p className="mt-2 text-sm text-me-charcoal/60">还没有结论文案，等观察期任务写上。</p>
      ) : null}
      {item.reason ? <p className="mt-1 text-xs text-me-charcoal/65">原因：{item.reason}</p> : null}
    </li>
  )
}

export function AdsExecutionReviewPanel({ clientId }: { clientId: string }) {
  const [load, setLoad] = useState<LoadState>('loading')
  const [panel, setPanel] = useState<AdsExecutionReviewPanel | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/ads-execution-review`)
        if (cancelled) return
        if (res.status === 401 || res.status === 403) return setLoad('forbidden')
        const json = (await res.json().catch(() => ({}))) as {
          success?: boolean
          panel?: AdsExecutionReviewPanel
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
        <p className="text-sm text-me-charcoal/70">正在读取改后结论…</p>
        <div className="mt-3 h-20 animate-pulse rounded-xl bg-me-stone/70" />
      </section>
    )
  }

  if (load === 'forbidden') {
    return (
      <section className="rounded-2xl border border-black/10 bg-white p-4">
        <p className={ERROR_TEXT}>改后结论只有已开通客户能看。</p>
      </section>
    )
  }

  if (load === 'error' || !panel) {
    return (
      <section className="rounded-2xl border border-black/10 bg-white p-4">
        <p className={ERROR_TEXT}>改后结论读取失败，请刷新；还不行就找开发。</p>
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
            改后结论
          </h2>
          <p className="mt-1 text-xs text-me-charcoal/65 leading-relaxed">
            调预算或暂停真正改完之后，看同一广告组在观察期里是变好、变差，还是判不了。只读，不会动广告。
          </p>
        </div>
        <p className="text-[11px] text-me-charcoal/50">最近 {panel.limit} 条 · 新西兰时间</p>
      </div>

      {panel.items.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-black/15 px-3 py-4 text-sm text-me-charcoal/70">
          还没有已执行完的预算卡或暂停卡，执行过后这里会出现结论文案。
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {panel.items.map((item) => (
            <ReviewRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </section>
  )
}
