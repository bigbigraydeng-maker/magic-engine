import React from 'react'
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { Footage, Reveal } from './components'
import { fontFamily } from './theme'
import { priceFontSizeFor } from './priceSize'
import type { PriceChrome } from './styles/paint-list'

export const PriceScene: React.FC<{ backdrop: string; brandColor: string; fromLabel: string; currencyPrefix: string; amount: number; qualifier: string; dateLine?: string; footnote: string; footnoteSize?: number; top: number; scrim?: number; layout?: 'center' | 'corner'; qualifierSize?: number; footnoteBackdrop?: boolean; left?: number; fastReveal?: boolean; chrome?: PriceChrome }> = ({ backdrop, brandColor, fromLabel, currencyPrefix, amount, qualifier, dateLine, footnote, footnoteSize, top, scrim, layout, qualifierSize, footnoteBackdrop, left, fastReveal, chrome }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const priceFontSize = priceFontSizeFor(currencyPrefix, amount, fastReveal === true)
  const pop = spring({ frame: frame - (fastReveal ? 2 : 4), fps, config: { damping: 11, stiffness: 160, mass: 0.7 } })
  const corner = layout === 'corner'
  const family = chrome?.fontFamily ?? fontFamily
  const ink = chrome?.textOnBrand ?? '#fff'
  const chipRadius = chrome?.chipRadius ?? 14
  const qualifierRadius = chrome?.qualifierRadius ?? 8
  const containerStyle: React.CSSProperties = corner
    ? { position: 'absolute', left: 270, width: 690, top: top + 120, textAlign: 'right', fontFamily: family, color: ink, textShadow: '0 4px 24px rgba(0,0,0,0.55)' }
    : { position: 'absolute', left: left ?? 0, width: left === undefined ? 960 : 1080 - 2 * left, top, textAlign: 'center', fontFamily: family, color: ink, textShadow: '0 4px 24px rgba(0,0,0,0.55)' }
  const footnoteStyle: React.CSSProperties = footnoteBackdrop
    ? { display: 'inline-block', background: 'rgba(0,0,0,0.55)', padding: '6px 20px', borderRadius: qualifierRadius, opacity: 1, fontSize: footnoteSize ?? 30, fontWeight: 600, letterSpacing: 1 }
    : { fontSize: footnoteSize ?? 30, fontWeight: 600, opacity: 0.92, letterSpacing: 1 }
  return (
    <AbsoluteFill>
      <Footage src={backdrop} zoomTo={1.05} scrim={scrim} />
      <AbsoluteFill style={{ background: 'rgba(5,10,18,0.22)' }} />
      <div style={containerStyle}>
        <Reveal delay={0}><div style={{ fontSize: corner ? (fastReveal ? 40 : 34) : 46, fontWeight: 800, letterSpacing: corner ? 6 : 10 }}>{fromLabel}</div></Reveal>
        <div style={{ background: chrome?.brand ?? brandColor, color: ink, padding: '8px 34px', borderRadius: chipRadius, display: 'inline-block', margin: '6px 0', fontSize: corner ? Math.floor(priceFontSize * 0.62) : priceFontSize, fontWeight: 900, lineHeight: 1.05, opacity: Math.min(1, pop * 2), transform: `scale(${0.7 + 0.3 * pop})` }}>{currencyPrefix}{amount.toLocaleString('en-US')}</div>
        <Reveal delay={fastReveal ? 4 : 14}><div style={{ display: 'inline-block', background: chrome?.surface ?? '#fff', color: chrome?.onSurface ?? brandColor, padding: '10px 28px', borderRadius: qualifierRadius, fontSize: qualifierSize ?? 40, fontWeight: 800, letterSpacing: 2 }}>{qualifier}</div></Reveal>
        {typeof dateLine === 'string' ? <Reveal delay={fastReveal ? 7 : 22} style={{ marginTop: 34 }}><div style={{ fontSize: corner ? 44 : 62, fontWeight: 900 }}>{dateLine}</div></Reveal> : null}
        <Reveal delay={fastReveal ? 10 : 28}><div style={footnoteStyle}>{footnote}</div></Reveal>
      </div>
    </AbsoluteFill>
  )
}
