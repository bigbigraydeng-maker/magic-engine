import React from 'react'
import { Sequence } from 'remotion'
import { BrandEndCard } from './BrandEndCard.tsx'
import type { ResolvedEndCard, ResolvedHook } from './frame.ts'
import { overlayWindows } from './frame.ts'
import { OpeningHook } from './OpeningHook.tsx'

/** Opt-in opening and ending overlays. Renders nothing when both sides are off, so existing reels stay put. */
export const FrameOverlay: React.FC<{
  totalFrames: number
  hook: ResolvedHook | null
  endCard: ResolvedEndCard | null
  brandColor: string
}> = ({ totalFrames, hook, endCard, brandColor }) => {
  if (!hook && !endCard) return null
  const windows = overlayWindows(totalFrames)
  return (
    <>
      {hook && windows.hookFrames > 0 ? (
        <Sequence from={0} durationInFrames={windows.hookFrames}>
          <OpeningHook hook={hook} brandColor={brandColor} />
        </Sequence>
      ) : null}
      {endCard && windows.endFrames > 0 ? (
        <Sequence from={windows.endFrom} durationInFrames={windows.endFrames}>
          <BrandEndCard card={endCard} brandColor={brandColor} solid />
        </Sequence>
      ) : null}
    </>
  )
}
