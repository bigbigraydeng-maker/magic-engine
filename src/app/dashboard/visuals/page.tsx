'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useGenerationQueue } from '@/hooks/useGenerationQueue'
import { GenerationQueueItem, GENERATION_CONFIG } from '@/lib/visual/generation-config'
import { GenerationProgress } from '@/components/visual/GenerationProgress'
import { QueueOverviewCard } from '@/components/visual/QueueOverviewCard'

interface Post {
  id: string
  title: string
  status: string
  platforms: string[]
  caption: string | null
  hashtags: string[] | null
  visual_brief: string | null
  scheduled_at: string | null
  format: string | null
  ratio: string | null
  created_at: string
  source: string | null
}

interface VisualAsset {
  id: string
  post_id: string
  asset_type: string
  generation_status: string
  storage_url: string | null
  provider_job_id: string | null
  created_at: string
  cost_usd?: number
  error_message?: string
  current_version_num?: number
  is_final?: boolean
  external_edit_status?: 'needs_external_edit' | 'in_external_edit' | 'final' | null
}

interface AssetVersion {
  id: string
  version_num: number
  storage_url: string
  uploaded_by: string
  edit_type: 'ai_generated' | 'external_edit' | 'manual_replacement'
  edit_notes: string | null
  created_at: string
}

interface GenState {
  generating: boolean
  queued: boolean
  queuePosition?: number
  elapsed: number
  assetId?: string
  genStatus?: string
  errorMessage?: string
  errorCode?: string
  retryCount?: number
  costUsd?: number
}

interface Client {
  id: string
  name: string
}

// Dimension hints shown above the visual prompt
const RATIO_FOR_FORMAT_PLATFORM: Record<string, string> = {
  reel_instagram: '9:16 (1080×1920)',
  reel_tiktok:    '9:16 (1080×1920)',
  reel_facebook:  '9:16 (1080×1920)',
  story_instagram:'9:16 (1080×1920)',
  story_facebook: '9:16 (1080×1920)',
  video_youtube:  '16:9 (1920×1080)',
  video_facebook: '16:9 (1920×1080)',
  feed_instagram: '4:5 (1080×1350)',
  image_instagram:'4:5 (1080×1350)',
  image_facebook: '4:5 (1080×1350)',
  carousel_instagram:'1:1 (1080×1080)',
  image_twitter:  '16:9 (1200×675)',
}

function getDimensionHint(format: string | null, platforms: string[] | null): string {
  if (!format) return ''
  const pl = (platforms ?? [])[0]?.toLowerCase() ?? ''
  const key = `${format.toLowerCase()}_${pl}`
  return RATIO_FOR_FORMAT_PLATFORM[key] ?? RATIO_FOR_FORMAT_PLATFORM[`${format.toLowerCase()}_`] ?? ''
}

interface PublerAccount {
  id: string
  provider: string
  name: string
}

interface PubModal {
  assetId: string
  postId: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const VIDEO_FORMATS = ['reel', 'video']

const PLATFORM_EMOJI: Record<string, string> = {
  instagram: '📷', facebook: '📘', tiktok: '🎵', linkedin: '💼', twitter: '🐦',
}

const FORMAT_STYLE: Record<string, string> = {
  reel:     'bg-me-ochre/10 text-me-ochre',
  video:    'bg-me-ochre/10 text-me-ochre',
  feed:     'bg-me-ochre/10 text-me-ochre',
  image:    'bg-me-ochre/10 text-me-ochre',
  story:    'bg-[#C2453A]/10 text-[#C2453A]',
  carousel: 'bg-me-ochre/10 text-me-ochre',
}

const STATUS_STYLE: Record<string, string> = {
  draft:     'bg-me-ivory text-me-charcoal/55',
  approved:  'bg-[#5C8A4A]/12 text-[#5C8A4A]',
  scheduled: 'bg-me-ochre/10 text-me-ochre',
  published: 'bg-[#5C8A4A]/12 text-[#5C8A4A]',
  rejected:  'bg-[#C2453A]/10 text-[#C2453A]',
}

const STATUSES = ['draft', 'approved', 'scheduled', 'published', 'rejected']
const STAGES   = ['Initialising…', 'Generating concept…', 'Rendering pixels…', 'Finalising…']

// ── Helpers ───────────────────────────────────────────────────────────────────

function assetTypeFromFormat(format?: string | null): 'image' | 'video' {
  return VIDEO_FORMATS.includes((format ?? '').toLowerCase()) ? 'video' : 'image'
}

function fmtDateNZ(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-NZ', {
    timeZone: 'Pacific/Auckland',
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function toDatetimeLocal(iso: string): string {
  return new Date(iso)
    .toLocaleString('sv-SE', { timeZone: 'Pacific/Auckland' })
    .replace(' ', 'T')
    .slice(0, 16)
}

function fromDatetimeLocal(s: string): string {
  return new Date(s).toISOString()
}

// ── Editable cells ─────────────────────────────────────────────────────────────

function EditableText({
  value, onSave, placeholder = '—',
}: { value: string | null; onSave: (v: string) => void; placeholder?: string }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')

  const commit = () => {
    setEditing(false)
    if (draft !== (value ?? '')) onSave(draft)
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => e.key === 'Enter' && commit()}
        className="w-full text-sm px-1 py-0.5 border border-me-ochre/50 rounded focus:ring-1 focus:ring-me-ochre outline-none bg-white text-me-charcoal/90 placeholder:text-me-charcoal/55"
      />
    )
  }
  return (
    <div
      onClick={() => { setDraft(value ?? ''); setEditing(true) }}
      title={value ?? ''}
      className="cursor-text min-h-[22px] text-sm text-me-charcoal/90 px-1 py-0.5 rounded hover:bg-me-ochre/10 truncate"
    >
      {value || <span className="text-me-charcoal/35 italic text-xs">{placeholder}</span>}
    </div>
  )
}

function EditableTextarea({
  value, onSave, placeholder = '—',
}: { value: string | null; onSave: (v: string) => void; placeholder?: string }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')

  const commit = () => {
    setEditing(false)
    if (draft !== (value ?? '')) onSave(draft)
  }

  if (editing) {
    return (
      <textarea
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        className="w-full text-xs px-1 py-0.5 border border-me-ochre/50 rounded focus:ring-1 focus:ring-me-ochre outline-none resize-y min-h-[64px] bg-white text-me-charcoal/90 placeholder:text-me-charcoal/55"
      />
    )
  }
  return (
    <div
      onClick={() => { setDraft(value ?? ''); setEditing(true) }}
      title={value ?? ''}
      className="cursor-text min-h-[22px] text-xs text-me-charcoal/90 px-1 py-0.5 rounded hover:bg-me-ochre/10 line-clamp-2 overflow-hidden"
    >
      {value || <span className="text-me-charcoal/35 italic">{placeholder}</span>}
    </div>
  )
}

function EditableDatetime({
  value, onSave,
}: { value: string | null; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ? toDatetimeLocal(value) : '')

  const commit = (v: string) => {
    setEditing(false)
    if (v) onSave(fromDatetimeLocal(v))
  }

  if (editing) {
    return (
      <input
        autoFocus
        type="datetime-local"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => commit(draft)}
        className="text-xs px-1 py-0.5 border border-me-ochre/50 rounded outline-none w-36 bg-white text-me-charcoal/90"
      />
    )
  }
  return (
    <div
      onClick={() => { setDraft(value ? toDatetimeLocal(value) : ''); setEditing(true) }}
      className="cursor-text min-h-[22px] text-xs text-me-charcoal/90 px-1 py-0.5 rounded hover:bg-me-ochre/10 whitespace-nowrap"
    >
      {fmtDateNZ(value)}
    </div>
  )
}

function EditableHashtags({
  value, onSave,
}: { value: string[] | null; onSave: (v: string[]) => void }) {
  const str = value?.join(' ') ?? ''
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(str)

  const commit = () => {
    setEditing(false)
    onSave(draft.split(/\s+/).map(s => s.trim()).filter(Boolean))
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => e.key === 'Enter' && commit()}
        placeholder="#tag1 #tag2"
        className="w-full text-xs px-1 py-0.5 border border-me-ochre/50 rounded focus:ring-1 focus:ring-me-ochre outline-none bg-white text-me-charcoal/90 placeholder:text-me-charcoal/55"
      />
    )
  }

  const tags = value ?? []
  const displayTags = tags.slice(0, 2)
  const hiddenCount = Math.max(0, tags.length - 2)

  return (
    <div
      onClick={() => { setDraft(str); setEditing(true) }}
      title={str}
      className="cursor-text min-h-[22px] text-xs px-1 py-0.5 rounded hover:bg-me-ochre/10 text-me-ochre flex items-center gap-1 flex-wrap"
    >
      {tags.length > 0 ? (
        <>
          {displayTags.map((tag, idx) => (
            <span key={idx} className="whitespace-nowrap overflow-hidden text-ellipsis max-w-[80px]">
              {tag}
            </span>
          ))}
          {hiddenCount > 0 && (
            <span className="text-me-charcoal/45 text-[10px]">+{hiddenCount}</span>
          )}
        </>
      ) : (
        <span className="text-me-charcoal/35 italic">—</span>
      )}
    </div>
  )
}

function EditableStatus({
  value, onSave,
}: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <select
        autoFocus
        value={value}
        onChange={e => { onSave(e.target.value); setEditing(false) }}
        onBlur={() => setEditing(false)}
        className="text-xs border border-me-ochre/50 rounded px-1 outline-none bg-white w-full text-me-charcoal/90"
      >
        {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
    )
  }
  return (
    <span
      onClick={() => setEditing(true)}
      className={`cursor-pointer text-xs px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap ${STATUS_STYLE[value] ?? 'bg-me-ivory text-me-charcoal/55'}`}
    >
      {value}
    </span>
  )
}

function EditableFormat({
  value, onSave,
}: { value: string | null; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false)
  const formats = Object.keys(FORMAT_STYLE)

  if (editing) {
    return (
      <select
        autoFocus
        value={value ?? ''}
        onChange={e => { onSave(e.target.value); setEditing(false) }}
        onBlur={() => setEditing(false)}
        className="text-xs border border-me-ochre/50 rounded px-1 outline-none bg-white w-full text-me-charcoal/90"
      >
        <option value="">—</option>
        {formats.map(f => <option key={f} value={f}>{f}</option>)}
      </select>
    )
  }
  return (
    <span
      onClick={() => setEditing(true)}
      className={`cursor-pointer text-xs px-1.5 py-0.5 rounded font-medium capitalize ${value ? FORMAT_STYLE[value.toLowerCase()] ?? 'bg-me-ivory text-me-charcoal/60' : 'text-me-charcoal/35'}`}
    >
      {value || '—'}
    </span>
  )
}

function EditablePlatforms({
  value, onSave,
}: { value: string[] | null; onSave: (v: string[]) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState((value ?? []).join(' '))
  const platforms = Object.keys(PLATFORM_EMOJI)

  const commit = () => {
    setEditing(false)
    const arr = draft.split(/\s+/).map(s => s.trim()).filter(Boolean).filter(p => platforms.includes(p))
    onSave(arr)
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => e.key === 'Enter' && commit()}
        placeholder="instagram facebook tiktok…"
        className="w-full text-xs px-1 py-0.5 border border-me-ochre/50 rounded focus:ring-1 focus:ring-me-ochre outline-none bg-white text-me-charcoal/90 placeholder:text-me-charcoal/55"
      />
    )
  }
  return (
    <div
      onClick={() => { setDraft((value ?? []).join(' ')); setEditing(true) }}
      className="cursor-text flex gap-0.5 flex-wrap min-h-[22px] px-1 py-0.5 rounded hover:bg-me-ochre/10"
    >
      {(value ?? []).length > 0 ? (
        (value ?? []).map(p => (
          <span key={p} title={p} className="text-base leading-none">
            {PLATFORM_EMOJI[p.toLowerCase()] ?? p.slice(0, 2).toUpperCase()}
          </span>
        ))
      ) : (
        <span className="text-me-charcoal/35 italic text-xs">—</span>
      )}
    </div>
  )
}

// ── Asset cell ─────────────────────────────────────────────────────────────────

function AssetCell({
  post, genState, readyAsset, clientId, onGenerate, onCancel, onSchedule, onShowError, onUploaded, onAssetUpdated,
}: {
  post: Post
  genState?: GenState
  readyAsset?: VisualAsset
  clientId: string
  onGenerate: () => void
  onCancel: () => void
  onSchedule: (assetId: string) => void
  onShowError?: (error: {postId: string, message: string, code?: string, retryCount: number}) => void
  onUploaded: (asset: VisualAsset) => void
  onAssetUpdated: (asset: VisualAsset) => void
}) {
  // Hooks MUST be at the top — before any early returns
  const [uploading, setUploading] = useState(false)
  const [uploadingVersion, setUploadingVersion] = useState(false)
  const [markingEdit, setMarkingEdit] = useState(false)
  const [showVersionModal, setShowVersionModal] = useState(false)
  const [versions, setVersions] = useState<AssetVersion[]>([])
  const [loadingVersions, setLoadingVersions] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const versionFileRef = useRef<HTMLInputElement>(null)

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('post_id', post.id)
      fd.append('client_id', clientId)
      const res = await fetch('/api/visual/upload', { method: 'POST', body: fd })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      onUploaded({
        id: json.asset_id,
        post_id: post.id,
        asset_type: json.asset_type,
        generation_status: 'ready',
        storage_url: json.storage_url,
        provider_job_id: null,
        created_at: new Date().toISOString(),
        is_final: true,
        current_version_num: 1,
      })
    } catch (err) {
      alert(`Upload failed: ${(err as Error).message}`)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const handleUploadNewVersion = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !readyAsset) return
    setUploadingVersion(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`/api/visual-assets/${readyAsset.id}/upload-version`, {
        method: 'POST',
        body: fd,
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      onAssetUpdated({ ...readyAsset, ...json.asset })
    } catch (err) {
      alert(`Upload failed: ${(err as Error).message}`)
    } finally {
      setUploadingVersion(false)
      if (versionFileRef.current) versionFileRef.current.value = ''
    }
  }

  const handleMarkForExternalEdit = async () => {
    if (!readyAsset) return
    const nextStatus = readyAsset.external_edit_status === 'needs_external_edit'
      ? null   // toggle off
      : 'needs_external_edit'
    setMarkingEdit(true)
    try {
      const res = await fetch(`/api/visual-assets/${readyAsset.id}/edit-status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      onAssetUpdated({ ...readyAsset, external_edit_status: json.asset.external_edit_status, is_final: json.asset.is_final })
    } catch (err) {
      alert(`Failed: ${(err as Error).message}`)
    } finally {
      setMarkingEdit(false)
    }
  }

  const openVersionHistory = async () => {
    if (!readyAsset) return
    setShowVersionModal(true)
    setLoadingVersions(true)
    try {
      const res = await fetch(`/api/visual-assets/${readyAsset.id}/versions`)
      const json = await res.json()
      setVersions(json.versions ?? [])
    } catch {
      setVersions([])
    } finally {
      setLoadingVersions(false)
    }
  }

  // Queued state (waiting to start generation)
  if (genState?.queued && !genState.generating) {
    const pos = genState.queuePosition
    const r = 38
    const circ = 2 * Math.PI * r
    return (
      <div className="flex flex-col items-center gap-1 py-1 animate-slide-in-x">
        <div className="relative w-12 h-12">
          <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
            <circle cx="50" cy="50" r={r} fill="none" stroke="#EBCB8B" strokeWidth="8" />
            <circle
              cx="50" cy="50" r={r} fill="none" stroke="#C4912E" strokeWidth="8"
              strokeDasharray={circ} strokeDashoffset={circ * 0.72}
              strokeLinecap="round"
              className="animate-pulse-subtle"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            {pos !== undefined
              ? <span className="text-xs font-bold text-me-ochre">#{pos}</span>
              : <span className="text-[8px] text-me-ochre">…</span>
            }
          </div>
        </div>
        <span className="text-[9px] text-me-ochre font-medium">等待中</span>
      </div>
    )
  }

  // Generating state
  if (genState?.generating) {
    const assetType = assetTypeFromFormat(post.format)
    const elapsedMs = (genState.elapsed ?? 0) * 1000

    // Estimate expected time based on asset type
    const expectedMs = assetType === 'video' ? 750000 : 300000 // 12.5 min for video, 5 min for image

    // Calculate current stage (0-3 out of 4)
    const progressPercent = Math.min(100, (elapsedMs / expectedMs) * 100)
    const currentStageIndex = Math.floor((progressPercent / 100) * 4)

    return (
      <div className="flex items-center justify-center py-2 animate-slide-in-x">
        <GenerationProgress
          currentStageIndex={currentStageIndex}
          totalStages={4}
          elapsedMs={elapsedMs}
          expectedMs={expectedMs}
          onCancel={onCancel}
        />
      </div>
    )
  }

  // Timeout state
  if (genState?.genStatus === 'timeout') {
    return (
      <div className="flex flex-col items-center gap-1">
        <div className="text-center">
          <div className="text-lg">⏱</div>
          <span className="text-[9px] text-me-ochre font-medium">Timeout</span>
        </div>
        <button
          onClick={onGenerate}
          title="Retry generation"
          className="text-[9px] px-1.5 py-0.5 bg-me-ochre text-white rounded hover:bg-me-ochre"
        >
          ↻ Retry
        </button>
      </div>
    )
  }

  // Failed state
  if (genState?.genStatus === 'failed') {
    return (
      <div className="flex flex-col items-center gap-1">
        <div className="text-center">
          <div className="text-lg">✕</div>
          <span className="text-[9px] text-[#C2453A] font-medium">Failed</span>
        </div>
        <div className="flex gap-1 flex-col items-center text-[9px]">
          <button
            onClick={() => onShowError?.({
              postId: post.id,
              message: genState.errorMessage || 'Generation failed',
              code: genState.errorCode,
              retryCount: genState.retryCount ?? 0,
            })}
            className="px-1.5 py-0.5 bg-[#C2453A]/10 text-[#C2453A] rounded hover:bg-[#C2453A]/10"
          >
            Details
          </button>
          <button
            onClick={onGenerate}
            className="px-1.5 py-0.5 bg-[#C2453A] text-white rounded hover:bg-[#C2453A]"
          >
            ↻ Retry
          </button>
          {genState.retryCount !== undefined && genState.retryCount > 0 && (
            <span className="text-[8px] text-me-charcoal/55">
              Attempt {genState.retryCount + 1}/{GENERATION_CONFIG.MAX_AUTO_RETRIES + 1}
            </span>
          )}
        </div>
      </div>
    )
  }

  // Ready state - show image with version management buttons
  if (readyAsset?.storage_url) {
    const isExternalEdit = readyAsset.external_edit_status === 'needs_external_edit'
      || readyAsset.external_edit_status === 'in_external_edit'
    const versionNum = readyAsset.current_version_num ?? 1

    return (
      <>
        <div className="flex flex-col items-center gap-1">
          {/* Thumbnail + version badge */}
          <div className="relative">
            <img
              src={readyAsset.storage_url}
              alt=""
              className={`w-14 h-14 object-cover rounded cursor-pointer ring-1 transition-all animate-scale-pop ${isExternalEdit ? 'ring-me-ochre opacity-70' : 'ring-black/10 hover:ring-me-ochre'}`}
              onClick={() => window.open(readyAsset.storage_url!, '_blank')}
            />
            {/* Version badge */}
            <button
              onClick={openVersionHistory}
              title="View version history"
              className="absolute -top-1.5 -right-1.5 bg-me-charcoal/60 text-white text-[8px] px-1 py-0 rounded-full leading-4 hover:bg-me-charcoal/90"
            >
              v{versionNum}
            </button>
            {/* External edit indicator */}
            {isExternalEdit && (
              <div className="absolute -bottom-1 left-0 right-0 text-center">
                <span className="text-[8px] bg-me-ochre/10 text-me-ochre px-1 rounded">外编中</span>
              </div>
            )}
          </div>

          {/* Primary actions */}
          <div className="flex gap-1 text-[10px]">
            <button
              onClick={() => onSchedule(readyAsset.id)}
              className="px-1.5 py-0.5 bg-[#5C8A4A] text-white rounded hover:bg-[#5C8A4A] whitespace-nowrap"
            >
              → Publer
            </button>
            <button
              onClick={onGenerate}
              title="Regenerate"
              className="px-1.5 py-0.5 bg-me-charcoal/25 text-white rounded hover:bg-me-charcoal/35 whitespace-nowrap"
            >
              ↻
            </button>
          </div>

          {/* Download button */}
          <a
            href={readyAsset.storage_url}
            download
            target="_blank"
            rel="noopener noreferrer"
            className="text-[9px] px-1.5 py-0.5 bg-me-ochre/10 text-me-ochre rounded hover:bg-me-ochre/10 whitespace-nowrap w-full text-center"
          >
            ⬇ Download
          </a>

          {/* Mark for external edit toggle */}
          <button
            onClick={handleMarkForExternalEdit}
            disabled={markingEdit}
            title={isExternalEdit ? 'Clear external edit flag' : 'Mark for external editing'}
            className={`text-[9px] px-1.5 py-0.5 rounded whitespace-nowrap w-full text-center disabled:opacity-50 ${
              isExternalEdit
                ? 'bg-me-ochre/10 text-me-ochre hover:bg-me-ochre/10'
                : 'bg-me-ivory text-me-charcoal/60 hover:bg-me-stone'
            }`}
          >
            {markingEdit ? '…' : isExternalEdit ? '✏ 外编中' : '✏ 标记外编'}
          </button>

          {/* Upload final version (prominent when in external edit) */}
          <button
            onClick={() => versionFileRef.current?.click()}
            disabled={uploadingVersion}
            title="Upload final edited version"
            className={`text-[9px] px-1.5 py-0.5 rounded whitespace-nowrap w-full text-center disabled:opacity-50 ${
              isExternalEdit
                ? 'bg-[#5C8A4A] text-white hover:bg-[#5C8A4A]'
                : 'bg-me-ivory text-me-charcoal/60 hover:bg-me-stone'
            }`}
          >
            {uploadingVersion ? '上传中…' : '⬆ 上传最终版'}
          </button>

          {readyAsset.cost_usd && (
            <span className="text-[8px] text-me-charcoal/45">${readyAsset.cost_usd.toFixed(2)}</span>
          )}

          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm"
            className="hidden"
            onChange={handleUpload}
          />
          <input
            ref={versionFileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm"
            className="hidden"
            onChange={handleUploadNewVersion}
          />
        </div>

        {/* Version History Modal */}
        {showVersionModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowVersionModal(false)}>
            <div className="bg-white rounded-xl p-5 w-full max-w-sm shadow-xl" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-me-charcoal/75">版本历史</h3>
                <button onClick={() => setShowVersionModal(false)} className="text-me-charcoal/45 hover:text-me-charcoal/60 text-lg leading-none">×</button>
              </div>
              {loadingVersions ? (
                <div className="flex justify-center py-6">
                  <div className="w-5 h-5 border-2 border-me-ochre/50 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : versions.length === 0 ? (
                <p className="text-xs text-me-charcoal/45 text-center py-4">暂无版本记录</p>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {versions.map(v => (
                    <div key={v.id} className="flex items-start gap-3 p-2 rounded-lg border border-black/[.06] hover:bg-me-ivory">
                      <a href={v.storage_url} target="_blank" rel="noopener noreferrer">
                        <img src={v.storage_url} alt={`v${v.version_num}`} className="w-12 h-12 object-cover rounded flex-shrink-0 ring-1 ring-black/10" />
                      </a>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium text-me-charcoal/75">v{v.version_num}</span>
                          <span className={`text-[9px] px-1 py-0 rounded-full ${
                            v.edit_type === 'ai_generated' ? 'bg-me-ochre/10 text-me-ochre' :
                            v.edit_type === 'external_edit' ? 'bg-me-ochre/10 text-me-ochre' :
                            'bg-me-ivory text-me-charcoal/60'
                          }`}>
                            {v.edit_type === 'ai_generated' ? 'AI生成' :
                             v.edit_type === 'external_edit' ? '外编' : '手动上传'}
                          </span>
                        </div>
                        {v.edit_notes && (
                          <p className="text-[10px] text-me-charcoal/55 mt-0.5 truncate">{v.edit_notes}</p>
                        )}
                        <p className="text-[9px] text-me-charcoal/45 mt-0.5">
                          {new Date(v.created_at).toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                      <a
                        href={v.storage_url}
                        download
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[9px] text-me-ochre hover:text-me-ochre flex-shrink-0 mt-1"
                      >
                        ⬇
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </>
    )
  }

  // Initial state - show generation + upload buttons
  const type = assetTypeFromFormat(post.format)

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        onClick={onGenerate}
        className="text-xs px-2 py-1 bg-me-ochre text-white rounded hover:bg-me-ochre whitespace-nowrap w-full"
      >
        {type === 'video' ? '▶ Gen Video' : '🖼 Gen Image'}
      </button>
      <button
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="text-xs px-2 py-1 bg-me-ivory text-me-charcoal/75 rounded hover:bg-me-stone whitespace-nowrap w-full disabled:opacity-50"
      >
        {uploading ? '上传中…' : '⬆ Upload'}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm"
        className="hidden"
        onChange={handleUpload}
      />
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function VisualsPage() {
  const [clients, setClients] = useState<Client[]>([])
  const [selectedClientId, setSelectedClientId] = useState(() => {
    if (typeof window === 'undefined') return ''
    return new URLSearchParams(window.location.search).get('client') ?? ''
  })
  const [statusFilter, setStatusFilter] = useState('in_progress,draft,approved,scheduled')
  const [posts, setPosts] = useState<Post[]>([])
  const [assets, setAssets] = useState<VisualAsset[]>([])
  const [genStates, setGenStates] = useState<Record<string, GenState>>({})
  // Track posts whose visual_brief was recently edited — shows 🔄 Regen button
  const [dirtyBriefs, setDirtyBriefs] = useState<Set<string>>(new Set())
  const [refreshing, setRefreshing] = useState(false)
  const [pubModal, setPubModal] = useState<PubModal | null>(null)
  const [publerAccounts, setPublerAccounts] = useState<PublerAccount[]>([])
  const [scheduleForm, setScheduleForm] = useState({ account_id: '', scheduled_at: '', caption: '' })
  const [scheduleLoading, setScheduleLoading] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error', message: string } | null>(null)
  const [errorModal, setErrorModal] = useState<{
    postId: string
    message: string
    code?: string
    retryCount: number
  } | null>(null)

  // Generation queue management
  const {
    queueState,
    submitGeneration,
    cancelGeneration,
  } = useGenerationQueue({
    onStatusChange: useCallback((postId: string, state: GenerationQueueItem) => {
      setGenStates((prev) => ({
        ...prev,
        [postId]: {
          generating: state.status === 'generating',
          queued: state.status === 'queued',
          queuePosition: undefined, // Will be computed in AssetCell from queueState
          elapsed: state.elapsed ?? 0,
          assetId: state.assetId,
          genStatus: state.status === 'ready' || state.status === 'failed' || state.status === 'timeout'
            ? state.status
            : undefined,
          errorMessage: state.errorMessage,
          errorCode: state.errorCode,
          retryCount: state.retryCount,
          costUsd: state.costUsd,
        },
      }))
    }, []),
  })

  // Compute queue position from current queueState (for rendering)
  const getQueuePositionForPost = useCallback((postId: string): number | undefined => {
    const index = queueState.queue.findIndex((item) => item.postId === postId)
    return index >= 0 ? index + 1 : undefined
  }, [queueState.queue])

  // ── Data fetching ──────────────────────────────────────────────────────────

  const fetchClients = useCallback(async () => {
    try {
      const res = await fetch('/api/clients')
      if (!res.ok) throw new Error(`Failed to load clients (${res.status})`)
      const d = await res.json()
      const list: Client[] = d.clients ?? []
      setClients(list)
      if (list.length && !selectedClientId) setSelectedClientId(list[0].id)
    } catch (err) {
      setToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to load clients',
      })
    }
  }, [selectedClientId])

  const fetchPosts = useCallback(async (clientId: string, status?: string) => {
    try {
      const params = new URLSearchParams()
      const s = status ?? statusFilter
      if (s) params.set('status', s)
      const res = await fetch(`/api/clients/${clientId}/posts?${params}`)
      if (!res.ok) throw new Error(`Failed to load posts (${res.status})`)
      const d = await res.json()
      setPosts(d.posts ?? [])
    } catch (err) {
      setToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to load posts',
      })
    }
  }, [statusFilter])

  const fetchAssets = useCallback(async (clientId: string) => {
    try {
      const res = await fetch(`/api/visual/assets?client_id=${clientId}`)
      if (!res.ok) throw new Error(`Failed to load assets (${res.status})`)
      const d = await res.json()
      setAssets(d.assets ?? [])
    } catch (err) {
      console.error('Failed to fetch assets:', err)
      // Silent fail for assets — non-critical data
    }
  }, [])

  useEffect(() => { fetchClients() }, [fetchClients])
  useEffect(() => {
    if (selectedClientId) {
      fetchPosts(selectedClientId)
      fetchAssets(selectedClientId)
    }
  }, [selectedClientId, fetchPosts, fetchAssets, statusFilter])
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 5000)
      return () => clearTimeout(timer)
    }
  }, [toast])

  // Keep ref to latest queueState for cleanup
  const queueStateRef = useRef(queueState)
  useEffect(() => {
    queueStateRef.current = queueState
  }, [queueState])

  // Cleanup Hook timers only on unmount — use cancelGeneration to also free concurrency slots
  useEffect(() => {
    return () => {
      Object.keys(queueStateRef.current.activeGenerations).forEach(postId => cancelGeneration(postId))
      queueStateRef.current.queue.forEach(item => cancelGeneration(item.postId))
    }
  }, [cancelGeneration])

  // Track which posts have already triggered asset refresh
  const refreshedPostIdsRef = useRef<Set<string>>(new Set())

  // Optimistic UI timers — tick "elapsed" while a generation request is in flight
  // so the cell animates instead of sitting frozen (the image route is synchronous)
  const optimisticTimersRef = useRef<Record<string, ReturnType<typeof setInterval>>>({})
  useEffect(() => {
    return () => {
      Object.values(optimisticTimersRef.current).forEach(clearInterval)
    }
  }, [])

  // Refresh assets after generation completes (once per post)
  useEffect(() => {
    const completedPostIds = Object.entries(genStates)
      .filter(([_, state]) => state.genStatus === 'ready')
      .map(([postId]) => postId)

    const newlyCompleted = completedPostIds.filter(id => !refreshedPostIdsRef.current.has(id))

    if (newlyCompleted.length > 0 && selectedClientId) {
      newlyCompleted.forEach(id => refreshedPostIdsRef.current.add(id))
      fetchAssets(selectedClientId)
    }
  }, [genStates, selectedClientId, fetchAssets])

  // ── Patch post ─────────────────────────────────────────────────────────────

  const patchPost = useCallback(async (postId: string, fields: Record<string, unknown>) => {
    // Optimistic update — capture previous state for rollback
    let prevPost: Post | undefined
    setPosts(prev => {
      prevPost = prev.find(p => p.id === postId)
      return prev.map(p => p.id === postId ? { ...p, ...fields } as Post : p)
    })

    // If visual_brief changed, mark this post as needing regeneration
    if ('visual_brief' in fields) {
      setDirtyBriefs(prev => new Set([...Array.from(prev), postId]))
    }

    try {
      const res = await fetch(`/api/posts/${postId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
    } catch {
      // Roll back the optimistic update on failure
      if (prevPost) {
        setPosts(prev => prev.map(p => p.id === postId ? prevPost! : p))
      }
      setDirtyBriefs(prev => { const next = new Set(prev); next.delete(postId); return next })
      setToast({ type: 'error', message: 'Failed to save — changes reverted' })
    }
  }, [])

  // ── Generation ─────────────────────────────────────────────────────────────

  const patchGen = useCallback((postId: string, patch: Partial<GenState>) => {
    setGenStates(prev => ({
      ...prev,
      [postId]: { ...({ generating: false, elapsed: 0 }), ...prev[postId], ...patch },
    }))
  }, [])

  const handleCancel = useCallback((postId: string) => {
    // cancelGeneration stops timers AND frees the concurrency slot atomically
    clearInterval(optimisticTimersRef.current[postId])
    delete optimisticTimersRef.current[postId]
    cancelGeneration(postId)
    // Clear UI state so the generate button re-appears
    setGenStates(prev => {
      const next = { ...prev }
      delete next[postId]
      return next
    })
  }, [cancelGeneration])

  const handleGenerate = useCallback(async (post: Post) => {
    // Ignore re-clicks while a generation for this post is already in flight
    if (optimisticTimersRef.current[post.id]) return

    const assetType = assetTypeFromFormat(post.format)
    const apiPath = assetType === 'video' ? '/api/visual/video' : '/api/visual/image'

    // Clear dirty brief flag — generation in progress, button should hide
    setDirtyBriefs(prev => { const next = new Set(prev); next.delete(post.id); return next })

    // Optimistic feedback: flip the cell to "generating" the instant the button is
    // clicked. The image route runs synchronously (~20-60s), so without this the
    // cell would sit frozen on the idle buttons until the request resolves.
    const startedAt = Date.now()
    patchGen(post.id, { generating: true, queued: false, elapsed: 0, genStatus: undefined })
    optimisticTimersRef.current[post.id] = setInterval(() => {
      patchGen(post.id, { elapsed: Math.floor((Date.now() - startedAt) / 1000) })
    }, 1000)

    try {
      await submitGeneration(post.id, apiPath, {
        post_id: post.id,
        client_id: selectedClientId,
        variant: 1,
        asset_type: assetType,
        aspect_ratio: post.ratio ?? '1:1',
      })
      // Hook's internal effect will auto-process queue
    } catch (e) {
      patchGen(post.id, { queued: false, generating: false, genStatus: 'failed' })
      setToast({
        type: 'error',
        message: `Generation failed: ${e instanceof Error ? e.message : String(e)}`,
      })
    } finally {
      clearInterval(optimisticTimersRef.current[post.id])
      delete optimisticTimersRef.current[post.id]
    }
  }, [selectedClientId, submitGeneration, patchGen])


  // ── Publer ─────────────────────────────────────────────────────────────────

  const openPubModal = useCallback(async (assetId: string, postId: string) => {
    setPubModal({ assetId, postId })
    const res = await fetch(`/api/publer/draft/${assetId}`)
    const d = await res.json()
    setPublerAccounts(d.accounts ?? [])
    const post = posts.find(p => p.id === postId)
    setScheduleForm({
      account_id: '',
      scheduled_at: post?.scheduled_at ? toDatetimeLocal(post.scheduled_at) : '',
      caption: d.caption ?? post?.caption ?? '',
    })
  }, [posts])

  const handleSchedule = useCallback(async () => {
    if (!pubModal || !scheduleForm.account_id) return
    setScheduleLoading(true)
    try {
      const res = await fetch('/api/publer/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset_id: pubModal.assetId,
          account_id: scheduleForm.account_id,
          scheduled_at: fromDatetimeLocal(scheduleForm.scheduled_at),
          caption: scheduleForm.caption,
        }),
      })
      const d = await res.json()
      if (d.success) {
        setToast({ type: 'success', message: 'Scheduled! Job: ' + d.job_id })
        setPubModal(null)
      } else {
        setToast({ type: 'error', message: 'Error: ' + d.error })
      }
    } finally {
      setScheduleLoading(false)
    }
  }, [pubModal, scheduleForm])

  // ── Refresh ────────────────────────────────────────────────────────────────

  const handleRefresh = useCallback(async () => {
    if (!selectedClientId) return
    setRefreshing(true)
    try {
      await Promise.all([
        fetchPosts(selectedClientId),
        fetchAssets(selectedClientId),
      ])
    } finally {
      setRefreshing(false)
    }
  }, [selectedClientId, fetchPosts, fetchAssets])

  // ── Upload handler ─────────────────────────────────────────────────────────

  const handleUploaded = useCallback((asset: VisualAsset) => {
    setAssets(prev => [asset, ...prev.filter(a => a.post_id !== asset.post_id || a.generation_status !== 'ready')])
    setToast({ type: 'success', message: `Uploaded successfully` })
  }, [])

  // Update an existing asset in place (used by version upload + edit-status)
  const handleAssetUpdated = useCallback((updated: VisualAsset) => {
    setAssets(prev => prev.map(a => a.id === updated.id ? { ...a, ...updated } : a))
    setToast({ type: 'success', message: `Asset updated — v${updated.current_version_num ?? 1}` })
  }, [])

  // ── Derived ────────────────────────────────────────────────────────────────

  const readyAssetByPost = assets.reduce<Record<string, VisualAsset>>((acc, a) => {
    if (a.generation_status === 'ready' && a.post_id && !acc[a.post_id]) acc[a.post_id] = a
    return acc
  }, {})

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-screen bg-me-ivory">

      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-white border-b border-black/10 flex-shrink-0">
        <h1 className="text-sm font-semibold text-me-charcoal/75 mr-1">🚀 Launch Hub</h1>
        <select
          value={selectedClientId}
          onChange={e => setSelectedClientId(e.target.value)}
          className="text-sm border border-black/10 rounded px-2 py-1 bg-white text-me-charcoal/90"
        >
          <option value="">Select client…</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="text-sm border border-black/10 rounded px-2 py-1 bg-white text-me-charcoal/90"
        >
          <option value="in_progress,draft,approved,scheduled">进行中 + 待审核 + 已批准 + 已排期</option>
          <option value="draft,approved,scheduled">待审核 + 已批准 + 已排期</option>
          <option value="in_progress">进行中</option>
          <option value="draft">待审核（草稿）</option>
          <option value="approved,scheduled">已批准 + 已排期</option>
          <option value="approved">已批准</option>
          <option value="scheduled">已排期</option>
          <option value="published">已发布</option>
          <option value="">全部</option>
        </select>
        <button
          onClick={handleRefresh}
          disabled={!selectedClientId || refreshing}
          className="text-sm px-3 py-1 bg-me-ochre text-white rounded hover:bg-me-ochre disabled:opacity-50"
        >
          {refreshing ? '刷新中…' : '↻ 刷新'}
        </button>
        <span className="text-xs text-me-charcoal/45 ml-auto hidden md:block">
          {posts.length} posts · Click any cell to edit · Auto-saves
        </span>
      </div>

      {/* Table */}
      {selectedClientId ? (
        <div className="flex-1 overflow-auto">
          <table className="border-collapse bg-white text-sm" style={{ minWidth: 1280, width: '100%' }}>
            <thead className="sticky top-0 z-10 bg-me-ivory">
              <tr className="text-xs text-me-charcoal/55 uppercase tracking-wide">
                <th className="w-9 px-2 py-2 text-left font-medium border-b border-r border-black/10">#</th>
                <th className="w-24 px-2 py-2 text-left font-medium border-b border-r border-black/10">Status</th>
                <th className="w-[90px] px-2 py-2 text-left font-medium border-b border-r border-black/10">Format</th>
                <th className="w-16 px-2 py-2 text-left font-medium border-b border-r border-black/10">Platform</th>
                <th className="w-36 px-2 py-2 text-left font-medium border-b border-r border-black/10">Date (NZT)</th>
                <th className="w-40 max-w-[160px] px-2 py-2 text-left font-medium border-b border-r border-black/10">Headline</th>
                <th className="min-w-[200px] px-2 py-2 text-left font-medium border-b border-r border-black/10">Caption</th>
                <th className="min-w-[220px] px-2 py-2 text-left font-medium border-b border-r border-black/10">Prompt + Dimensions</th>
                <th className="min-w-[140px] px-2 py-2 text-left font-medium border-b border-r border-black/10">Hashtags</th>
                <th className="w-24 px-2 py-2 text-center font-medium border-b border-black/10">Asset</th>
              </tr>
            </thead>
            <tbody>
              {posts.map((post, idx) => {
                const isKanbanDraft = post.status === 'draft' && post.source === 'kanban'
                return (
                <tr key={post.id} id={post.id} className={`border-b border-black/[.06] hover:bg-me-ivory/70 align-top group ${isKanbanDraft ? 'border-l-2 border-l-me-ochre bg-me-ochre/30' : ''}`}>

                  {/* # */}
                  <td className="px-2 py-1.5 text-me-charcoal/45 text-xs border-r border-black/[.06]">{idx + 1}</td>

                  {/* Status */}
                  <td className="px-2 py-1.5 border-r border-black/[.06]">
                    <EditableStatus value={post.status} onSave={v => patchPost(post.id, { status: v })} />
                    {isKanbanDraft && (
                      <span className="mt-1 inline-block text-[9px] font-bold bg-me-ochre/10 text-me-ochre border border-me-ochre/30 rounded px-1 py-0.5">
                        📥 来自看板
                      </span>
                    )}
                  </td>

                  {/* Format */}
                  <td className="px-2 py-1.5 border-r border-black/[.06]">
                    <EditableFormat
                      value={post.format}
                      onSave={v => patchPost(post.id, { format: v })}
                    />
                    {post.ratio && <div className="text-[10px] text-me-charcoal/45 mt-0.5">{post.ratio}</div>}
                  </td>

                  {/* Platform */}
                  <td className="px-2 py-1.5 border-r border-black/[.06] relative">
                    <EditablePlatforms
                      value={post.platforms}
                      onSave={v => patchPost(post.id, { platforms: v })}
                    />
                  </td>

                  {/* Date */}
                  <td className="px-2 py-1.5 border-r border-black/[.06]">
                    <EditableDatetime
                      value={post.scheduled_at}
                      onSave={v => patchPost(post.id, { scheduled_at: v })}
                    />
                  </td>

                  {/* Headline — capped width */}
                  <td className="px-2 py-1.5 border-r border-black/[.06] w-40 max-w-[160px]">
                    <EditableText
                      value={post.title}
                      onSave={v => patchPost(post.id, { title: v })}
                      placeholder="Headline…"
                    />
                  </td>

                  {/* Caption */}
                  <td className="px-2 py-1.5 border-r border-black/[.06]">
                    <EditableTextarea
                      value={post.caption}
                      onSave={v => patchPost(post.id, { caption: v })}
                      placeholder="Caption…"
                    />
                  </td>

                  {/* Prompt + Dimensions */}
                  <td className="px-2 py-1.5 border-r border-black/[.06]">
                    {(() => {
                      const hint = getDimensionHint(post.format, post.platforms)
                      const briefDirty = dirtyBriefs.has(post.id)
                      const isGenerating = genStates[post.id]?.generating || genStates[post.id]?.queued
                      return (
                        <>
                          {(post.format || hint) && (
                            <div className="flex items-center gap-1 mb-1 flex-wrap">
                              {post.format && (
                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium capitalize ${FORMAT_STYLE[post.format.toLowerCase()] ?? 'bg-me-ivory text-me-charcoal/60'}`}>
                                  {post.format}
                                </span>
                              )}
                              {hint && (
                                <span className="text-[10px] text-me-charcoal/45 font-mono">{hint}</span>
                              )}
                            </div>
                          )}
                          <EditableTextarea
                            value={post.visual_brief}
                            onSave={v => patchPost(post.id, { visual_brief: v })}
                            placeholder="Image / video prompt…"
                          />
                          {/* Regen button — appears after brief is edited, hides when generating */}
                          {briefDirty && !isGenerating && (
                            <button
                              onClick={() => handleGenerate(post)}
                              className="mt-1 w-full text-[9px] px-1.5 py-0.5 bg-me-ochre text-white rounded hover:bg-me-ochre flex items-center justify-center gap-1 animate-pulse-once"
                            >
                              🔄 Regen with new prompt
                            </button>
                          )}
                          {briefDirty && isGenerating && (
                            <div className="mt-1 text-[9px] text-me-ochre flex items-center gap-1">
                              <span className="inline-block w-2.5 h-2.5 border border-me-ochre/50 border-t-transparent rounded-full animate-spin" />
                              Generating…
                            </div>
                          )}
                        </>
                      )
                    })()}
                  </td>

                  {/* Hashtags */}
                  <td className="px-2 py-1.5 border-r border-black/[.06]">
                    <EditableHashtags
                      value={post.hashtags}
                      onSave={v => patchPost(post.id, { hashtags: v })}
                    />
                  </td>

                  {/* Asset */}
                  <td className="px-2 py-1.5 text-center">
                    <AssetCell
                      post={post}
                      genState={{
                        ...genStates[post.id],
                        queuePosition: getQueuePositionForPost(post.id),
                      }}
                      readyAsset={readyAssetByPost[post.id]}
                      clientId={selectedClientId}
                      onGenerate={() => handleGenerate(post)}
                      onCancel={() => handleCancel(post.id)}
                      onSchedule={assetId => openPubModal(assetId, post.id)}
                      onShowError={setErrorModal}
                      onUploaded={handleUploaded}
                      onAssetUpdated={handleAssetUpdated}
                    />
                  </td>
                </tr>
              )})}

              {posts.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-center py-20 text-me-charcoal/45 text-sm">
                    No posts found — sync from Content Workspace to get started
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-me-charcoal/45 text-sm">
          Select a client to view their content
        </div>
      )}

      {/* Publer modal */}
      {pubModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
            <h2 className="text-base font-semibold mb-4">Schedule to Publer</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-me-charcoal/55 block mb-1">Account</label>
                <select
                  value={scheduleForm.account_id}
                  onChange={e => setScheduleForm(f => ({ ...f, account_id: e.target.value }))}
                  className="w-full border rounded px-2 py-1.5 text-sm text-me-charcoal/90 bg-white"
                >
                  <option value="">Select account…</option>
                  {publerAccounts.map(a => (
                    <option key={a.id} value={a.id}>{a.name} ({a.provider})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-me-charcoal/55 block mb-1">Schedule Time (NZT)</label>
                <input
                  type="datetime-local"
                  value={scheduleForm.scheduled_at}
                  onChange={e => setScheduleForm(f => ({ ...f, scheduled_at: e.target.value }))}
                  className="w-full border rounded px-2 py-1.5 text-sm text-me-charcoal/90 bg-white"
                />
              </div>
              <div>
                <label className="text-xs text-me-charcoal/55 block mb-1">Caption</label>
                <textarea
                  value={scheduleForm.caption}
                  onChange={e => setScheduleForm(f => ({ ...f, caption: e.target.value }))}
                  rows={4}
                  className="w-full border rounded px-2 py-1.5 text-sm text-me-charcoal/90 bg-white resize-none"
                />
              </div>
            </div>
            <div className="flex gap-2 mt-5 justify-end">
              <button
                onClick={() => setPubModal(null)}
                className="px-3 py-1.5 text-sm border rounded hover:bg-me-ivory"
              >
                Cancel
              </button>
              <button
                onClick={handleSchedule}
                disabled={!scheduleForm.account_id || scheduleLoading}
                className="px-3 py-1.5 text-sm bg-[#5C8A4A] text-white rounded disabled:opacity-50 hover:bg-[#5C8A4A] flex items-center gap-2"
              >
                {scheduleLoading ? (
                  <>
                    <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Scheduling…
                  </>
                ) : (
                  'Schedule'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error detail modal */}
      {errorModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-xl">
            <h3 className="text-base font-semibold text-[#C2453A] mb-2">Generation Failed</h3>
            <p className="text-sm text-me-charcoal/75 mb-4 leading-relaxed">{errorModal.message}</p>
            {errorModal.code && (
              <div className="mb-4 p-2 bg-me-ivory rounded border border-black/10">
                <p className="text-xs text-me-charcoal/55 font-medium mb-1">Error Code:</p>
                <p className="text-xs text-me-charcoal/75 font-mono">{errorModal.code}</p>
              </div>
            )}
            <div className="mb-4 p-2 bg-me-ivory rounded border border-black/10">
              <p className="text-xs text-me-charcoal/55 font-medium">
                {errorModal.retryCount >= GENERATION_CONFIG.MAX_AUTO_RETRIES
                  ? `All ${GENERATION_CONFIG.MAX_AUTO_RETRIES} auto-retries exhausted`
                  : `Attempt: ${errorModal.retryCount + 1} / ${GENERATION_CONFIG.MAX_AUTO_RETRIES + 1}`}
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setErrorModal(null)}
                className="px-3 py-1.5 text-sm border border-black/15 rounded hover:bg-me-ivory font-medium"
              >
                Dismiss
              </button>
              <button
                onClick={() => {
                  const post = posts.find(p => p.id === errorModal.postId)
                  if (post) {
                    handleGenerate(post)
                    setErrorModal(null)
                  }
                }}
                className="px-3 py-1.5 text-sm bg-[#C2453A] text-white rounded hover:bg-[#C2453A] font-medium"
              >
                Retry Now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Queue overview floating card */}
      <QueueOverviewCard
        activeGenerations={queueState.activeGenerations}
        onScrollTo={(postId) => {
          document.getElementById(postId)?.scrollIntoView({ behavior: 'smooth' })
        }}
      />

      {/* Toast notification */}
      {toast && (
        <div className={`fixed bottom-4 right-4 px-4 py-3 rounded-lg shadow-lg flex items-center gap-2 z-40 animate-in fade-in-0 slide-in-from-bottom-4 ${
          toast.type === 'success'
            ? 'bg-[#5C8A4A]/10 text-[#5C8A4A] border border-[#5C8A4A]/30'
            : 'bg-[#C2453A]/10 text-[#C2453A] border border-[#C2453A]/30'
        }`}>
          {toast.type === 'success' ? (
            <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
          ) : (
            <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
          )}
          <span className="text-sm">{toast.message}</span>
          <button
            onClick={() => setToast(null)}
            className="ml-2 text-current hover:opacity-70"
          >
            ×
          </button>
        </div>
      )}
    </div>
  )
}
