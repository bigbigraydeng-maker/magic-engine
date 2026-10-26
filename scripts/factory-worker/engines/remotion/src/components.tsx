import React from 'react'
import { AbsoluteFill, Img, interpolate, OffthreadVideo, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { aspectFromCanvas, portraitCoverBox } from './aspect'
import { useStage } from './stage'

/** Legibility gradient; scrim (0-1) scales its strength, undefined or 1 keeps the original look byte for byte. */
export function scrimGradient(scrim?: number): string {
  if (scrim === undefined || scrim === 1) {
    return 'linear-gradient(180deg, rgba(0,0,0,0.38) 0%, rgba(0,0,0,0) 22%, rgba(0,0,0,0.30) 38%, rgba(0,0,0,0.66) 55%, rgba(0,0,0,0.82) 100%)'
  }
  const a = (v: number) => (v * scrim).toFixed(3)
  return `linear-gradient(180deg, rgba(0,0,0,${a(0.38)}) 0%, rgba(0,0,0,0) 22%, rgba(0,0,0,${a(0.3)}) 38%, rgba(0,0,0,${a(0.66)}) 55%, rgba(0,0,0,${a(0.82)}) 100%)`
}

function clipStyle(width: number, height: number): React.CSSProperties {
  if (aspectFromCanvas(width, height) === '9:16') return { width: '100%', height: '100%', objectFit: 'cover' }
  return portraitCoverBox(width, height)
}

/** Full-bleed real footage with slow push-in, light grade and a legibility gradient. */
export const Footage: React.FC<{ src: string; zoomTo?: number; startFrom?: number; scrim?: number }> = ({ src, zoomTo = 1.08, startFrom = 0, scrim }) => {
  const frame = useCurrentFrame()
  const { durationInFrames, width, height } = useVideoConfig()
  const aspect = aspectFromCanvas(width, height)
  const scale = interpolate(frame, [0, durationInFrames], [1.0, zoomTo], { extrapolateRight: 'clamp' })
  const video = (
    <OffthreadVideo src={staticFile(src)} startFrom={startFrom} muted style={clipStyle(width, height)} />
  )
  if (aspect === '16:9') {
    const panelW = Math.round(height * 9 / 16)
    return (
      <AbsoluteFill style={{ overflow: 'hidden', background: '#000' }}>
        <AbsoluteFill style={{ transform: `scale(${scale * 1.15})`, filter: 'blur(42px) saturate(1.25)' }}>
          {video}
        </AbsoluteFill>
        <div style={{ position: 'absolute', top: 0, right: 0, width: panelW, height, overflow: 'hidden' }}>
          <AbsoluteFill style={{ transform: `scale(${scale})`, filter: 'contrast(1.08) saturate(1.1)' }}>
            <OffthreadVideo src={staticFile(src)} startFrom={startFrom} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </AbsoluteFill>
        </div>
        <AbsoluteFill style={{ background: 'linear-gradient(90deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.28) 30%, rgba(0,0,0,0) 52%)' }} />
      </AbsoluteFill>
    )
  }
  return (
    <AbsoluteFill style={{ overflow: 'hidden', background: '#000' }}>
      <AbsoluteFill style={{ transform: `scale(${scale})`, filter: 'contrast(1.1) saturate(1.12)' }}>
        {video}
      </AbsoluteFill>
      <AbsoluteFill style={{ background: scrimGradient(scrim) }} />
      {aspect === '9:16' ? null : (
        <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.45) 62%, rgba(0,0,0,0.78) 100%)' }} />
      )}
    </AbsoluteFill>
  )
}

/** Cut transition: quick flash + settle-in, placed at the start of a scene. */
export const CutFlash: React.FC = () => {
  const frame = useCurrentFrame()
  const o = interpolate(frame, [0, 3, 9], [0.55, 0.3, 0], { extrapolateRight: 'clamp' })
  return <AbsoluteFill style={{ background: '#fff', opacity: o }} />
}

/** Masked slide-up text. delay in frames. */
export const Reveal: React.FC<{ children: React.ReactNode; delay?: number; style?: React.CSSProperties }> = ({ children, delay = 0, style }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const p = spring({ frame: frame - delay, fps, config: { damping: 14, stiffness: 140, mass: 0.7 } })
  return (
    <div style={{ overflow: 'hidden', paddingBottom: '0.24em', marginBottom: '-0.24em', ...style }}>
      <div style={{ transform: `translateY(${(1 - p) * 110}%)`, opacity: Math.min(1, p * 1.6) }}>{children}</div>
    </div>
  )
}

/** Persistent brand logo, file name comes from props (relative to the public dir). */
export const Logo: React.FC<{ file: string }> = ({ file }) => {
  const box = useStage().logo
  return <Img src={staticFile(file)} style={{ position: 'absolute', left: box.left, top: box.top, width: box.width, height: box.height, objectFit: 'contain', objectPosition: 'left center', filter: 'drop-shadow(0 6px 18px rgba(0,0,0,0.45))' }} />
}
