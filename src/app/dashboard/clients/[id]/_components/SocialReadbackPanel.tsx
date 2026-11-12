'use client'

import { useEffect, useState } from 'react'

import type { SocialReadbackItem, SocialReadbackPanel } from '@/lib/social/social-readback-panel'

const ERROR_TEXT = 'text-sm text-[#C2453A]'

type LoadState = 'loading' | 'forbidden' | 'error' | 'ready'

function WindowMetrics({ item }: { item: SocialReadbackItem }) {
  if (item.windows === null) {
    return (
      <p className="mt-2 text-sm text-me-charcoal/80 leading-relaxed">{item.summary}</p>
    )
  }

  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      {item.windows.map((window) => (
        <div key={window.hours} className="rounded-xl border border-black/8 bg-[#faf9f6] px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-me-charcoal">{window.title}</p>
            <span
              className={`text-xs font-medium ${
                window.status === 'missing'
                  ? 'text-[#C2453A]'
                  : window.status === 'pending'
                    ? 'text-me-ochre'
                    : 'text-me-charcoal/60'
              }`}
            >
              {window.status_label}
            </span>
          </div>
          <dl className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
            {window.metrics.map((m) => (
              <div key={m.label}>
                <dt className="text-me-charcoal/55">{m.label}</dt>
                <dd className="font-semibold text-me-charcoal">{m.display}</dd>
                {m.detail && <dd className="mt-0.5 text-[10px] leading-snug text-me-charcoal/60">{m.detail}</dd>}
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  )
}

function ReadbackRow({ item }: { item: SocialReadbackItem }) {
  return (
    <li className="rounded-2xl border border-black/10 bg-white px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-md bg-me-stone/80 px-2 py-0.5 text-xs font-semibold text-me-charcoal">
            {item.kind_label}
          </span>
          <span className="text-xs text-me-charcoal/55">{item.platform_label}</span>
        </div>
        <time className="text-xs text-me-charcoal/70" dateTime={item.published_at ?? undefined}>
          {item.published_at_display}
        </time>
      </div>
      {item.kind === 'story' && (
        <p className="mt-1 text-xs text-me-charcoal/65">
          {item.story_registered ? '已登记发出' : '已发出，登记未读到'}
        </p>
      )}
      {item.story_dm ? (
        <p className="mt-1 text-xs text-me-charcoal/80 leading-relaxed">{item.story_dm}</p>
      ) : null}
      <WindowMetrics item={item} />
    </li>
  )
}

export function SocialReadbackPanel({ clientId }: { clientId: string }) {
  const [load, setLoad] = useState<LoadState>('loading')
  const [panel, setPanel] = useState<SocialReadbackPanel | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/social-readback`)
        if (cancelled) return
        if (res.status === 401 || res.status === 403) return setLoad('forbidden')
        const json = (await res.json().catch(() => ({}))) as {
          success?: boolean
          panel?: SocialReadbackPanel
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
        <p className="text-sm text-me-charcoal/70">正在读取发后成绩…</p>
        <div className="mt-3 h-20 animate-pulse rounded-xl bg-me-stone/70" />
      </section>
    )
  }

  if (load === 'forbidden') {
    return (
      <section className="rounded-2xl border border-black/10 bg-white p-4">
        <p className={ERROR_TEXT}>发后成绩只有管理员能看。</p>
      </section>
    )
  }

  if (load === 'error' || !panel) {
    return (
      <section className="rounded-2xl border border-black/10 bg-white p-4">
        <p className={ERROR_TEXT}>发后成绩读取失败，请刷新；还不行就找开发。</p>
      </section>
    )
  }

  return (
    <section className="rounded-2xl border border-black/10 bg-white p-4 md:p-5" aria-labelledby="social-readback-heading">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="social-readback-heading" className="text-base font-semibold text-me-charcoal">
            发后成绩
          </h2>
          <p className="mt-1 text-xs text-me-charcoal/65 leading-relaxed">
            最近发出内容的赞、评、转（发后 4 小时与 72 小时）。Story 观看数需要额外权限。邀请私信那条会在窗口结束后显示新开私信数。
          </p>
        </div>
        <p className="text-[11px] text-me-charcoal/50">最近 {panel.limit} 条 · 新西兰时间</p>
      </div>

      {panel.items.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-black/15 px-3 py-4 text-sm text-me-charcoal/70">
          这段时间里还没有可展示的发后读数（可能还没真发，或读数还没到点）。
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {panel.items.map((item) => (
            <ReadbackRow key={`${item.kind}-${item.id}`} item={item} />
          ))}
        </ul>
      )}
    </section>
  )
}
