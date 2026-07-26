'use client'

/**
 * 客户消息 — the Messenger worklist.
 *
 * A CTS salesperson opens this on a phone between other jobs. The screen has to
 * answer, in this order: who is waiting on me, what do they want, what do I say.
 * The AI does the reading; the person does the sending (PM, 2026-07-26).
 *
 * Read-only against the hourly sync — nothing on this page pulls from Facebook.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import type { Conversation, ConversationsResponse } from './types'
import { ConversationCard } from './_components/ConversationCard'

type Filter = 'awaiting' | 'followUp' | 'high' | 'all'

const FILTER_LABEL: Record<Filter, string> = {
  awaiting: '等我们回',
  followUp: '该回访',
  high: '高意向',
  all: '全部',
}

function matches(c: Conversation, filter: Filter): boolean {
  if (filter === 'awaiting') return c.awaitingReply
  if (filter === 'followUp') return c.followUpOverdue
  if (filter === 'high') return c.brief?.intent_level === 'high'
  return true
}

/** Big number + label. The three counts a salesperson steers by. */
function Stat({ value, label, strong }: { value: number; label: string; strong?: boolean }) {
  return (
    <div className="rounded-xl border border-black/10 bg-white px-3 py-3 text-center">
      <p className={`text-2xl font-black ${strong && value > 0 ? 'text-[#C2453A]' : 'text-me-charcoal'}`}>
        {value}
      </p>
      <p className="mt-0.5 text-[11px] font-semibold text-me-charcoal/45">{label}</p>
    </div>
  )
}

export default function MessengerPage() {
  const params = useParams()
  const clientId = params.id as string

  const [data, setData] = useState<ConversationsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/messenger/conversations`)
      const json = (await res.json()) as ConversationsResponse
      if (!res.ok) {
        setError(json.error ?? '加载失败')
        return
      }
      setData(json)
      // Land on the queue that matters, but never on an empty screen.
      setFilter(
        json.counts.awaitingReply > 0
          ? 'awaiting'
          : json.counts.followUpOverdue > 0
            ? 'followUp'
            : 'all',
      )
    } catch {
      setError('加载失败，检查网络后再试。')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => {
    void load()
  }, [load])

  const visible = useMemo(
    () => (data?.conversations ?? []).filter((c) => matches(c, filter)),
    [data, filter],
  )

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:py-8">
      <header className="mb-5">
        <Link
          href={`/dashboard/clients/${clientId}`}
          className="text-sm text-me-charcoal/40 hover:text-me-charcoal"
        >
          ← 返回客户
        </Link>
        <h1 className="mt-2 text-2xl font-black text-me-charcoal">客户消息</h1>
        <p className="mt-1 text-sm leading-relaxed text-me-charcoal/45">
          Facebook 私信每小时自动同步 · AI 读完整段对话，写好需求卡和一条英文回复草稿。
          <span className="font-semibold text-me-charcoal/60">草稿永远不会自己发出去，要你按发送。</span>
        </p>
      </header>

      {loading && <p className="py-16 text-center text-sm text-me-charcoal/40">加载中…</p>}

      {error && (
        <div className="rounded-xl border border-[#C2453A]/30 bg-[#C2453A]/8 p-4">
          <p className="text-sm font-semibold text-[#C2453A]">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-2 text-sm font-black text-me-charcoal underline"
          >
            重试
          </button>
        </div>
      )}

      {!loading && !error && data && data.counts.total === 0 && (
        <div className="rounded-xl border border-black/10 bg-white p-8 text-center">
          <p className="text-sm text-me-charcoal/60">还没有同步到任何 Facebook 私信。</p>
          <p className="mt-2 text-xs leading-relaxed text-me-charcoal/40">
            系统每小时自动拉一次。如果这里一直是空的，说明主页还没接上 —— 找 Magic Lab 团队看一眼。
          </p>
        </div>
      )}

      {!loading && !error && data && data.counts.total > 0 && (
        <>
          {/* 手机上四个横排会挤成一条,两行两列反而看得清 */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat value={data.counts.awaitingReply} label="等我们回" strong />
            <Stat value={data.counts.followUpOverdue} label="该回访" strong />
            <Stat value={data.counts.highIntent} label="高意向" />
            <Stat value={data.counts.total} label="全部对话" />
          </div>

          <div className="mt-4 flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {(['awaiting', 'followUp', 'high', 'all'] as Filter[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-black ${
                  filter === key
                    ? 'bg-me-charcoal text-white'
                    : 'border border-me-stone text-me-charcoal/60'
                }`}
              >
                {FILTER_LABEL[key]}
              </button>
            ))}
            <button
              type="button"
              onClick={() => void load()}
              className="ml-auto shrink-0 px-2 text-xs font-semibold text-me-charcoal/40"
            >
              刷新
            </button>
          </div>

          <div className="mt-4 space-y-3">
            {visible.map((c) => (
              <ConversationCard
                key={c.id}
                clientId={clientId}
                conversation={c}
                viewerEmail={data.viewerEmail}
              />
            ))}
            {visible.length === 0 && (
              <p className="py-10 text-center text-sm text-me-charcoal/40">
                这一类里现在没有对话。
              </p>
            )}
          </div>

          <p className="mt-8 text-center text-[11px] text-me-charcoal/25">
            需求卡由 AI 生成，可能会漏或读错 · 拿不准就点「看完整对话」自己核一遍
          </p>
        </>
      )}
    </div>
  )
}
