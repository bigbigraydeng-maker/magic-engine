import React from 'react'
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { Footage, Reveal } from './components'
import { fontFamily } from './theme'
import { priceFontSizeFor } from './priceSize'
import { useStage } from './stage'

export const PriceScene: React.FC<{ backdrop: string; brandColor: string; fromLabel: string; currencyPrefix: string; amount: number; qualifier: string; dateLine?: string; footnote: string; footnoteSize?: number; top: number; scrim?: number; layout?: 'center' | 'corner'; qualifierSize?: number; footnoteBackdrop?: boolean; left?: number; fastReveal?: boolean }> = ({ backdrop, brandColor, fromLabel, currencyPrefix, amount, qualifier, dateLine, footnote, footnoteSize, top, scrim, layout, qualifierSize, footnoteBackdrop, left, fastReveal }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const stage = useStage()
  const priceFontSize = priceFontSizeFor(currencyPrefix, amount, fastReveal === true)
  const pop = spring({ frame: frame - (fastReveal ? 2 : 4), fps, config: { damping: 11, stiffness: 160, mass: 0.7 } })
  const corner = layout === 'corner'
  const designLeft = corner ? 270 : (left ?? 0)
  const designWidth = corner ? 690 : (left === undefined ? 960 : 1080 - 2 * left)
  const placed = stage.place({ left: designLeft, top: corner ? top + 120 : top, width: designWidth, fontSize: priceFontSize, lines: 5, lineHeight: 1.1, blockPx: 80 })
  const sz = (n: number) => stage.fit(n, placed, priceFontSize)
  const containerStyle: React.CSSProperties = {
    position: 'absolute',
    left: placed.left,
    width: placed.width,
    top: placed.top,
    textAlign: corner ? 'right' : 'center',
    fontFamily,
    color: '#fff',
    textShadow: '0 4px 24px rgba(0,0,0,0.55)',
  }
  const noteSize = sz(footnoteSize ?? 30)
  const footnoteStyle: React.CSSProperties = footnoteBackdrop
    ? { display: 'inline-block', background: 'rgba(0,0,0,0.55)', padding: '6px 20px', borderRadius: 8, opacity: 1, fontSize: noteSize, fontWeight: 600, letterSpacing: 1 }
    : { fontSize: noteSize, fontWeight: 600, opacity: 0.92, letterSpacing: 1 }
  return (
    <AbsoluteFill>
      <Footage src={backdrop} zoomTo={1.05} scrim={scrim} />
      <AbsoluteFill style={{ background: 'rgba(5,10,18,0.22)' }} />
      <div style={containerStyle}>
        <Reveal delay={0}><div style={{ fontSize: sz(corner ? (fastReveal ? 40 : 34) : 46), fontWeight: 800, letterSpacing: corner ? 6 : 10 }}>{fromLabel}</div></Reveal>
        <div style={{ background: brandColor, padding: '8px 34px', borderRadius: 14, display: 'inline-block', margin: '6px 0', fontSize: sz(corner ? Math.floor(priceFontSize * 0.62) : priceFontSize), fontWeight: 900, lineHeight: 1.05, opacity: Math.min(1, pop * 2), transform: `scale(${0.7 + 0.3 * pop})` }}>{currencyPrefix}{amount.toLocaleString('en-US')}</div>
        <Reveal delay={fastReveal ? 4 : 14}><div style={{ display: 'inline-block', background: '#fff', color: brandColor, padding: '10px 28px', borderRadius: 8, fontSize: sz(qualifierSize ?? 40), fontWeight: 800, letterSpacing: 2 }}>{qualifier}</div></Reveal>
        {typeof dateLine === 'string' ? <Reveal delay={fastReveal ? 7 : 22} style={{ marginTop: 34 }}><div style={{ fontSize: sz(corner ? 44 : 62), fontWeight: 900 }}>{dateLine}</div></Reveal> : null}
        <Reveal delay={fastReveal ? 10 : 28}><div style={footnoteStyle}>{footnote}</div></Reveal>
      </div>
    </AbsoluteFill>
  )
}
