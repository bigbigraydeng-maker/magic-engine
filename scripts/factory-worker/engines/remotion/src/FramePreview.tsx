import React from 'react'
import { AbsoluteFill, Img, staticFile } from 'remotion'
import { BrandEndCard } from './BrandEndCard.tsx'
import { resolveEndCard, resolveHook, type ResolvedEndCard, type ResolvedHook } from './frame.ts'
import { OpeningHook } from './OpeningHook.tsx'

function brandColorOf(raw: Record<string, unknown>): string {
  return typeof raw.brandColor === 'string' ? raw.brandColor : '#0B6E99'
}

function previewHook(kind: string): ResolvedHook | null {
  if (kind === 'hook-stat') return resolveHook({ lines: ['小时内回复'], spec: { style: 'stat', stat: '48' } })
  if (kind === 'hook-question') return resolveHook({ spec: { style: 'question', question: '想从哪一步开始？' } })
  if (kind.startsWith('hook')) return resolveHook({ lines: ['先看这里', '再决定'], spec: { style: 'kinetic' } })
  return null
}

function previewEnd(kind: string): ResolvedEndCard | null {
  if (kind === 'end-fallback') return resolveEndCard({ spec: { cta: '了解更多', contact: 'example.com' }, logoFile: null })
  if (kind === 'end') return resolveEndCard({ spec: { cta: '了解更多', contact: 'example.com', brandName: '示例客户' }, logoFile: null })
  return null
}

function Backdrop({ file }: { file: string | null }) {
  if (!file) return <AbsoluteFill style={{ background: '#14181e' }} />
  return <Img src={staticFile(file)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
}

/** Still-frame preview of the shared hook and end card. Not a factory template. */
export const FramePreview: React.FC<Record<string, unknown>> = (raw) => {
  const kind = typeof raw.kind === 'string' ? raw.kind : 'hook-kinetic'
  const brandColor = brandColorOf(raw)
  const hook = previewHook(kind)
  const endCard = previewEnd(kind)
  const backgroundFile = typeof raw.backgroundFile === 'string' ? raw.backgroundFile : null
  return (
    <AbsoluteFill style={{ background: '#14181e' }}>
      <Backdrop file={backgroundFile} />
      {hook ? <OpeningHook hook={hook} brandColor={brandColor} /> : null}
      {endCard ? <BrandEndCard card={endCard} brandColor={brandColor} /> : null}
    </AbsoluteFill>
  )
}
