'use client'

import type { PublishPreviewResponse } from '@/lib/tour-catalog/publish-contract'
import { formatBatchTime } from './catalog-format'

type Tone = 'neutral' | 'pending' | 'ok' | 'danger'

interface MainLine {
  tone: Tone
  text: string
  canPublish: boolean
}

function mainLine(preview: PublishPreviewResponse): MainLine {
  if (preview.firstPublish || preview.publishedVersion === 0) {
    return { tone: 'neutral', text: '还没上架过 · 外面还看不到这份目录', canPublish: true }
  }
  const time = preview.publishedAt ? formatBatchTime(preview.publishedAt) : ''
  if (preview.changes.length > 0) {
    const n = preview.changes.length
    const x = preview.publishedVersion
    return {
      tone: 'pending',
      text: `有 ${n} 处改动还没上架 · 客人现在看到的是第 ${x} 版（${time}）`,
      canPublish: true,
    }
  }
  const x = preview.publishedVersion
  return {
    tone: 'ok',
    text: `已上架第 ${x} 版 · ${time} · 草稿和对外内容一致`,
    canPublish: false,
  }
}

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'border-black/10 bg-white',
  pending: 'border-[#B7791F]/30 bg-[#B7791F]/10',
  ok: 'border-[#5C8A4A]/30 bg-[#5C8A4A]/10',
  danger: 'border-[#C2453A]/30 bg-[#C2453A]/10',
}

const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-me-charcoal',
  pending: 'text-[#B7791F]',
  ok: 'text-[#5C8A4A]',
  danger: 'text-[#C2453A]',
}

function PublishBarShell(props: {
  tone: Tone
  children: React.ReactNode
}): JSX.Element {
  const { tone, children } = props
  return (
    <section
      aria-label="上架状态"
      data-tone={tone}
      className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${TONE_CLASSES[tone]}`}
    >
      {children}
    </section>
  )
}

function PublishBarError(props: {
  error: string
  onRetry: () => void
}): JSX.Element {
  const { error, onRetry } = props
  return (
    <PublishBarShell tone="neutral">
      <p className={`text-sm font-semibold ${TONE_TEXT.neutral}`}>读不到上架状态：{error}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-lg border border-black/10 bg-white px-3 py-1 text-sm font-semibold text-me-charcoal hover:bg-me-ivory"
      >
        重试
      </button>
    </PublishBarShell>
  )
}

function PublishBarLoading(): JSX.Element {
  return (
    <PublishBarShell tone="neutral">
      <p className={`text-sm font-semibold ${TONE_TEXT.neutral}`}>正在读取上架状态…</p>
    </PublishBarShell>
  )
}

/** One paragraph for "the latest version was a revert": what is live, how the draft differs, what to do. */
function afterRevertText(preview: PublishPreviewResponse, toVersion: number): string {
  const time = preview.publishedAt ? `，${formatBatchTime(preview.publishedAt)}` : ''
  const live = `客人现在看到的是第 ${preview.publishedVersion} 版（内容换回了第 ${toVersion} 版${time}）。`
  const k = preview.changes.length
  if (k === 0) return `${live}草稿和它已经一致，没有需要上架的改动。`
  const risky = preview.highRiskCount > 0 ? `，其中 ${preview.highRiskCount} 处涉及价格或班期` : ''
  return `${live}草稿和它有 ${k} 处不同${risky}。请先把草稿里的错改掉；直接上架会把当时换掉的内容重新发出去。`
}

function PublishBarStatus(props: {
  preview: PublishPreviewResponse
  line: MainLine
  tone: Tone
  onOpenPublish: () => void
}): JSX.Element {
  const { preview, line, tone, onOpenPublish } = props
  return (
    <PublishBarShell tone={tone}>
      <div className="min-w-0">
        {preview.afterRevert ? (
          <p className="text-sm font-black text-[#C2453A]">
            {afterRevertText(preview, preview.afterRevert.toVersion)}
          </p>
        ) : (
          <p className={`text-sm font-semibold ${TONE_TEXT[tone]}`}>
            {line.text}
            {preview.changes.length > 0 && preview.highRiskCount > 0 ? (
              <span className="ml-2 rounded-full bg-[#C2453A] px-2 py-0.5 text-xs font-black text-white">
                其中 {preview.highRiskCount} 处涉及价格或班期
              </span>
            ) : null}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onOpenPublish}
        disabled={!line.canPublish}
        className="rounded-lg bg-me-charcoal px-4 py-2 text-sm font-black text-white hover:bg-me-charcoal/85 disabled:cursor-not-allowed disabled:opacity-40"
      >
        查看并上架
      </button>
    </PublishBarShell>
  )
}

export function PublishBar(props: {
  preview: PublishPreviewResponse | null
  loading: boolean
  error: string | null
  onOpenPublish: () => void
  onRetry: () => void
}) {
  const { preview, error, onOpenPublish, onRetry } = props

  if (preview === null && error) {
    return <PublishBarError error={error} onRetry={onRetry} />
  }

  if (preview === null) {
    return <PublishBarLoading />
  }

  const line = mainLine(preview)
  const tone: Tone = preview.afterRevert ? 'danger' : line.tone

  return (
    <PublishBarStatus
      preview={preview}
      line={line}
      tone={tone}
      onOpenPublish={onOpenPublish}
    />
  )
}
