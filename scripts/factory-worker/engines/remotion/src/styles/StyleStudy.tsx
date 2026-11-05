import React from 'react'
import { AbsoluteFill, Sequence } from 'remotion'
import { studyPlan } from './craft.ts'
import { useStyleFamily } from './fonts'
import { defaultRules, silentCard } from './rules.ts'
import { CraftShot } from './stage'
import type { ResolvedLook } from './types.ts'

/** Same words and clips for every pack, so the edit is the only difference. */
export const STUDY_SAMPLE = {
  point: '今天的热汤',
  lines: ['热汤刚出锅', '小碗慢炖', '再来一碗'],
  clips: ['clips/hook.mp4', 'clips/item1.mp4', 'clips/item2.mp4'],
}

/** Six-to-eight second study. Not a customer template. */
export const StyleStudy: React.FC<{ look?: ResolvedLook }> = ({ look }) => {
  const family = useStyleFamily(look ?? null)
  if (!look?.craft || family === null) return null
  const plan = studyPlan(look.craft)
  const rules = look.rules ?? defaultRules()
  const point = silentCard(rules, STUDY_SAMPLE.point).point
  if (family === null) return null
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {Array.from({ length: plan.shots }, (_, i) => (
        <Sequence key={i} from={i * plan.shotFrames} durationInFrames={plan.shotFrames}>
          <CraftShot
            look={look}
            family={family}
            src={STUDY_SAMPLE.clips[i % STUDY_SAMPLE.clips.length]}
            text={STUDY_SAMPLE.lines[i % STUDY_SAMPLE.lines.length]}
            point={point}
            rules={rules}
          />
        </Sequence>
      ))}
    </AbsoluteFill>
  )
}
