import React from 'react'
import { AbsoluteFill, Img, staticFile, useVideoConfig } from 'remotion'
import { ctaButtonWidth, looksChinese, type ResolvedEndCard } from './frame.ts'
import { PopIn } from './pop.tsx'
import { readableOn, safeRectFor, type SafeRect } from './safeZone.ts'
import { fontFamily } from './theme.ts'

function ctaFont(buttonWidth: number, cta: string): number {
  const count = Math.max(1, Array.from(cta).length)
  const unit = looksChinese(cta) ? 1 : 0.62
  return Math.max(40, Math.min(64, Math.floor((buttonWidth - 64) / (count * unit))))
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
    justifyContent: 'space-evenly',
    textAlign: 'center',
    boxSizing: 'border-box',
    padding: '8px 0',
  }
}

const Monogram: React.FC<{ glyph: string; brandColor: string; ink: string; size: number }> = ({ glyph, brandColor, ink, size }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: Math.round(size * 0.22),
      background: brandColor,
      color: ink,
      fontFamily,
      fontWeight: 900,
      fontSize: Math.round(size * 0.52),
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: '0 16px 40px rgba(0,0,0,0.35)',
    }}
  >
    {glyph}
  </div>
)

const LogoMark: React.FC<{ card: ResolvedEndCard; brandColor: string; ink: string; frameWidth: number; badge: number }> = ({
  card,
  brandColor,
  ink,
  frameWidth,
  badge,
}) => {
  if (card.logoFile) {
    const width = Math.min(Math.round(frameWidth * 0.62), 760)
    return <Img src={staticFile(card.logoFile)} style={{ width, height: badge, objectFit: 'contain' }} />
  }
  return <Monogram glyph={card.monogram} brandColor={brandColor} ink={ink} size={badge} />
}

/** Centered lockup inside the safe zone: badge or logo, name, one wide action. */
export const BrandEndCard: React.FC<{ card: ResolvedEndCard; brandColor: string; solid?: boolean }> = ({
  card,
  brandColor,
  solid = false,
}) => {
  const { width, height } = useVideoConfig()
  const safe = safeRectFor(width, height)
  const ink = readableOn(brandColor)
  const buttonWidth = ctaButtonWidth(width, safe.width)
  const badge = height >= 1400 ? 228 : 168
  const nameSize = height >= 1400 ? 68 : 48
  return (
    <AbsoluteFill>
      {solid ? (
        <AbsoluteFill style={{ background: `linear-gradient(165deg, ${brandColor} 0%, #121820 42%, #070b10 100%)` }} />
      ) : (
        <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(6,10,16,0.5) 0%, rgba(6,10,16,0.66) 42%, rgba(6,10,16,0.74) 100%)' }} />
      )}
      <div style={stack(safe)}>
        <PopIn delay={0} travel={48}>
          <LogoMark card={card} brandColor={brandColor} ink={ink} frameWidth={width} badge={badge} />
        </PopIn>
        {card.brandName ? (
          <PopIn delay={5} travel={48}>
            <div style={{ fontFamily, fontWeight: 900, fontSize: nameSize, color: '#fff', letterSpacing: 0.4, textShadow: '0 6px 22px rgba(0,0,0,0.55)' }}>{card.brandName}</div>
          </PopIn>
        ) : null}
        <PopIn delay={10} travel={48}>
          <div style={{ width: buttonWidth, background: brandColor, color: ink, fontFamily, fontWeight: 900, fontSize: ctaFont(buttonWidth, card.cta), lineHeight: 1.1, borderRadius: 999, padding: '28px 24px', boxShadow: '0 14px 36px rgba(0,0,0,0.35)' }}>{card.cta}</div>
        </PopIn>
        {card.contact ? (
          <PopIn delay={15} travel={36}>
            <div style={{ fontFamily, fontWeight: 700, fontSize: height >= 1400 ? 36 : 28, color: 'rgba(255,255,255,0.94)' }}>{card.contact}</div>
          </PopIn>
        ) : null}
      </div>
    </AbsoluteFill>
  )
}
