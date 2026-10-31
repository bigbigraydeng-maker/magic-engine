import React from 'react'
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import { openingMove, type ViralRules } from './rules.ts'

/** First-shot push. With no rules, children render in place. */
export const OpeningMove: React.FC<{ rules: ViralRules | null; children: React.ReactNode }> = ({ rules, children }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  if (!rules) return <>{children}</>
  const pose = openingMove(frame, fps, rules)
  return (
    <AbsoluteFill style={{ transform: `translateY(${pose.translateY}px) scale(${pose.scale})`, transformOrigin: 'center center' }}>
      {children}
    </AbsoluteFill>
  )
}
