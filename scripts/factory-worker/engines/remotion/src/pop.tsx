import React from 'react'
import { spring, useCurrentFrame, useVideoConfig } from 'remotion'

/** Slide-up that is already readable on frame 0, then settles. */
export const PopIn: React.FC<{ delay?: number; children: React.ReactNode }> = ({ delay = 0, children }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const p = spring({ frame: frame - delay, fps, config: { damping: 15, stiffness: 160, mass: 0.65 } })
  const settled = Math.min(1, Math.max(0, p))
  return (
    <div style={{ opacity: Math.max(0.55, settled), transform: `translateY(${(1 - settled) * 28}px)` }}>{children}</div>
  )
}
