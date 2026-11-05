import type { ViralRules } from './rules.ts'

export interface CompareShot {
  id: 'before' | 'process' | 'after'
  from: number
  frames: number
  lineKey: 'before' | 'process' | 'after'
}

export interface ComparePlan {
  mode: 'cuts' | 'single'
  shots: CompareShot[]
  totalFrames: number
  holdOnAfter: true
  cuts: number
  revealAt: number
}

function cutPlan(shot: number): ComparePlan {
  const keys = ['before', 'process', 'after'] as const
  const shots = keys.map((id, index) => ({ id, from: shot * index, frames: shot, lineKey: id }))
  return { mode: 'cuts', shots, totalFrames: shot * 3, holdOnAfter: true, cuts: 2, revealAt: shot * 2 }
}

function singlePlan(rules: ViralRules, fps: number): ComparePlan {
  const totalFrames = Math.round(rules.singleShotSec * fps)
  const revealAt = Math.max(1, totalFrames - Math.round(1.5 * fps))
  return {
    mode: 'single',
    shots: [{ id: 'before', from: 0, frames: totalFrames, lineKey: 'before' }],
    totalFrames,
    holdOnAfter: true,
    cuts: 0,
    revealAt,
  }
}

/** Before, then process, then hold on the finished picture. One uncut shot when the brief asks. */
export function computeComparePlan(rules: ViralRules, fps = 30, shotSec = rules.shotSec): ComparePlan {
  if (rules.singleShot) return singlePlan(rules, fps)
  return cutPlan(Math.max(1, Math.round(shotSec * fps)))
}

/** Which line is on screen. A single shot reveals the after line without a cut. */
export function compareLineAt(frame: number, plan: ComparePlan): 'before' | 'process' | 'after' {
  if (plan.mode === 'single') return frame >= plan.revealAt ? 'after' : 'before'
  for (let i = plan.shots.length - 1; i >= 0; i -= 1) {
    if (frame >= plan.shots[i].from) return plan.shots[i].lineKey
  }
  return 'before'
}
