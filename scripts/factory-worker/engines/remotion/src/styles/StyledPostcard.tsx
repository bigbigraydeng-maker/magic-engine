import React from 'react'
import { AbsoluteFill, Audio, interpolate, Sequence, staticFile, useCurrentFrame } from 'remotion'
import { Logo } from '../components'
import type { PostcardProps } from '../postcard'
import { FPS } from '../timing'
import { effectiveShotSec } from './craft.ts'
import { CraftShot } from './stage'
import { logoStartFrame, silentCard, styledPostcardTiming } from './rules.ts'
import type { ResolvedLook } from './types.ts'

interface Segment {
  clip: string
  text: string
}

function segmentsOf(props: PostcardProps): Segment[] {
  const rows: Segment[] = [{ clip: props.hook.clip, text: props.hook.lines.join(' ') }]
  for (const scene of props.scenes) rows.push({ clip: scene.clip, text: `${scene.place} ${scene.line}` })
  if (props.price !== null) {
    rows.push({ clip: props.price.backdropClip, text: `${props.price.fromLabel} ${props.price.currencyPrefix}${props.price.amount}` })
  } else if (props.end !== null) {
    rows.push({ clip: props.end.backdropClip, text: props.end.title })
  }
  return rows
}

function pointOf(props: PostcardProps): string {
  return props.scenes[0]?.line || props.hook.lines[0] || props.end?.title || ' '
}

/** Postcard that follows the pack's edit, not only its colours. */
export const StyledPostcard: React.FC<{ props: PostcardProps; look: ResolvedLook; family: string }> = ({ props, look, family }) => {
  const frame = useCurrentFrame()
  const timing = styledPostcardTiming(props, look.rules, FPS, effectiveShotSec(look))
  const rows = segmentsOf(props)
  const point = silentCard(look.rules, pointOf(props)).point
  const twist = props.end?.title ?? props.scenes[0]?.line ?? rows[0].text
  const requested = props.logoMode === 'always' ? 0 : Math.max(0, timing.totalFrames - 60)
  const logoFrom = logoStartFrame(requested, look.rules, FPS)
  const vol = interpolate(frame, [0, 8, timing.totalFrames - 36, timing.totalFrames - 4], [0, 1, 1, 0], { extrapolateRight: 'clamp' })
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {timing.singleShot ? (
        <Sequence from={0} durationInFrames={timing.totalFrames}>
          <Single rows={rows} twist={twist} revealAt={timing.priceFrom} look={look} family={family} point={point} />
        </Sequence>
      ) : (
        rows.map((row, i) => (
          <Sequence key={row.clip + i} from={i * timing.hookFrames} durationInFrames={timing.hookFrames}>
            <CraftShot look={look} family={family} src={row.clip} text={row.text} point={point} rules={look.rules} />
          </Sequence>
        ))
      )}
      <Sequence from={logoFrom} durationInFrames={Math.max(1, timing.totalFrames - logoFrom)}>
        <Logo file={look.logoFile ?? props.logoFile} />
      </Sequence>
      {props.musicFile !== null ? (
        <Audio src={staticFile(props.musicFile)} volume={vol * 0.9 * (props.musicGain ?? 1)} startFrom={Math.round((props.musicStartSec ?? 0) * FPS)} />
      ) : null}
    </AbsoluteFill>
  )
}

const Single: React.FC<{
  rows: Segment[]
  twist: string
  revealAt: number
  look: ResolvedLook
  family: string
  point: string
}> = ({ rows, twist, revealAt, look, family, point }) => {
  const frame = useCurrentFrame()
  const text = frame >= revealAt ? twist : rows[0].text
  return <CraftShot look={look} family={family} src={rows[0].clip} text={text} point={point} rules={look.rules} />
}
