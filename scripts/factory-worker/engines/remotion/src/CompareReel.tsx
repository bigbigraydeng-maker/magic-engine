import React from 'react'
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame } from 'remotion'
import { Logo } from './components'
import { templateProps } from './aspect'
import { parseCompareProps, computeCompareTiming, type CompareProps } from './compare'
import { effectiveShotSec, type Craft } from './styles/craft'
import { useStyleFamily } from './styles/fonts'
import { compareLineAt } from './styles/compare-plan'
import { logoStartFrame, silentCard, defaultRules } from './styles/rules'
import { safeZone } from './styles/safe'
import { peelStyle } from './styles/select'
import { CraftShot } from './styles/stage'
import { FPS } from './timing'
import type { ResolvedLook } from './styles/types'

const PLAIN: Craft = {
  family: 'warm',
  transitions: ['cut'],
  textMotion: 'slide-line',
  rhythm: 'medium',
  shotSec: 2,
  beatSec: 2,
  caption: 'lower-third',
  picture: 'kenburns',
}

/** Before, process, then hold on the finished picture. */
export const CompareReel: React.FC<Record<string, unknown>> = (rawProps) => {
  const peeled = peelStyle(rawProps)
  const look = peeled.look == null ? null : (peeled.look as ResolvedLook)
  const family = useStyleFamily(look)
  const props = parseCompareProps(templateProps(peeled.body))
  const frame = useCurrentFrame()
  const rules = look?.rules ?? defaultRules()
  const shotSec = look ? effectiveShotSec(look) : rules.shotSec
  const plan = computeCompareTiming(rules, shotSec)
  const point = silentCard(rules, props.point).point
  const logoFrom = logoStartFrame(Math.max(0, plan.totalFrames - 50), rules, FPS)
  if (family === null && look) return null
  const painted = look ?? plainLook(props)
  const face = family ?? 'sans-serif'
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {plan.mode === 'single' ? (
        <Sequence from={0} durationInFrames={plan.totalFrames}>
          <CraftShot look={painted} family={face} src={props.before.clip} text={frame >= plan.revealAt ? props.after.line : props.hook} point={point} rules={rules} />
        </Sequence>
      ) : (
        plan.shots.map((shot) => (
          <Sequence key={shot.id} from={shot.from} durationInFrames={shot.frames}>
            <CraftShot look={painted} family={face} src={props[shot.lineKey].clip} text={props[shot.lineKey].line} point={point} rules={rules} />
          </Sequence>
        ))
      )}
      <Sequence from={logoFrom} durationInFrames={Math.max(1, plan.totalFrames - logoFrom)}>
        <Logo file={look?.logoFile ?? props.logoFile} />
      </Sequence>
      {props.musicFile !== null ? <Audio src={staticFile(props.musicFile)} volume={0.8} /> : null}
    </AbsoluteFill>
  )
}

function plainLook(props: CompareProps): ResolvedLook {
  return {
    presetId: 'home',
    name: '家政上门',
    selection: 'clean',
    fonts: { latinId: 'Nunito', cjkId: 'NotoSansSC', role: 'sans' },
    colors: {
      canvas: '#143026', surface: '#f4ede4', brand: props.brandColor, accent: '#f2c14e',
      text: '#ffffff', muted: '#d7e6dc', textOnBrand: '#143026', brandInk: props.brandColor, onSurface: '#143026',
    },
    type: { hook: 84, title: 64, body: 56, label: 32, weightHook: 800, weightTitle: 800, weightBody: 700, weightLabel: 700, trackingLabel: 0, labelCase: 'none' },
    shape: { radiusCard: 18, radiusChip: 8, strokeWidth: 0, strokeColor: props.brandColor },
    motion: { kind: 'slide', damping: 14, stiffness: 120, mass: 0.8, enterFrames: 12, flashPeak: 0, flashFrames: 8 },
    card: { fill: 'rgba(20,48,38,0.88)', placeColor: '#f2c14e', lineColor: '#ffffff', shadow: 'none' },
    craft: PLAIN,
    rules: defaultRules(),
    safe: safeZone(),
  }
}

export function comparePhaseAt(frame: number, props: CompareProps, look: ResolvedLook | null): 'before' | 'process' | 'after' {
  const rules = look?.rules ?? defaultRules()
  const shotSec = look ? effectiveShotSec(look) : rules.shotSec
  return compareLineAt(frame, computeCompareTiming(rules, shotSec))
}
