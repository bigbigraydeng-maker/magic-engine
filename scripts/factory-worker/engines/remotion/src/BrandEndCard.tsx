import React from 'react'
import { AbsoluteFill, Img, staticFile, useVideoConfig } from 'remotion'
import type { ResolvedEndCard } from './frame.ts'
import { PopIn } from './pop.tsx'
import { readableOn, safeRectFor, type SafeRect } from './safeZone.ts'
import { fontFamily } from './theme.ts'

function ctaFont(safeWidth: number, cta: string): number {
  const count = Math.max(1, Array.from(cta).length)
  const unit = /[\u3400-\u9fff]/.test(cta) ? 1 : 0.62
  return Math.max(30, Math.min(48, Math.floor((safeWidth - 96) / (count * unit))))
}

function stack(safe: SafeRect): React.CSSProperties {
  return {
    position: 'absolute',
    left: safe.left,
    top: safe.top,
    width: safe.width,
    height: safe.height,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    boxSizing: 'border-box',
    padding: '12px 8px',
  }
}

const LogoMark: React.FC<{ card: ResolvedEndCard; brandColor: string; ink: string; safeWidth: number }> = ({
  card,
  brandColor,
  ink,
  safeWidth,
}) => {
  if (card.logoFile) {
    const width = Math.min(460, Math.round(safeWidth * 0.72))
    return <Img src={staticFile(card.logoFile)} style={{ width, height: 150, objectFit: 'contain' }} />
  }
  return (
    <div style={{ width: 132, height: 132, borderRadius: 66, background: brandColor, color: ink, fontFamily, fontWeight: 900, fontSize: 68, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {card.monogram}
    </div>
  )
}

/** Centered logo, one call to action, and an optional contact line. All of it stays inside the safe rect. */
export const BrandEndCard: React.FC<{ card: ResolvedEndCard; brandColor: string; solid?: boolean }> = ({
  card,
  brandColor,
  solid = false,
}) => {
  const { width, height } = useVideoConfig()
  const safe = safeRectFor(width, height)
  const ink = readableOn(brandColor)
  return (
    <AbsoluteFill>
      {solid ? (
        <AbsoluteFill style={{ background: `linear-gradient(165deg, ${brandColor} 0%, #121820 46%, #070b10 100%)` }} />
      ) : (
        <AbsoluteFill style={{ background: 'rgba(5,10,16,0.42)' }} />
      )}
      <div style={stack(safe)}>
        <PopIn delay={0}>
          <LogoMark card={card} brandColor={brandColor} ink={ink} safeWidth={safe.width} />
        </PopIn>
        {card.brandName ? (
          <PopIn delay={5}>
            <div style={{ fontFamily, fontWeight: 800, fontSize: 40, color: '#fff', marginTop: 18, textShadow: '0 4px 16px rgba(0,0,0,0.45)' }}>{card.brandName}</div>
          </PopIn>
        ) : null}
        <PopIn delay={10}>
          <div style={{ marginTop: 22, background: brandColor, color: ink, fontFamily, fontWeight: 800, fontSize: ctaFont(safe.width, card.cta), lineHeight: 1.15, borderRadius: 999, padding: '16px 36px' }}>{card.cta}</div>
        </PopIn>
        {card.contact ? (
          <PopIn delay={16}>
            <div style={{ fontFamily, fontWeight: 600, fontSize: 30, color: 'rgba(255,255,255,0.92)', marginTop: 16 }}>{card.contact}</div>
          </PopIn>
        ) : null}
      </div>
    </AbsoluteFill>
  )
}
