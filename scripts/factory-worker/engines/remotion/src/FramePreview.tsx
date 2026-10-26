import React from 'react'
import { AbsoluteFill } from 'remotion'
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

function previewEnd(kind: string, raw: Record<string, unknown>): ResolvedEndCard | null {
  const spec = { cta: '了解更多', contact: 'example.com', brandName: '示例客户' }
  if (kind === 'end-fallback') return resolveEndCard({ spec, logoFile: null })
  if (kind === 'end') {
    const logoFile = typeof raw.logoFile === 'string' ? raw.logoFile : 'logo.png'
    return resolveEndCard({ spec, logoFile })
  }
  return null
}

function SubjectWash({ brandColor }: { brandColor: string }) {
  return (
    <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 62%, ${brandColor}66 0%, #1a242c 46%, #0c1218 100%)` }}>
      <div style={{ position: 'absolute', left: '16%', top: '40%', width: '68%', height: '26%', borderRadius: 36, background: 'rgba(255,255,255,0.1)' }} />
    </AbsoluteFill>
  )
}

/** Still-frame preview of the shared hook and end card. Not a factory template. */
export const FramePreview: React.FC<Record<string, unknown>> = (raw) => {
  const kind = typeof raw.kind === 'string' ? raw.kind : 'hook-kinetic'
  const brandColor = brandColorOf(raw)
  const hook = previewHook(kind)
  const endCard = previewEnd(kind, raw)
  return (
    <AbsoluteFill style={{ background: '#0c1218' }}>
      <SubjectWash brandColor={brandColor} />
      {hook ? <OpeningHook hook={hook} brandColor={brandColor} /> : null}
      {endCard ? <BrandEndCard card={endCard} brandColor={brandColor} solid /> : null}
    </AbsoluteFill>
  )
}
