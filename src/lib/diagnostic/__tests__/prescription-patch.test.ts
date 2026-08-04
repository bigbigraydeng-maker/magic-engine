/**
 * 回归锁：处方 approve/reject 的写库 payload 只能包含生产库真实存在的列。
 *
 * 2026-08-04 事故 —— 路由往 payload 上塞了 `rejection_note` / `approved_by`
 * 两个当时不存在的列，PostgREST 返 PGRST204，PATCH 一律 500，「重新生成」全坏。
 * 两列现由 20260804020000 migration 补上（生产库已生效），白名单同步放行。
 */

import { describe, it, expect } from 'vitest'
import {
  buildPrescriptionDecisionPatch,
  PRESCRIPTION_COLUMNS,
} from '../prescription-patch'

const REAL_COLUMNS = new Set<string>(PRESCRIPTION_COLUMNS)

describe('buildPrescriptionDecisionPatch', () => {
  it('拒绝 + 带理由 → 每个 key 都是真实列（事故本体）', () => {
    const patch = buildPrescriptionDecisionPatch({
      status: 'rejected',
      rejection_note: '用户要求重新生成',
    })

    for (const key of Object.keys(patch)) {
      expect(REAL_COLUMNS.has(key), `幻觉列: ${key}`).toBe(true)
    }
  })

  it('拒绝理由留痕，不丢', () => {
    const patch = buildPrescriptionDecisionPatch({
      status: 'rejected',
      rejection_note: '方向不对，重来',
    })

    expect(patch.status).toBe('rejected')
    expect(patch.rejection_note).toBe('方向不对，重来')
  })

  it('拒绝但没给理由 → 只改状态', () => {
    const patch = buildPrescriptionDecisionPatch({ status: 'rejected' })

    expect(patch).toEqual({ status: 'rejected' })
  })

  it('批准 → 时间戳 + 批准人', () => {
    const patch = buildPrescriptionDecisionPatch(
      { status: 'approved', approved_by: 'fde@magiclab.com' },
      new Date('2026-08-04T02:03:04.000Z'),
    )

    expect(patch).toEqual({
      status: 'approved',
      approved_at: '2026-08-04T02:03:04.000Z',
      approved_by: 'fde@magiclab.com',
    })
  })

  it('拒绝时不写批准人，批准时不写打回理由 —— 两条线不串', () => {
    const rejected = buildPrescriptionDecisionPatch({
      status: 'rejected',
      rejection_note: '打回',
      approved_by: 'fde@magiclab.com',
    })
    expect(rejected).not.toHaveProperty('approved_by')

    const approved = buildPrescriptionDecisionPatch({
      status: 'approved',
      rejection_note: '不该出现',
    })
    expect(approved).not.toHaveProperty('rejection_note')
  })

  it('没拿到批准人邮箱时不写空值', () => {
    const patch = buildPrescriptionDecisionPatch({ status: 'approved', approved_by: undefined })

    expect(patch).not.toHaveProperty('approved_by')
    expect(patch.status).toBe('approved')
  })

  it('列白名单跟 migration 对齐', () => {
    for (const col of ['rejection_note', 'approved_by', 'approved_at', 'progress_note']) {
      expect(REAL_COLUMNS.has(col), `白名单缺列: ${col}`).toBe(true)
    }
  })
})
