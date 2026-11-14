'use client'

/**
 * AI 海报的「对原图签字」——素材库卡片上的一小块。
 *
 * 海报是改图模型把真实照片排版出来的，模型可能把照片里的东西重画了。
 * 所以要团队成员拿原图对一遍、签字，海报才可能配真实价格（发布时还会按原图当前来源再判）。
 */
import { useState } from 'react'
import { readPosterLineage } from '@/lib/assets/provenance'

interface PosterAssetLike {
  id: string
  vision_metadata: unknown
  verified_by: string | null
  verified_at: string | null
}

interface ParentLike {
  storage_url: string
  original_filename: string
}

export function isPosterAsset(asset: Pick<PosterAssetLike, 'vision_metadata'>): boolean {
  return readPosterLineage(asset.vision_metadata) !== null
}

export function posterSourceAssetId(asset: Pick<PosterAssetLike, 'vision_metadata'>): string | null {
  return readPosterLineage(asset.vision_metadata)?.source_asset_id ?? null
}

/** 缩略图上的徽章：签过字 = 绿，没签 = 琥珀。 */
export function PosterBadge({ asset }: { asset: PosterAssetLike }) {
  if (!isPosterAsset(asset)) return null
  const signed = Boolean(asset.verified_by && asset.verified_at)
  const cls = signed ? 'bg-emerald-900/70 text-emerald-300' : 'bg-amber-900/70 text-amber-300'
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${cls}`}>
      {signed ? 'AI 海报 · 已对原图' : 'AI 海报 · 待对原图'}
    </span>
  )
}

/** 展开后的面板：原图链接 + 签字 / 撤销按钮。 */
export function PosterReviewPanel({
  asset,
  parent,
  clientId,
  onChanged,
}: {
  asset: PosterAssetLike
  parent: ParentLike | null
  clientId: string
  onChanged: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!isPosterAsset(asset)) return null
  const signed = Boolean(asset.verified_by && asset.verified_at)

  async function send(action: 'confirm_poster' | 'revoke_poster') {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/assets/${asset.id}/provenance`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (res.ok) onChanged()
      else setError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? '操作失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="px-2 pb-2 border-t border-zinc-800 pt-2 space-y-1.5" onClick={e => e.stopPropagation()}>
      <p className="text-[10px] text-zinc-500">
        Visual Studio 用原图排的海报。对一遍原图：地标、建筑、人物有没有被改、海报上的字对不对。
      </p>
      {parent ? (
        <a
          href={parent.storage_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-cyan-400 hover:text-cyan-300 underline"
        >
          打开原图：{parent.original_filename}
        </a>
      ) : (
        <p className="text-[10px] text-red-400">原图已不在素材库，这张海报不能打真价。</p>
      )}
      <div className="flex gap-1">
        <button
          disabled={saving || (!signed && !parent)}
          onClick={() => send(signed ? 'revoke_poster' : 'confirm_poster')}
          className="text-[10px] px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-300 hover:border-zinc-500 disabled:opacity-40"
        >
          {signed ? '撤销' : '已对原图，确认'}
        </button>
      </div>
      {signed && (
        <p className="text-[10px] text-zinc-500">
          由 {asset.verified_by} 对过原图{asset.verified_at ? ` · ${asset.verified_at.slice(0, 10)}` : ''}
        </p>
      )}
      {error && <p className="text-[10px] text-red-400">{error}</p>}
    </div>
  )
}
