import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildExamCandidatesFromCorrections,
  correctionRecordsPath,
  correctionToExamCandidate,
  loadAdsAgentCorrections,
  loadExamCorrectionCandidates,
  validateStoredCorrections,
} from '../corrections'
import { CORRECTION_CANDIDATE_TEST_FILE } from '../corrections/to-candidate'

describe('广告 agent 纠正记录', () => {
  it('records.json 通过校验且无敏感形态', () => {
    const result = validateStoredCorrections()
    expect(result.ok, result.errors.map((e) => e.reason).join('; ')).toBe(true)
  })

  it('每条纠正 id 唯一', () => {
    const ids = loadAdsAgentCorrections().map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('转成候选题：lifecycle=candidate，不进入正式题号序列', () => {
    const corrections = loadAdsAgentCorrections()
    const candidates = buildExamCandidatesFromCorrections(corrections)
    expect(candidates.length).toBe(corrections.length)
    for (const c of candidates) {
      expect(c.lifecycle).toBe('candidate')
      expect(c.id.startsWith('QC')).toBe(true)
      expect(c.file).toBe(CORRECTION_CANDIDATE_TEST_FILE)
      expect(c.match).toContain(c.correctionId)
    }
  })

  it('候选题一律 expect=todo（并入正式题库前不自动计分）', () => {
    for (const c of loadExamCorrectionCandidates()) {
      expect(c.expect).toBe('todo')
    }
  })

  it('records 可注明已晋升正式题号（元数据，不改变候选状态）', () => {
    const row = loadAdsAgentCorrections().find((c) => c.id === 'CR-2026-11-03-whatsapp-d3')
    expect(row?.promotedQuestionId).toBe('Q23')
  })

  it('候选题的 match 出现在 correction-candidates 测试文件里', () => {
    const text = readFileSync(join(process.cwd(), CORRECTION_CANDIDATE_TEST_FILE), 'utf8')
    for (const c of loadExamCorrectionCandidates()) {
      expect(text.includes(c.match), `缺少 ${c.match}`).toBe(true)
    }
  })

  it('correctionToExamCandidate 使用连续 QC 编号', () => {
    const [first] = loadAdsAgentCorrections()
    const one = correctionToExamCandidate(first, 1)
    expect(one.id).toBe('QC01')
  })

  it('纠正记录路径稳定（供脚本/测试定位）', () => {
    expect(correctionRecordsPath()).toMatch(/records\.json$/)
  })
})
