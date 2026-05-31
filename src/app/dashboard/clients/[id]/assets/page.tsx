'use client'

/**
 * Phase 21.B.2+7 — Visual Asset Intelligence
 * /dashboard/clients/[id]/assets
 *
 * Customer photo library: upload images → Vision AI auto-tags → Hook/Middle/CTA scores
 * → theme-based storyboard selection → Seedance/Kling/Runway prompts
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

// ─── Types ───────────────────────────────────────────────────────────────────

interface VisionMetadata {
  objects?: string[]
  scene?: string
  emotion?: string
  has_people?: boolean
  is_indoor?: boolean
  brand_elements?: string[]
  quality_score?: number
  ai_notes?: string
}

interface ClientAsset {
  id: string
  storage_url: string
  original_filename: string
  status: 'pending' | 'analyzing' | 'analyzed' | 'error'
  vision_metadata: VisionMetadata
  hook_score: number
  middle_score: number
  cta_score: number
  recommended_use: 'hook' | 'middle' | 'cta' | 'skip' | null
  created_at: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function scoreBar(score: number, color: string) {
  const pct = Math.min(100, Math.max(0, (score / 10) * 100))
  return (
    <div className="w-full bg-zinc-800 rounded-full h-1.5">
      <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

function StatusBadge({ status }: { status: ClientAsset['status'] }) {
  const map: Record<ClientAsset['status'], { label: string; cls: string }> = {
    pending:   { label: '待分析', cls: 'bg-zinc-700 text-zinc-300' },
    analyzing: { label: '分析中…', cls: 'bg-amber-900/60 text-amber-300 animate-pulse' },
    analyzed:  { label: '已分析', cls: 'bg-emerald-900/60 text-emerald-300' },
    error:     { label: '出错', cls: 'bg-red-900/60 text-red-400' },
  }
  const { label, cls } = map[status]
  return <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${cls}`}>{label}</span>
}

function UseBadge({ use }: { use: ClientAsset['recommended_use'] }) {
  if (!use || use === 'skip') return null
  const map = {
    hook:   'bg-purple-900/60 text-purple-300',
    middle: 'bg-blue-900/60 text-blue-300',
    cta:    'bg-cyan-900/60 text-cyan-300',
  }
  const labels = { hook: 'Hook', middle: 'Middle', cta: 'CTA' }
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${map[use]}`}>
      {labels[use]}
    </span>
  )
}

// ─── Asset Card ───────────────────────────────────────────────────────────────

function AssetCard({ asset }: { asset: ClientAsset }) {
  const [expanded, setExpanded] = useState(false)
  const vm = asset.vision_metadata

  return (
    <div
      className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden cursor-pointer hover:border-zinc-600 transition-colors"
      onClick={() => setExpanded(e => !e)}
    >
      {/* Thumbnail */}
      <div className="relative aspect-square bg-zinc-950">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset.storage_url}
          alt={asset.original_filename}
          className="w-full h-full object-cover"
        />
        <div className="absolute top-1.5 left-1.5 flex gap-1">
          <StatusBadge status={asset.status} />
          <UseBadge use={asset.recommended_use} />
        </div>
      </div>

      {/* Footer */}
      <div className="p-2">
        <p className="text-[11px] text-zinc-400 truncate mb-1.5">{asset.original_filename}</p>

        {asset.status === 'analyzed' && (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-purple-400 w-10 shrink-0">Hook</span>
              {scoreBar(asset.hook_score, 'bg-purple-500')}
              <span className="text-[10px] text-zinc-400 w-5 text-right">{asset.hook_score.toFixed(1)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-blue-400 w-10 shrink-0">Mid</span>
              {scoreBar(asset.middle_score, 'bg-blue-500')}
              <span className="text-[10px] text-zinc-400 w-5 text-right">{asset.middle_score.toFixed(1)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-cyan-400 w-10 shrink-0">CTA</span>
              {scoreBar(asset.cta_score, 'bg-cyan-500')}
              <span className="text-[10px] text-zinc-400 w-5 text-right">{asset.cta_score.toFixed(1)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Expanded metadata */}
      {expanded && asset.status === 'analyzed' && (
        <div className="px-2 pb-2 border-t border-zinc-800 pt-2 space-y-1.5">
          {vm.ai_notes && (
            <p className="text-[11px] text-zinc-300 leading-relaxed">{vm.ai_notes}</p>
          )}
          <div className="flex flex-wrap gap-1">
            {vm.scene && (
              <span className="text-[10px] bg-zinc-800 text-zinc-300 px-1.5 py-0.5 rounded">{vm.scene}</span>
            )}
            {vm.emotion && (
              <span className="text-[10px] bg-zinc-800 text-zinc-300 px-1.5 py-0.5 rounded">{vm.emotion}</span>
            )}
            {vm.objects?.slice(0, 4).map(o => (
              <span key={o} className="text-[10px] bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded">{o}</span>
            ))}
          </div>
          {typeof vm.quality_score === 'number' && (
            <p className="text-[10px] text-zinc-500">Quality: {vm.quality_score.toFixed(1)} / 10</p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Upload Zone ──────────────────────────────────────────────────────────────

function UploadZone({ clientId, onUploaded }: { clientId: string; onUploaded: () => void }) {
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  const upload = useCallback(async (files: FileList | File[]) => {
    const arr = Array.from(files).filter(f => f.type.startsWith('image/'))
    if (arr.length === 0) return

    setUploading(true)
    setErrors([])
    setProgress({ done: 0, total: arr.length })

    const BATCH = 10
    for (let i = 0; i < arr.length; i += BATCH) {
      const batch = arr.slice(i, i + BATCH)
      const fd = new FormData()
      batch.forEach(f => fd.append('files', f))

      const res = await fetch(`/api/clients/${clientId}/assets`, { method: 'POST', body: fd })
      const json = await res.json()
      if (json.errors?.length) setErrors(prev => [...prev, ...json.errors])
      setProgress(p => p ? { done: Math.min(p.total, p.done + batch.length), total: p.total } : null)
    }

    setUploading(false)
    setProgress(null)
    onUploaded()
  }, [clientId, onUploaded])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    upload(e.dataTransfer.files)
  }, [upload])

  return (
    <div className="mb-6">
      <div
        className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer
          ${dragging ? 'border-cyan-500 bg-cyan-950/20' : 'border-zinc-700 hover:border-zinc-500'}`}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !uploading && inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*"
          className="hidden"
          onChange={e => e.target.files && upload(e.target.files)}
        />

        {uploading && progress ? (
          <div>
            <div className="w-full max-w-xs mx-auto bg-zinc-800 rounded-full h-2 mb-2">
              <div
                className="h-2 rounded-full bg-cyan-500 transition-all"
                style={{ width: `${(progress.done / progress.total) * 100}%` }}
              />
            </div>
            <p className="text-sm text-zinc-400">上传中… {progress.done} / {progress.total}</p>
          </div>
        ) : (
          <>
            <div className="text-3xl mb-2">📸</div>
            <p className="text-sm text-zinc-300 font-medium mb-1">拖拽图片到这里，或点击选择</p>
            <p className="text-xs text-zinc-500">支持 JPEG · PNG · WebP · HEIC · 无数量限制 · 最大 50 MB/张</p>
            <p className="text-xs text-zinc-600 mt-1">上传后自动排队 Vision AI 分析</p>
          </>
        )}
      </div>

      {errors.length > 0 && (
        <div className="mt-2 text-xs text-red-400 space-y-0.5">
          {errors.map((e, i) => <p key={i}>⚠ {e}</p>)}
        </div>
      )}
    </div>
  )
}

// ─── Storyboard types ────────────────────────────────────────────────────────

interface StoryboardScene {
  scene: number
  role: 'hook' | 'middle' | 'cta'
  asset_id: string
  description: string
}

interface StoryboardRow {
  id: string
  theme: string
  storyboard_json: {
    scenes: StoryboardScene[]
    market_context: string
    brand_voice: string
  }
  seedance_prompt: string
  kling_prompt: string
  runway_prompt: string
  hook_asset_id: string
  middle_asset_ids: string[]
  cta_asset_id: string
  created_at: string
}

interface GenerateResult {
  storyboard: StoryboardRow
  selection: {
    hook:   { id: string; url: string }
    middle: { id: string; url: string }[]
    cta:    { id: string; url: string }
  }
}

// ─── Copy button ──────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button
      onClick={copy}
      className="text-[11px] px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors shrink-0"
    >
      {copied ? '✓ 已复制' : '复制'}
    </button>
  )
}

// ─── Storyboard Panel ─────────────────────────────────────────────────────────

function StoryboardPanel({
  clientId,
  analyzedCount,
  assetMap,
}: {
  clientId: string
  analyzedCount: number
  assetMap: Map<string, ClientAsset>
}) {
  const [theme, setTheme] = useState('')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<GenerateResult | null>(null)
  const [history, setHistory] = useState<StoryboardRow[]>([])
  const [activePrompt, setActivePrompt] = useState<'seedance' | 'kling' | 'runway'>('seedance')
  const [sending, setSending] = useState(false)
  const [sentDraftId, setSentDraftId] = useState<string | null>(null)

  // Load history
  useEffect(() => {
    fetch(`/api/clients/${clientId}/assets/storyboard`)
      .then(r => r.json())
      .then(j => { if (j.success) setHistory(j.storyboards ?? []) })
      .catch(() => undefined)
  }, [clientId, result])

  const sendToKanban = async () => {
    if (!result?.storyboard?.id) return
    setSending(true)
    setSentDraftId(null)
    try {
      const res = await fetch(
        `/api/clients/${clientId}/assets/storyboard/${result.storyboard.id}/send-to-kanban`,
        { method: 'POST' }
      )
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setSentDraftId(json.draft_id)
    } catch (e) {
      setError(e instanceof Error ? e.message : '发送失败')
    } finally {
      setSending(false)
    }
  }

  const generate = async () => {
    if (!theme.trim()) return
    setGenerating(true)
    setError(null)
    setResult(null)
    setSentDraftId(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/assets/storyboard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setResult(json as GenerateResult)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setGenerating(false)
    }
  }

  const activeResult = result?.storyboard ?? (history.length > 0 ? null : null)
  const displayBoard = result?.storyboard ?? null
  const displaySelection = result?.selection ?? null

  const promptText = displayBoard
    ? activePrompt === 'seedance' ? displayBoard.seedance_prompt
    : activePrompt === 'kling'   ? displayBoard.kling_prompt
    : displayBoard.runway_prompt
    : ''

  return (
    <div className="mt-10 border-t border-zinc-800 pt-8">
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-sm font-semibold text-zinc-100">生成 Storyboard</h2>
        <span className="text-xs text-zinc-500">输入主题 → 自动选图 → 视频提示词</span>
      </div>

      {analyzedCount === 0 && (
        <div className="bg-amber-950/30 border border-amber-800/40 rounded-lg p-3 mb-4 text-xs text-amber-300">
          还没有已分析的图片。请先上传图片，等待 Vision AI 分析完成（约 2 分钟）后再生成 Storyboard。
        </div>
      )}

      {/* Theme input */}
      <div className="flex gap-2 mb-6">
        <input
          type="text"
          value={theme}
          onChange={e => setTheme(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !generating && analyzedCount > 0 && generate()}
          placeholder="输入视频主题，例如：Auckland flooring showroom clearance sale"
          className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-cyan-600"
          disabled={generating || analyzedCount === 0}
        />
        <button
          onClick={generate}
          disabled={!theme.trim() || generating || analyzedCount === 0}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-colors
            bg-cyan-700 hover:bg-cyan-600 text-white
            disabled:bg-zinc-800 disabled:text-zinc-600 disabled:cursor-not-allowed"
        >
          {generating ? '生成中…' : '生成'}
        </button>
      </div>

      {error && (
        <div className="mb-4 text-xs text-red-400 bg-red-950/30 border border-red-800/40 rounded-lg p-3">
          {error}
        </div>
      )}

      {/* Result */}
      {displayBoard && displaySelection && (
        <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 space-y-5">
          {/* Theme + meta */}
          <div>
            <p className="text-xs text-zinc-500 mb-0.5">主题</p>
            <p className="text-sm font-medium text-zinc-100">{displayBoard.theme}</p>
            <div className="flex gap-3 mt-1">
              <span className="text-[11px] text-zinc-500">市场：{displayBoard.storyboard_json.market_context}</span>
              <span className="text-[11px] text-zinc-500">语气：{displayBoard.storyboard_json.brand_voice}</span>
            </div>
          </div>

          {/* Selected frames */}
          <div>
            <p className="text-xs text-zinc-500 mb-2">自动选图</p>
            <div className="flex gap-2">
              {/* Hook */}
              <div className="flex-1">
                <p className="text-[10px] text-purple-400 mb-1">Hook</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={displaySelection.hook.url} alt="hook" className="w-full aspect-square object-cover rounded-lg" />
              </div>
              {/* Middle */}
              {displaySelection.middle.map((m, i) => (
                <div key={m.id} className="flex-1">
                  <p className="text-[10px] text-blue-400 mb-1">Middle {i + 1}</p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.url} alt={`middle ${i + 1}`} className="w-full aspect-square object-cover rounded-lg" />
                </div>
              ))}
              {/* CTA */}
              <div className="flex-1">
                <p className="text-[10px] text-cyan-400 mb-1">CTA</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={displaySelection.cta.url} alt="cta" className="w-full aspect-square object-cover rounded-lg" />
              </div>
            </div>
          </div>

          {/* Scene descriptions */}
          <div>
            <p className="text-xs text-zinc-500 mb-2">场景分解</p>
            <div className="space-y-1.5">
              {displayBoard.storyboard_json.scenes.map(scene => {
                const roleColors: Record<string, string> = {
                  hook:   'text-purple-400 bg-purple-950/40',
                  middle: 'text-blue-400 bg-blue-950/40',
                  cta:    'text-cyan-400 bg-cyan-950/40',
                }
                return (
                  <div key={scene.scene} className="flex items-start gap-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${roleColors[scene.role] ?? 'text-zinc-400 bg-zinc-800'}`}>
                      {scene.role.toUpperCase()}
                    </span>
                    <p className="text-xs text-zinc-300">{scene.description}</p>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Prompts */}
          <div>
            <div className="flex items-center gap-1 mb-2">
              {(['seedance', 'kling', 'runway'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setActivePrompt(p)}
                  className={`text-[11px] px-2.5 py-1 rounded-lg transition-colors capitalize
                    ${activePrompt === p
                      ? 'bg-zinc-700 text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-300'}`}
                >
                  {p === 'seedance' ? 'Seedance' : p === 'kling' ? 'Kling' : 'Runway'}
                </button>
              ))}
              <div className="ml-auto">
                <CopyButton text={promptText} />
              </div>
            </div>
            <div className="bg-zinc-950 rounded-lg p-3 border border-zinc-800">
              <p className="text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap">{promptText}</p>
            </div>
          </div>

          {/* Send to Kanban */}
          <div className="border-t border-zinc-700 pt-4">
            {sentDraftId ? (
              <div className="flex items-center justify-between bg-emerald-950/40 border border-emerald-700/40 rounded-lg px-4 py-3">
                <div>
                  <p className="text-xs font-medium text-emerald-300">✓ 已发送到内容看板</p>
                  <p className="text-[11px] text-emerald-600 mt-0.5">可在 Launch Hub → Reels Studio 查看并生成视频</p>
                </div>
                <Link
                  href={`/dashboard/clients/${clientId}/production`}
                  className="text-[11px] px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-medium transition-colors shrink-0"
                >
                  前往看板 →
                </Link>
              </div>
            ) : (
              <button
                onClick={sendToKanban}
                disabled={sending}
                className="w-full py-2.5 rounded-lg text-sm font-medium transition-colors
                  bg-violet-700 hover:bg-violet-600 text-white
                  disabled:bg-zinc-800 disabled:text-zinc-600 disabled:cursor-not-allowed"
              >
                {sending ? '发送中…' : '📋 发送到内容看板'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* History */}
      {history.length > 0 && !displayBoard && (
        <div>
          <p className="text-xs text-zinc-500 mb-3">历史 Storyboard（点击主题重新查看）</p>
          <div className="space-y-2">
            {history.slice(0, 5).map(h => (
              <button
                key={h.id}
                onClick={() => {
                  const fakeResult: GenerateResult = {
                    storyboard: h,
                    selection: {
                      hook:   { id: h.hook_asset_id, url: assetMap.get(h.hook_asset_id)?.storage_url ?? '' },
                      middle: h.middle_asset_ids.map(id => ({ id, url: assetMap.get(id)?.storage_url ?? '' })),
                      cta:    { id: h.cta_asset_id,  url: assetMap.get(h.cta_asset_id)?.storage_url ?? '' },
                    },
                  }
                  setResult(fakeResult)
                  setTheme(h.theme)
                }}
                className="w-full text-left bg-zinc-900 border border-zinc-800 hover:border-zinc-600 rounded-lg px-3 py-2 transition-colors"
              >
                <p className="text-xs text-zinc-300">{h.theme}</p>
                <p className="text-[10px] text-zinc-600">{new Date(h.created_at).toLocaleDateString('en-AU')}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Placeholder when no result and has analyzed images */}
      {!displayBoard && history.length === 0 && analyzedCount > 0 && (
        <div className="text-center py-8 text-zinc-600 text-xs">
          输入上方主题，点击「生成」开始制作 Storyboard
        </div>
      )}

      {void activeResult}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AssetsPage() {
  const params = useParams()
  const clientId = typeof params.id === 'string' ? params.id : Array.isArray(params.id) ? params.id[0] : ''

  const [assets, setAssets] = useState<ClientAsset[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'pending' | 'analyzed' | 'hook' | 'middle' | 'cta'>('all')

  // Build a lookup map for asset URL resolution in StoryboardPanel history
  const assetMap = new Map(assets.map(a => [a.id, a]))

  const loadAssets = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/clients/${clientId}/assets`)
    if (res.ok) {
      const json = await res.json()
      setAssets(json.assets ?? [])
    }
    setLoading(false)
  }, [clientId])

  useEffect(() => { loadAssets() }, [loadAssets])

  const filtered = assets.filter(a => {
    if (filter === 'all') return true
    if (filter === 'pending') return a.status === 'pending' || a.status === 'analyzing'
    if (filter === 'analyzed') return a.status === 'analyzed'
    return a.recommended_use === filter
  })

  const counts = {
    total: assets.length,
    analyzed: assets.filter(a => a.status === 'analyzed').length,
    pending: assets.filter(a => a.status === 'pending' || a.status === 'analyzing').length,
    hook: assets.filter(a => a.recommended_use === 'hook').length,
    middle: assets.filter(a => a.recommended_use === 'middle').length,
    cta: assets.filter(a => a.recommended_use === 'cta').length,
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-7xl mx-auto px-4 py-6">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link
            href={`/dashboard/clients/${clientId}`}
            className="text-zinc-500 hover:text-zinc-300 text-sm transition-colors"
          >
            ← 返回客户
          </Link>
          <span className="text-zinc-700">/</span>
          <h1 className="text-lg font-semibold text-zinc-100">素材库</h1>
          <span className="text-xs bg-zinc-800 text-zinc-400 px-2 py-0.5 rounded ml-1">Visual Asset Intelligence</span>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-6">
          {[
            { key: 'all',      label: '全部',    value: counts.total,    color: 'text-zinc-300' },
            { key: 'analyzed', label: '已分析',  value: counts.analyzed, color: 'text-emerald-400' },
            { key: 'pending',  label: '队列中',  value: counts.pending,  color: 'text-amber-400' },
            { key: 'hook',     label: 'Hook',    value: counts.hook,     color: 'text-purple-400' },
            { key: 'middle',   label: 'Middle',  value: counts.middle,   color: 'text-blue-400' },
            { key: 'cta',      label: 'CTA',     value: counts.cta,      color: 'text-cyan-400' },
          ].map(({ key, label, value, color }) => (
            <button
              key={key}
              onClick={() => setFilter(key as typeof filter)}
              className={`bg-zinc-900 border rounded-lg p-3 text-left transition-colors
                ${filter === key ? 'border-cyan-600' : 'border-zinc-800 hover:border-zinc-600'}`}
            >
              <p className={`text-xl font-bold ${color}`}>{value}</p>
              <p className="text-[11px] text-zinc-500">{label}</p>
            </button>
          ))}
        </div>

        {/* Upload zone */}
        <UploadZone clientId={clientId} onUploaded={loadAssets} />

        {/* Asset grid */}
        {loading ? (
          <div className="text-center py-12 text-zinc-500 text-sm">加载中…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-zinc-500 text-sm">
              {assets.length === 0
                ? '还没有上传任何图片。将客户照片拖入上方区域开始分析。'
                : '没有符合当前筛选的图片。'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {filtered.map(asset => (
              <AssetCard key={asset.id} asset={asset} />
            ))}
          </div>
        )}

        {/* Storyboard generator */}
        <StoryboardPanel
          clientId={clientId}
          analyzedCount={counts.analyzed}
          assetMap={assetMap}
        />
      </div>
    </div>
  )
}
