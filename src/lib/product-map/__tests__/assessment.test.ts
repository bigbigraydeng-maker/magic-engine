import { describe, it, expect } from 'vitest'
import {
  UNVERIFIED,
  UNVERIFIED_SNAPSHOT,
  assessComponent,
  buildOperationalSnapshot,
  checked,
  deriveMaturitySignals,
} from '../assessment'
import { SEED_COMPONENTS } from '../registry-data/seed-components'
import type { EvidenceProviders } from '../assessment'
import type { RegistryComponent } from '../types'

const component = SEED_COMPONENTS[0] as RegistryComponent
const AT = '2026-08-15T00:00:00.000Z'

describe('未接证据源时一律 unknown', () => {
  it('四问全 unknown，且 checkedAt 为 null', () => {
    const snapshot = buildOperationalSnapshot(component)
    expect(snapshot).toEqual(UNVERIFIED_SNAPSHOT)
    for (const check of Object.values(snapshot)) {
      expect(check.status).toBe('unknown')
      expect(check.checkedAt).toBeNull()
      expect(check.evidenceSource).toBe('not-wired')
    }
  })

  it('六道成熟度信号全 unknown —— 不补 no，也不补 yes', () => {
    const snapshot = buildOperationalSnapshot(component)
    const result = deriveMaturitySignals(component, snapshot)
    expect(Object.values(result).every((s) => s === 'unknown')).toBe(true)
  })

  it('整体评估停在 M0 且 limitedBy=unknown，而不是 confirmed_absent', () => {
    const assessment = assessComponent(component)
    expect(assessment.maturity.level).toBe('M0')
    expect(assessment.maturity.limitedBy).toBe('unknown')
  })

  it('每一条种子组件都能被评估，且不抛异常', () => {
    for (const seed of SEED_COMPONENTS) {
      const assessment = assessComponent(seed)
      expect(assessment.componentId).toBe(seed.componentId)
      expect(assessment.maturity.limitedBy).toBe('unknown')
    }
  })
})

describe('接上探针后按探针结果走', () => {
  const providers: EvidenceProviders = {
    codeInMain: () => checked('yes', 'github:main-sha', AT),
    productionPrerequisites: () => checked('no', 'production:information_schema', AT, '四张表都不存在'),
    realCaller: () => checked('no', 'code-scan:callers', AT),
    productionRun: () => checked('unknown', 'runtime:not-implemented', AT),
    contractFrozen: () => checked('yes', 'code-scan:spec-path', AT),
    targetedTests: () => checked('yes', 'github:checks', AT),
  }

  it('四问逐条来自探针，且带 evidenceSource / checkedAt', () => {
    const snapshot = buildOperationalSnapshot(component, providers)
    expect(snapshot.codeInMain).toEqual({ status: 'yes', evidenceSource: 'github:main-sha', checkedAt: AT })
    expect(snapshot.productionPrerequisitesExist.status).toBe('no')
    expect(snapshot.productionPrerequisitesExist.note).toBe('四张表都不存在')
    expect(snapshot.productionRunObserved.status).toBe('unknown')
  })

  it('「代码在 main、但没有真实调用方」被算成 M2，卡在 realIntegration', () => {
    const assessment = assessComponent(component, providers)
    expect(assessment.maturity).toEqual({
      level: 'M2',
      limitedBy: 'confirmed_absent',
      blockingSignal: 'realIntegration',
    })
  })

  it('没给的探针仍然是 unknown，不被其它探针的结果带偏', () => {
    const assessment = assessComponent(component, { codeInMain: () => checked('yes', 'github:main-sha', AT) })
    expect(assessment.maturitySignals.repeatedAttributableOutcome).toBe('unknown')
    expect(assessment.maturity.limitedBy).toBe('unknown')
  })

  it('四问与成熟度信号共享同一份事实，不会各说各话', () => {
    const snapshot = buildOperationalSnapshot(component, providers)
    const s = deriveMaturitySignals(component, snapshot, providers)
    expect(s.mergedToMain).toBe(snapshot.codeInMain.status)
    expect(s.realIntegration).toBe(snapshot.realCallerWired.status)
    expect(s.productionRun).toBe(snapshot.productionRunObserved.status)
  })
})

describe('UNVERIFIED 常量', () => {
  it('是冻结对象，防止调用方就地改成 yes', () => {
    expect(Object.isFrozen(UNVERIFIED)).toBe(true)
    expect(Object.isFrozen(UNVERIFIED_SNAPSHOT)).toBe(true)
  })
})
