/**
 * 表单新线索建档当下标「新线索」：只标配置里有 new 的客户、只标阶段仍为空的人、
 * 留痕写不上就退回、任何失败都不抛（不能挡表单入库）。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))

import { markNewLeadStage } from '../new-lead-stage'
import { NEW_LEAD_ACTOR } from '../actors'

let updates: Record<string, unknown>[]
let audits: Record<string, unknown>[]
let filters: [string, unknown][]
let isNull: string[]

function chain(result: () => unknown) {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'limit']) b[m] = () => b
  b.eq = (c: string, v: unknown) => {
    filters.push([c, v])
    return b
  }
  b.is = (c: string) => {
    isNull.push(c)
    return b
  }
  b.then = (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res)
  return b
}

function stub(o: { configured?: boolean; updated?: number; auditErr?: string; throwOn?: string } = {}) {
  const cfg = o.configured ?? true
  updates = []
  audits = []
  filters = []
  isNull = []
  mocks.from.mockImplementation((table: string) => {
    if (o.throwOn === table) throw new Error('boom')
    if (table === 'client_pipeline_stages') {
      return chain(() => ({ data: cfg ? [{ stage_key: 'new' }] : [], error: null }))
    }
    if (table === 'contacts') {
      return {
        update: (p: Record<string, unknown>) => {
          updates.push(p)
          return chain(() => ({ data: Array.from({ length: o.updated ?? 1 }, () => ({ id: 'c1' })), error: null }))
        },
      }
    }
    return {
      insert: (row: Record<string, unknown>) => {
        audits.push(row)
        return Promise.resolve({ error: o.auditErr ? { message: o.auditErr } : null })
      },
    }
  })
}

beforeEach(() => {
  mocks.from.mockReset()
})

describe('markNewLeadStage', () => {
  it('marks a brand-new form lead as new, only while stage is still empty, with an audit row', async () => {
    stub()
    await markNewLeadStage('client-1', 'c1')
    expect(updates[0]).toMatchObject({ stage: 'new' })
    expect(isNull).toContain('stage')
    expect(audits[0]).toMatchObject({ contact_id: 'c1', from_stage: null, to_stage: 'new', changed_by: NEW_LEAD_ACTOR })
  })

  it('does nothing for a client whose pipeline has no new stage', async () => {
    stub({ configured: false })
    await markNewLeadStage('client-1', 'c1')
    expect(updates).toHaveLength(0)
    expect(audits).toHaveLength(0)
  })

  it('writes no audit when someone already set a stage (update hits 0 rows)', async () => {
    stub({ updated: 0 })
    await markNewLeadStage('client-1', 'c1')
    expect(audits).toHaveLength(0)
  })

  it('rolls the stage back when the audit row cannot be written', async () => {
    stub({ auditErr: 'db down' })
    await markNewLeadStage('client-1', 'c1')
    expect(updates).toHaveLength(2)
    expect(updates[1]).toMatchObject({ stage: null, stage_updated_at: null })
  })

  it('never throws, so a failure cannot block the form from being saved', async () => {
    stub({ throwOn: 'client_pipeline_stages' })
    await expect(markNewLeadStage('client-1', 'c1')).resolves.toBeUndefined()
  })
})
