import { describe, expect, it } from 'vitest'

import { parseGateMarkers } from '../src/gate-marker.mjs'
import { buildRatingComment, buildReadinessComment } from '../src/report.mjs'

const BASE = 'd8ee449d13f7632e2f67234a22d00a1b76175b9b'
const HEAD = '7a1527bc3b2e5a064815d761ecea7e27848c3108'

describe('buildRatingComment', () => {
  it('names the risk level and embeds a matching gate marker', () => {
    const comment = buildRatingComment({
      risk: 'A',
      computedRisk: 'A',
      declaredRisk: null,
      readable: true,
      reasons: ['.github/workflows/x.yml —— A 级（CI 定义）'],
      base: BASE,
      head: HEAD,
    })
    expect(comment).toContain('PR 风险自动定级：A')
    expect(comment).toContain('.github/workflows/x.yml —— A 级')
    const [marker] = parseGateMarkers([comment])
    expect(marker).toMatchObject({ base: BASE, head: HEAD, risk: 'A' })
  })

  it('says when the declared level was overridden by a higher computed level', () => {
    const comment = buildRatingComment({
      risk: 'A',
      computedRisk: 'A',
      declaredRisk: 'C',
      readable: true,
      reasons: [],
      base: BASE,
      head: HEAD,
    })
    expect(comment).toContain('PR 自报 C 级')
    expect(comment).toContain('取更高的一档：A')
  })

  it('flags an unreadable file list rather than staying silent about it', () => {
    const comment = buildRatingComment({
      risk: 'A',
      computedRisk: 'A',
      declaredRisk: null,
      readable: false,
      reasons: ['拿不到改动文件清单 —— 无法判定，按 A 处理'],
      base: BASE,
      head: HEAD,
    })
    expect(comment).toContain('读不到或不完整')
  })

  it('renders a placeholder when there are no reasons at all', () => {
    const comment = buildRatingComment({
      risk: 'C',
      computedRisk: 'C',
      declaredRisk: null,
      readable: true,
      reasons: [],
      base: BASE,
      head: HEAD,
    })
    expect(comment).toContain('（无）')
  })
})

describe('buildReadinessComment', () => {
  it('titles a READY verdict distinctly from a BLOCKED one', () => {
    const ready = buildReadinessComment({
      decision: 'READY_FOR_PRODUCT_OWNER',
      risk: 'C',
      score: 90,
      threshold: 75,
      blockers: [],
      base: BASE,
      head: HEAD,
    })
    expect(ready).toContain('READY FOR PRODUCT OWNER')
    expect(ready).toContain('无阻塞项')

    const blocked = buildReadinessComment({
      decision: 'BLOCKED',
      risk: 'A',
      score: 40,
      threshold: 90,
      blockers: ['质量分 40 低于 A 级门槛 90'],
      base: BASE,
      head: HEAD,
    })
    expect(blocked).toContain('BLOCKED')
    expect(blocked).toContain('质量分 40 低于 A 级门槛 90')
  })

  it('embeds a gate marker carrying the score and decision', () => {
    const comment = buildReadinessComment({
      decision: 'READY_FOR_PRODUCT_OWNER',
      risk: 'B',
      score: 88,
      threshold: 85,
      blockers: [],
      base: BASE,
      head: HEAD,
    })
    const [marker] = parseGateMarkers([comment])
    expect(marker).toMatchObject({ risk: 'B', score: 88, decision: 'READY_FOR_PRODUCT_OWNER' })
  })

  it('never claims a merge or deployment happened', () => {
    const comment = buildReadinessComment({
      decision: 'READY_FOR_PRODUCT_OWNER',
      risk: 'C',
      score: 100,
      threshold: 75,
      blockers: [],
      base: BASE,
      head: HEAD,
    })
    expect(comment).toContain('从不 merge')
  })
})
