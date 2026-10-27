import React from 'react'
import { AbsoluteFill, Img, interpolate, OffthreadVideo, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'

/** Legibility gradient; scrim (0-1) scales its strength, undefined or 1 keeps the original look byte for byte. */
export function scrimGradient(scrim?: number): string {
  if (scrim === undefined || scrim === 1) {
    return 'linear-gradient(180deg, rgba(0,0,0,0.38) 0%, rgba(0,0,0,0) 22%, rgba(0,0,0,0.30) 38%, rgba(0,0,0,0.66) 55%, rgba(0,0,0,0.82) 100%)'
  }
  const a = (v: number) => (v * scrim).toFixed(3)
  return `linear-gradient(180deg, rgba(0,0,0,${a(0.38)}) 0%, rgba(0,0,0,0) 22%, rgba(0,0,0,${a(0.3)}) 38%, rgba(0,0,0,${a(0.66)}) 55%, rgba(0,0,0,${a(0.82)}) 100%)`
}

/** Full-bleed real footage with slow push-in, light grade and a legibility gradient. */
export const Footage: React.FC<{ src: string; zoomTo?: number; startFrom?: number; scrim?: number }> = ({ src, zoomTo = 1.08, startFrom = 0, scrim }) => {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  const scale = interpolate(frame, [0, durationInFrames], [1.0, zoomTo], { extrapolateRight: 'clamp' })
  return (
    <AbsoluteFill style={{ overflow: 'hidden', background: '#000' }}>
      <AbsoluteFill style={{ transform: `scale(${scale})`, filter: 'contrast(1.1) saturate(1.12)' }}>
        <OffthreadVideo src={staticFile(src)} startFrom={startFrom} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </AbsoluteFill>
      <AbsoluteFill style={{ background: scrimGradient(scrim) }} />
    </AbsoluteFill>
  )
}

/** Cut transition: quick flash + settle-in, placed at the start of a scene. Default peak matches the original flash. */
export const CutFlash: React.FC<{ peak?: number; fadeAt?: number }> = ({ peak, fadeAt }) => {
  const frame = useCurrentFrame()
  const o = peak === undefined
    ? interpolate(frame, [0, 3, 9], [0.55, 0.3, 0], { extrapolateRight: 'clamp' })
    : interpolate(frame, [0, 3, fadeAt ?? 9], [peak, peak * 0.55, 0], { extrapolateRight: 'clamp' })
  return <AbsoluteFill style={{ background: '#fff', opacity: o }} />
}

/** Masked slide-up text. delay in frames. Without motion, the spring matches the original. */
export const Reveal: React.FC<{ children: React.ReactNode; delay?: number; style?: React.CSSProperties; motion?: { damping: number; stiffness: number; mass: number } }> = ({ children, delay = 0, style, motion }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const config = motion ?? { damping: 14, stiffness: 140, mass: 0.7 }
  const p = spring({ frame: frame - delay, fps, config })
  return (
    <div style={{ overflow: 'hidden', paddingBottom: '0.24em', marginBottom: '-0.24em', ...style }}>
      <div style={{ transform: `translateY(${(1 - p) * 110}%)`, opacity: Math.min(1, p * 1.6) }}>{children}</div>
    </div>
  )
}

/** Persistent brand logo, file name comes from props (relative to the public dir). */
export const Logo: React.FC<{ file: string }> = ({ file }) => {
  return <Img src={staticFile(file)} style={{ position: 'absolute', left: 54, top: 292, width: 470, height: 171, objectFit: 'contain', objectPosition: 'left center', filter: 'drop-shadow(0 6px 18px rgba(0,0,0,0.45))' }} />
}
