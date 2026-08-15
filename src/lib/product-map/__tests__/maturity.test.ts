import { describe, it, expect } from 'vitest'
import { deriveMaturityCeiling, isMaturityAbove, MATURITY_ORDER } from '../maturity'
import type { MaturityEvidenceFlags } from '../types'

const NO_EVIDENCE: MaturityEvidenceFlags = {
  hasContractFrozen: false,
  hasMergedToMain: false,
  hasTargetedTestsPassing: false,
  hasRealIntegrationEvidence: false,
  hasProductionRunEvidence: false,
  hasRepeatedOutcomeEvidence: false,
}

describe('deriveMaturityCeiling', () => {
  it('没有任何证据 → M0', () => {
    expect(deriveMaturityCeiling(NO_EVIDENCE)).toBe('M0')
  })

  it('只冻结了契约 → M1', () => {
    expect(deriveMaturityCeiling({ ...NO_EVIDENCE, hasContractFrozen: true })).toBe('M1')
  })

  it('只有 PR 未合并（hasMergedToMain=false）—— 最高 M1（Issue #974 证据上限）', () => {
    const evidence: MaturityEvidenceFlags = {
      ...NO_EVIDENCE,
      hasContractFrozen: true,
      hasMergedToMain: false,
      hasTargetedTestsPassing: true,
      hasRealIntegrationEvidence: true,
      hasProductionRunEvidence: true,
      hasRepeatedOutcomeEvidence: true,
    }
    expect(deriveMaturityCeiling(evidence)).toBe('M1')
  })

  it('合并到 main 但测试未过 —— 卡在 M1，不给 M2', () => {
    const evidence: MaturityEvidenceFlags = {
      ...NO_EVIDENCE,
      hasContractFrozen: true,
      hasMergedToMain: true,
      hasTargetedTestsPassing: false,
    }
    expect(deriveMaturityCeiling(evidence)).toBe('M1')
  })

  it('合并 main 且测试通过，无集成证据 —— 最高 M2', () => {
    const evidence: MaturityEvidenceFlags = {
      ...NO_EVIDENCE,
      hasContractFrozen: true,
      hasMergedToMain: true,
      hasTargetedTestsPassing: true,
      hasProductionRunEvidence: true,
      hasRepeatedOutcomeEvidence: true,
    }
    expect(deriveMaturityCeiling(evidence)).toBe('M2')
  })

  it('有真实集成证据但无生产运行证据 —— 不得 M4，停在 M3', () => {
    const evidence: MaturityEvidenceFlags = {
      ...NO_EVIDENCE,
      hasContractFrozen: true,
      hasMergedToMain: true,
      hasTargetedTestsPassing: true,
      hasRealIntegrationEvidence: true,
      hasRepeatedOutcomeEvidence: true,
    }
    expect(deriveMaturityCeiling(evidence)).toBe('M3')
  })

  it('有生产运行证据但无重复 outcome 证据 —— 不得 M5，停在 M4', () => {
    const evidence: MaturityEvidenceFlags = {
      ...NO_EVIDENCE,
      hasContractFrozen: true,
      hasMergedToMain: true,
      hasTargetedTestsPassing: true,
      hasRealIntegrationEvidence: true,
      hasProductionRunEvidence: true,
    }
    expect(deriveMaturityCeiling(evidence)).toBe('M4')
  })

  it('全部证据齐全 → M5', () => {
    const evidence: MaturityEvidenceFlags = {
      hasContractFrozen: true,
      hasMergedToMain: true,
      hasTargetedTestsPassing: true,
      hasRealIntegrationEvidence: true,
      hasProductionRunEvidence: true,
      hasRepeatedOutcomeEvidence: true,
    }
    expect(deriveMaturityCeiling(evidence)).toBe('M5')
  })

  it('高级证据为 true 但低级证据缺失时不能「跳级」—— 只认连续阶梯', () => {
    // hasProductionRunEvidence=true 但 hasRealIntegrationEvidence=false：不该因为 M4 证据在场就跳过 M3。
    const evidence: MaturityEvidenceFlags = {
      ...NO_EVIDENCE,
      hasContractFrozen: true,
      hasMergedToMain: true,
      hasTargetedTestsPassing: true,
      hasProductionRunEvidence: true,
    }
    expect(deriveMaturityCeiling(evidence)).toBe('M2')
  })
})

describe('isMaturityAbove', () => {
  it('按阶梯顺序比较，不是字符串比较', () => {
    expect(isMaturityAbove('M2', 'M1')).toBe(true)
    expect(isMaturityAbove('M1', 'M2')).toBe(false)
    expect(isMaturityAbove('M0', 'M0')).toBe(false)
  })

  it('MATURITY_ORDER 恰好是六级，顺序为 M0..M5', () => {
    expect(MATURITY_ORDER).toEqual(['M0', 'M1', 'M2', 'M3', 'M4', 'M5'])
  })
})
