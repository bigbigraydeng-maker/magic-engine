import React from 'react'
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { Footage, Reveal } from './components'
import { fontFamily } from './theme'

export const PriceScene: React.FC<{ backdrop: string; brandColor: string; fromLabel: string; currencyPrefix: string; amount: number; qualifier: string; dateLine: string; footnote: string; top: number }> = ({ backdrop, brandColor, fromLabel, currencyPrefix, amount, qualifier, dateLine, footnote, top }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  // Long price strings shrink so they stay inside the 960px safe width (9 chars or fewer keep the base size).
  const priceChars = currencyPrefix.length + amount.toLocaleString('en-US').length
  const priceFontSize = Math.floor((amount >= 10000 ? 146 : 170) * Math.min(1, 9 / priceChars))
  const pop = spring({ frame: frame - 4, fps, config: { damping: 11, stiffness: 160, mass: 0.7 } })
  return (
    <AbsoluteFill>
      <Footage src={backdrop} zoomTo={1.05} />
      <AbsoluteFill style={{ background: 'rgba(5,10,18,0.22)' }} />
      <div style={{ position: 'absolute', left: 0, width: 960, top, textAlign: 'center', fontFamily, color: '#fff', textShadow: '0 4px 24px rgba(0,0,0,0.55)' }}>
        <Reveal delay={0}><div style={{ fontSize: 46, fontWeight: 800, letterSpacing: 10 }}>{fromLabel}</div></Reveal>
        <div style={{ background: brandColor, padding: '8px 34px', borderRadius: 14, display: 'inline-block', margin: '6px 0', fontSize: priceFontSize, fontWeight: 900, lineHeight: 1.05, opacity: Math.min(1, pop * 2), transform: `scale(${0.7 + 0.3 * pop})` }}>{currencyPrefix}{amount.toLocaleString('en-US')}</div>
        <Reveal delay={14}><div style={{ display: 'inline-block', background: '#fff', color: brandColor, padding: '10px 28px', borderRadius: 8, fontSize: 40, fontWeight: 800, letterSpacing: 2 }}>{qualifier}</div></Reveal>
        <Reveal delay={22} style={{ marginTop: 34 }}><div style={{ fontSize: 62, fontWeight: 900 }}>{dateLine}</div></Reveal>
        <Reveal delay={28}><div style={{ fontSize: 30, fontWeight: 600, opacity: 0.92, letterSpacing: 1 }}>{footnote}</div></Reveal>
      </div>
    </AbsoluteFill>
  )
}
