'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { cx } from '@/components/ui/me-theme'

// ── Types ─────────────────────────────────────────────────────────────────────

type Mode = 'magic_lab_class' | 'ray_perspective'
type Platform = 'xiaohongshu' | 'instagram' | 'linkedin' | 'wechat'
type InputType = 'url' | 'text' | 'image_url'
type ImageStatus = 'none' | 'pending' | 'processing' | 'completed' | 'failed'

interface CopyOutput {
  headline: string
  body: string
  hashtags: string[]
  platform_note: string
}

interface GenerateResult {
  job_id: string
  copy: CopyOutput
  image_prompt: string
  image_url: string | null
  image_status: ImageStatus
}

interface RecentJob {
  id: string
  mode: Mode
  platform: Platform
  source_label: string | null
  status: string
  image_status: ImageStatus
  trigger_type?: string
  created_at: string
  generated_copy: CopyOutput | null
  image_url: string | null
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PLATFORM_LABELS: Record<Platform, string> = {
  xiaohongshu: '小红书',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  wechat: '微信',
}

const MODE_META = {
  magic_lab_class: {
    label: 'Magic Lab Class',
    desc: '教学帖 · 干货知识点',
    color: 'text-[#EBCB8B]',
    bg: 'bg-[#C4912E]/20 border-[#C4912E]/40',
    inactive: 'border-white/10 text-white/40 hover:border-white/20',
  },
  ray_perspective: {
    label: '大瑞视角',
    desc: '个人观点 · 直接犀利',
    color: 'text-sky-300',
    bg: 'bg-sky-500/20 border-sky-400/40',
    inactive: 'border-white/10 text-white/40 hover:border-white/20',
  },
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PosterStudioPage() {
  const [mode, setMode] = useState<Mode>('magic_lab_class')
  const [platform, setPlatform] = useState<Platform>('xiaohongshu')
  const [inputType, setInputType] = useState<InputType>('url')
  const [inputValue, setInputValue] = useState('')
  const [sourceLabel, setSourceLabel] = useState('')
  const [generateImage, setGenerateImage] = useState(true)

  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<GenerateResult | null>(null)

  const [recentJobs, setRecentJobs] = useState<RecentJob[]>([])
  const [copiedField, setCopiedField] = useState<string | null>(null)

  const pollRef = useRef<NodeJS.Timeout | null>(null)

  // ── Load recent jobs ───────────────────────────────────────────────────────
  const loadRecentJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/poster-studio/jobs')
      if (res.ok) {
        const data = await res.json()
        setRecentJobs(data.jobs ?? [])
      }
    } catch { /* silent */ }
  }, [])

  useEffect(() => { loadRecentJobs() }, [loadRecentJobs])

  // ── Poll for image completion ──────────────────────────────────────────────
  const startPolling = useCallback((jobId: string) => {
    let attempts = 0
    const MAX_ATTEMPTS = 40 // ~2 min

    pollRef.current = setInterval(async () => {
      attempts++
      if (attempts > MAX_ATTEMPTS) {
        clearInterval(pollRef.current!)
        setResult(prev => prev ? { ...prev, image_status: 'failed' } : prev)
        return
      }

      try {
        const res = await fetch(`/api/poster-studio/jobs/${jobId}`)
        if (!res.ok) return
        const job = await res.json()

        if (job.image_status === 'completed' && job.image_url) {
          clearInterval(pollRef.current!)
          setResult(prev => prev
            ? { ...prev, image_url: job.image_url, image_status: 'completed' }
            : prev
          )
          loadRecentJobs()
        } else if (job.image_status === 'failed') {
          clearInterval(pollRef.current!)
          setResult(prev => prev ? { ...prev, image_status: 'failed' } : prev)
        }
      } catch { /* silent */ }
    }, 3000)
  }, [loadRecentJobs])

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  // ── Generate ───────────────────────────────────────────────────────────────
  async function handleGenerate() {
    if (!inputValue.trim()) {
      setError('请填写输入内容')
      return
    }
    if (pollRef.current) clearInterval(pollRef.current)

    setIsGenerating(true)
    setError(null)
    setResult(null)

    const body: Record<string, unknown> = {
      mode, platform, input_type: inputType, generate_image: generateImage,
      source_label: sourceLabel || undefined,
    }
    if (inputType === 'url') body.input_url = inputValue
    else if (inputType === 'text') body.input_text = inputValue
    else body.input_image_url = inputValue

    try {
      const res = await fetch('/api/poster-studio/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Generation failed')

      setResult(data)
      loadRecentJobs()

      if (data.image_status === 'pending') {
        startPolling(data.job_id)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setIsGenerating(false)
    }
  }

  // ── Copy to clipboard ──────────────────────────────────────────────────────
  function copyText(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(key)
      setTimeout(() => setCopiedField(null), 2000)
    })
  }

  function copyAll() {
    if (!result) return
    const { headline, body, hashtags } = result.copy
    const text = `${headline}\n\n${body}\n\n${hashtags.map(t => `#${t}`).join(' ')}`
    copyText(text, 'all')
  }

  // ── Load a past job result ─────────────────────────────────────────────────
  function loadJob(job: RecentJob) {
    if (!job.generated_copy) return
    setResult({
      job_id: job.id,
      copy: job.generated_copy,
      image_prompt: '',
      image_url: job.image_url,
      image_status: job.image_status,
    })
    if (job.mode) setMode(job.mode)
    if (job.platform) setPlatform(job.platform)
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full min-h-screen flex-col bg-[#0A0A0A] p-6 pb-0">

      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">内容工作室</h1>
          <p className="mt-0.5 text-sm text-white/40">
            把全网素材改写成 Magic Lab 风格 · 自动生图
          </p>
        </div>
        <span className="rounded-full bg-white/[.06] px-3 py-1 text-[11px] font-medium text-white/40">
          内部工具
        </span>
      </div>

      {/* Body: split panel */}
      <div className="flex flex-1 gap-5 overflow-hidden pb-6">

        {/* ── Left: Input form ────────────────────────────────────────────── */}
        <div className="flex w-[380px] shrink-0 flex-col gap-4">

          {/* Mode selector */}
          <div className="flex gap-2">
            {(Object.keys(MODE_META) as Mode[]).map(m => {
              const meta = MODE_META[m]
              const active = mode === m
              return (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={cx(
                    'flex-1 rounded-xl border px-3 py-2.5 text-left transition',
                    active ? meta.bg : meta.inactive,
                  )}
                >
                  <p className={cx('text-[13px] font-semibold', active ? meta.color : 'text-white/50')}>
                    {meta.label}
                  </p>
                  <p className="mt-0.5 text-[11px] text-white/30">{meta.desc}</p>
                </button>
              )
            })}
          </div>

          {/* Platform */}
          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-widest text-white/30">
              发布平台
            </label>
            <div className="flex gap-1.5 flex-wrap">
              {(Object.keys(PLATFORM_LABELS) as Platform[]).map(p => (
                <button
                  key={p}
                  onClick={() => setPlatform(p)}
                  className={cx(
                    'rounded-lg px-3 py-1.5 text-[12px] font-medium transition',
                    platform === p
                      ? 'bg-white/[.12] text-white'
                      : 'bg-white/[.04] text-white/40 hover:bg-white/[.07] hover:text-white/60',
                  )}
                >
                  {PLATFORM_LABELS[p]}
                </button>
              ))}
            </div>
          </div>

          {/* Input type */}
          <div>
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-widest text-white/30">
              素材来源
            </label>
            <div className="flex gap-1.5">
              {([
                ['url', '🌐 网址'],
                ['text', '📝 文字'],
                ['image_url', '🖼 图片URL'],
              ] as [InputType, string][]).map(([t, lbl]) => (
                <button
                  key={t}
                  onClick={() => { setInputType(t); setInputValue('') }}
                  className={cx(
                    'flex-1 rounded-lg py-1.5 text-[12px] font-medium transition',
                    inputType === t
                      ? 'bg-white/[.12] text-white'
                      : 'bg-white/[.04] text-white/40 hover:bg-white/[.07] hover:text-white/60',
                  )}
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          {/* Input area */}
          <div className="flex-1">
            <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-widest text-white/30">
              {inputType === 'url' ? '网页 URL' : inputType === 'image_url' ? '图片 URL' : '粘贴内容'}
            </label>
            {inputType === 'text' ? (
              <textarea
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                placeholder="粘贴你在网上看到的文章、数据、文案..."
                rows={7}
                className="w-full resize-none rounded-xl border border-white/[.08] bg-white/[.03] px-3 py-2.5 text-[13px] text-white/80 placeholder-white/20 outline-none focus:border-white/20"
              />
            ) : (
              <input
                type="url"
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                placeholder={inputType === 'url'
                  ? 'https://example.com/article'
                  : 'https://example.com/image.jpg'
                }
                className="w-full rounded-xl border border-white/[.08] bg-white/[.03] px-3 py-2.5 text-[13px] text-white/80 placeholder-white/20 outline-none focus:border-white/20"
              />
            )}
          </div>

          {/* Source label + generate image toggle */}
          <div className="flex gap-3">
            <input
              type="text"
              value={sourceLabel}
              onChange={e => setSourceLabel(e.target.value)}
              placeholder="来源备注（可选）"
              className="flex-1 rounded-xl border border-white/[.08] bg-white/[.03] px-3 py-2 text-[12px] text-white/70 placeholder-white/20 outline-none focus:border-white/20"
            />
            <button
              onClick={() => setGenerateImage(v => !v)}
              className={cx(
                'flex items-center gap-1.5 rounded-xl border px-3 py-2 text-[12px] font-medium transition',
                generateImage
                  ? 'border-[#C4912E]/40 bg-[#C4912E]/10 text-[#EBCB8B]'
                  : 'border-white/[.08] text-white/35',
              )}
            >
              🖼 生图
            </button>
          </div>

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            disabled={isGenerating || !inputValue.trim()}
            className={cx(
              'w-full rounded-xl py-3 text-[14px] font-bold transition',
              isGenerating || !inputValue.trim()
                ? 'cursor-not-allowed bg-white/[.05] text-white/25'
                : 'bg-[#C4912E] text-black hover:bg-[#d9a53a]',
            )}
          >
            {isGenerating ? '生成中…' : '一键生成'}
          </button>

          {error && (
            <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-[12px] text-red-400">
              {error}
            </p>
          )}

          {/* Recent history */}
          {recentJobs.length > 0 && (
            <div className="mt-1">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-widest text-white/25">
                最近生成
              </p>
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {recentJobs.slice(0, 8).map(job => (
                  <button
                    key={job.id}
                    onClick={() => loadJob(job)}
                    className="flex w-full items-center gap-2.5 rounded-lg border border-white/[.06] bg-white/[.02] px-2.5 py-2 text-left transition hover:border-white/[.1] hover:bg-white/[.04]"
                  >
                    <span className="text-[11px]">
                      {job.trigger_type === 'cron' ? '🤖' :
                       job.mode === 'magic_lab_class' ? '📚' : '💬'}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-white/55">
                      {job.generated_copy?.headline ?? job.source_label ?? '（无标题）'}
                    </span>
                    <span className="shrink-0 text-[10px] text-white/25">
                      {PLATFORM_LABELS[job.platform]}
                    </span>
                    {job.image_status === 'completed' && (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Right: Output area ───────────────────────────────────────────── */}
        <div className="flex min-w-0 flex-1 flex-col gap-4">

          {/* Empty state */}
          {!result && !isGenerating && (
            <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-white/[.08]">
              <p className="text-4xl opacity-20">✨</p>
              <p className="mt-3 text-sm text-white/25">填写左侧素材，点击「一键生成」</p>
            </div>
          )}

          {/* Generating skeleton */}
          {isGenerating && (
            <div className="flex flex-1 flex-col gap-3 rounded-2xl border border-white/[.06] bg-white/[.02] p-5">
              <div className="h-5 w-2/3 animate-pulse rounded-full bg-white/[.06]" />
              <div className="space-y-2 mt-2">
                {[80, 65, 75, 60, 50].map((w, i) => (
                  <div key={i} className="animate-pulse rounded-full bg-white/[.04]" style={{ height: 12, width: `${w}%` }} />
                ))}
              </div>
            </div>
          )}

          {/* Result */}
          {result && !isGenerating && (
            <>
              {/* Copy card */}
              <div className="rounded-2xl border border-white/[.08] bg-white/[.02] p-5">
                {/* Header */}
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={cx(
                      'text-[11px] font-bold uppercase tracking-widest',
                      mode === 'magic_lab_class' ? 'text-[#EBCB8B]' : 'text-sky-300',
                    )}>
                      {MODE_META[mode].label}
                    </span>
                    <span className="text-[11px] text-white/30">·</span>
                    <span className="text-[11px] text-white/30">{PLATFORM_LABELS[platform]}</span>
                  </div>
                  <button
                    onClick={copyAll}
                    className="rounded-lg bg-white/[.06] px-3 py-1 text-[12px] text-white/55 transition hover:bg-white/[.1] hover:text-white/80"
                  >
                    {copiedField === 'all' ? '✓ 已复制' : '复制全部'}
                  </button>
                </div>

                {/* Headline */}
                <div className="mb-3">
                  <p className="mb-1 text-[10px] uppercase tracking-widest text-white/25">标题</p>
                  <div className="flex items-start gap-2">
                    <p className="flex-1 text-[16px] font-bold text-white leading-tight">
                      {result.copy.headline}
                    </p>
                    <button
                      onClick={() => copyText(result.copy.headline, 'headline')}
                      className="shrink-0 rounded-md bg-white/[.05] px-2 py-1 text-[11px] text-white/30 hover:text-white/60"
                    >
                      {copiedField === 'headline' ? '✓' : '复制'}
                    </button>
                  </div>
                </div>

                {/* Body */}
                <div className="mb-3">
                  <p className="mb-1 text-[10px] uppercase tracking-widest text-white/25">正文</p>
                  <div className="flex items-start gap-2">
                    <p className="flex-1 whitespace-pre-wrap text-[13px] leading-relaxed text-white/75">
                      {result.copy.body}
                    </p>
                    <button
                      onClick={() => copyText(result.copy.body, 'body')}
                      className="shrink-0 rounded-md bg-white/[.05] px-2 py-1 text-[11px] text-white/30 hover:text-white/60"
                    >
                      {copiedField === 'body' ? '✓' : '复制'}
                    </button>
                  </div>
                </div>

                {/* Hashtags */}
                <div className="mb-3">
                  <p className="mb-1.5 text-[10px] uppercase tracking-widest text-white/25">标签</p>
                  <div className="flex flex-wrap gap-1.5">
                    {result.copy.hashtags.map(tag => (
                      <span
                        key={tag}
                        onClick={() => copyText(`#${tag}`, tag)}
                        className="cursor-pointer rounded-full bg-white/[.06] px-2.5 py-1 text-[12px] text-white/55 transition hover:bg-white/[.1] hover:text-white/80"
                        title="点击复制"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Platform note */}
                {result.copy.platform_note && (
                  <p className="rounded-lg border border-white/[.06] bg-white/[.03] px-3 py-2 text-[12px] text-white/40 italic">
                    💡 {result.copy.platform_note}
                  </p>
                )}
              </div>

              {/* Image card */}
              {generateImage && (
                <div className="rounded-2xl border border-white/[.08] bg-white/[.02] p-5">
                  <p className="mb-3 text-[11px] font-bold uppercase tracking-widest text-white/30">
                    配图 · Visual Studio
                  </p>

                  {result.image_status === 'completed' && result.image_url ? (
                    <div className="space-y-3">
                      <img
                        src={result.image_url}
                        alt="Generated poster"
                        className="w-full rounded-xl object-cover"
                        style={{ maxHeight: 400 }}
                      />
                      <a
                        href={result.image_url}
                        target="_blank"
                        rel="noreferrer"
                        download
                        className="block w-full rounded-xl border border-white/[.08] py-2 text-center text-[12px] text-white/50 transition hover:border-white/20 hover:text-white/70"
                      >
                        ↓ 下载图片
                      </a>
                    </div>
                  ) : result.image_status === 'pending' || result.image_status === 'processing' ? (
                    <div className="flex flex-col items-center gap-3 py-10">
                      <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-[#C4912E]" />
                      <p className="text-[12px] text-white/30">Visual Studio 生成中…（约 30-60s）</p>
                      <p className="text-[11px] text-white/20 text-center max-w-xs">
                        {result.image_prompt}
                      </p>
                    </div>
                  ) : result.image_status === 'failed' ? (
                    <p className="py-8 text-center text-[12px] text-red-400/70">
                      图片生成失败 — 文案已可使用
                    </p>
                  ) : null}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
