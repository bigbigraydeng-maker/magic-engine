'use client'

/** 素材库上传区 —— 从 assets/page.tsx 原样搬出（纯搬家，行为不变）。 */
import { useState, useCallback, useRef } from 'react'
import {
  SOURCE_LABELS,
  FDE_UPLOAD_SOURCES,
  canBackRealPrice,
  type AssetSource,
} from '@/lib/assets/provenance'

export function UploadZone({ clientId, onUploaded }: { clientId: string; onUploaded: () => void }) {
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  // 默认「我们拍的」：FDE 后台上传绝大多数是自己拍的或客户直接给的原件。
  // 选错的代价只是这批料暂时打不了真价，可以在卡片上逐张改回来。
  const [source, setSource] = useState<AssetSource>('fde_shot')
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
      fd.append('source', source)

      const res = await fetch(`/api/clients/${clientId}/assets`, { method: 'POST', body: fd })
      const json = await res.json()
      if (json.errors?.length) setErrors(prev => [...prev, ...json.errors])
      setProgress(p => p ? { done: Math.min(p.total, p.done + batch.length), total: p.total } : null)
    }

    setUploading(false)
    setProgress(null)
    onUploaded()
  }, [clientId, onUploaded, source])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    upload(e.dataTransfer.files)
  }, [upload])

  return (
    <div className="mb-6">
      {/* 来源必须在传之前选好 —— 传完再补是没人会做的事 */}
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="text-[11px] text-zinc-500">这批图哪来的：</span>
        {FDE_UPLOAD_SOURCES.map(s => (
          <button
            key={s}
            type="button"
            onClick={() => setSource(s)}
            className={`text-[11px] px-2 py-1 rounded border transition-colors ${
              s === source
                ? 'border-cyan-600 bg-cyan-950/40 text-cyan-300'
                : 'border-zinc-700 text-zinc-400 hover:border-zinc-500'
            }`}
          >
            {SOURCE_LABELS[s]}
          </button>
        ))}
        {!canBackRealPrice(source) && (
          <span className="text-[11px] text-amber-500/80">这类素材不能用在标了真实价格的内容里</span>
        )}
      </div>
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
