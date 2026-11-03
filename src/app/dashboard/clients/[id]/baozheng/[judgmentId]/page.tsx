/**
 * 包拯复核页：两个 AI 对同一位客人判得不一样（或原 AI 读不出来、复核认为是好客人），
 * 内部员工在这里看判断那一刻的对话、点谁对。只记结论，不改客人阶段。
 * 规则书 docs/sops/2026-11-03-crm-ai-judgement-review-rules-v1.0.md BZ-18 / BZ-19。
 */

import type { ReactNode } from 'react'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { supabaseAdmin } from '@/lib/supabase'
import { loadTranscriptLines } from '@/lib/crm/stage-infer'
import { loadRulingView, type RulingView } from '@/lib/baozheng/ruling'
import { RulingButtons } from './RulingButtons'

export const dynamic = 'force-dynamic'

const NO_ACCESS = '这一页只有 Magic Engine 内部员工能看。'
const UNAVAILABLE = '这一页暂时打不开，请稍后再试。'
const NOT_FOUND = '找不到这条判断（可能已经不是 AI 写的了）。'
const HOW =
  '下面是 AI 判断那一刻已经进系统的对话（后来才补进来的不在里面）。看完点一个：原来的 AI 对、复核的对、或者都不对。' +
  '只记下谁对，不会改这位客人现在的阶段；要改阶段，请到客人页去改。'

const NZ_TIME = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Pacific/Auckland',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function Shell({ children }: { children: ReactNode }): JSX.Element {
  return <div className="mx-auto w-full max-w-4xl px-5 py-6 sm:px-8">{children}</div>
}

function Notice({ text }: { text: string }): JSX.Element {
  return <p className="rounded border border-me-charcoal/20 bg-me-ivory p-4 text-sm text-me-charcoal">{text}</p>
}

function reviewText(view: RulingView): string {
  if (view.review === null) return '这条还没复核。'
  const reason = view.review.reason ? `（${view.review.reason}）` : ''
  return `复核模型判成：${view.reviewStageLabel ?? '读不出来'}${reason}`
}

function Facts({ view }: { view: RulingView }): JSX.Element {
  const aiLine =
    view.review?.kind === 'pool'
      ? `原来的 AI 没读出来，放进了「${view.aiStageLabel}」`
      : `原来的 AI 判成：${view.aiStageLabel}`
  return (
    <div className="mb-4 space-y-1 text-sm text-me-charcoal">
      <p>AI 判断时间：{NZ_TIME.format(new Date(view.judgedAt))}</p>
      <p>{aiLine}</p>
      <p>{reviewText(view)}</p>
      {view.aiNote !== null ? <p className="text-me-charcoal/70">原来的 AI 写的理由：{view.aiNote}</p> : null}
    </div>
  )
}

function Conversation({ view }: { view: RulingView }): JSX.Element {
  if (view.lines.length === 0) {
    return <Notice text="判断那一刻没有已入库的对话。" />
  }
  return (
    <ol className="space-y-3">
      {view.lines.map((line, i) => (
        <li
          key={i}
          className={
            line.who === 'customer'
              ? 'border-l-2 border-me-charcoal/30 pl-3'
              : 'border-l-2 border-transparent pl-3'
          }
        >
          <p className="text-xs text-me-charcoal/60">
            {NZ_TIME.format(new Date(line.at))} · {line.who === 'customer' ? '客人' : '我们'} · {line.channel}
          </p>
          <p className="whitespace-pre-wrap text-sm text-me-charcoal">{line.body}</p>
        </li>
      ))}
    </ol>
  )
}

export default async function BaozhengRulingPage({
  params,
}: {
  params: { id: string; judgmentId: string }
}): Promise<JSX.Element> {
  const auth = await requireGlobalAdmin()
  if (!auth.ok) {
    return (
      <Shell>
        <Notice text={NO_ACCESS} />
      </Shell>
    )
  }

  let view: RulingView | null = null
  let failed = false
  try {
    view = await loadRulingView(
      supabaseAdmin,
      params.id,
      params.judgmentId,
      (c, ct, before) => loadTranscriptLines(c, ct, { ingestedBefore: before }),
      Date.now(),
    )
  } catch (err) {
    console.error('[baozheng-ruling] load failed:', err)
    failed = true
  }

  if (failed) {
    return (
      <Shell>
        <Notice text={UNAVAILABLE} />
      </Shell>
    )
  }

  if (view === null) {
    return (
      <Shell>
        <Notice text={NOT_FOUND} />
      </Shell>
    )
  }

  return (
    <Shell>
      <h1 className="mb-4 text-lg font-semibold text-me-charcoal">这位客人那时候到了哪一步？</h1>
      <Facts view={view} />
      <p className="mb-4 text-sm text-me-charcoal/80">{HOW}</p>
      <div className="mb-6">
        <RulingButtons clientId={params.id} judgmentId={params.judgmentId} current={view.ruling} />
      </div>
      <Conversation view={view} />
    </Shell>
  )
}
