import { describe, expect, it } from 'vitest'
import { createStepTimer } from '../step-timing'

describe('createStepTimer', () => {
  it('reports each step as the time since the previous mark, plus the total', () => {
    let t = 1000
    const timer = createStepTimer(() => t)
    t = 1100
    timer.step('gate')
    t = 1450
    timer.step('db')
    t = 1500
    expect(timer.header()).toBe('gate;dur=100.0, db;dur=350.0, total;dur=500.0')
  })

  it('never reports a negative duration', () => {
    let t = 1000
    const timer = createStepTimer(() => t)
    t = 900
    timer.step('clock-went-back')
    expect(timer.header()).toContain('clock-went-back;dur=0.0')
  })

  it('works with no steps', () => {
    const timer = createStepTimer(() => 5)
    expect(timer.header()).toBe('total;dur=0.0')
  })
})
