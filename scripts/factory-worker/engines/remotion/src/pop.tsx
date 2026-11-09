import React from 'react'
import { spring, useCurrentFrame, useVideoConfig } from 'remotion'

/** Line slide that is already readable on frame 0, then punches into place. */
export const PopIn: React.FC<{ delay?: number; travel?: number; children: React.ReactNode }> = ({
  delay = 0,
  travel = 72,
  children,
}) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const p = spring({ frame: frame - delay, fps, config: { damping: 14, stiffness: 190, mass: 0.7 } })
  const settled = Math.min(1, Math.max(0, p))
  const scale = 0.9 + settled * 0.1
  return (
    <div style={{ opacity: Math.max(0.82, settled), transform: `translateY(${(1 - settled) * travel}px) scale(${scale})` }}>
      {children}
    </div>
  )
}
