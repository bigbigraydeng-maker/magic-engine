import { describe, expect, it } from 'vitest'
import { mutatePayload, withAuth } from './payload-lock'
import type { PromoteStore, TrafficRow } from './types'

function makeStore(initial: Record<string, unknown>, beforeCas?: (row: TrafficRow) => void) {
  const row: TrafficRow = { id: 'r', client_id: 'c', payload: initial }
  let casCalls = 0
  const store = {
    loadTrafficRow: async () => structuredClone(row),
    casPayload: async (_i: string, _c: string, expected: string | null, next: Record<string, unknown>) => {
      casCalls += 1
      beforeCas?.(row)
      const cur = row.payload['promote_rev'] ?? null
      if (cur !== expected) return false
      row.payload = next
      return true
    },
  } as unknown as PromoteStore
  return { row, store, calls: () => casCalls }
}

let n = 0
const uuid = () => `rev-${++n}`

describe('mutatePayload 版本号乐观锁', () => {
  it('合并写入:保留原有字段并换新版本号', async () => {
    const { row, store } = makeStore({ keep: 1, promote_rev: 'old' })
    const r = await mutatePayload({ store, uuid }, { id: 'r', client_id: 'c' }, (cur) => ({ ...cur, added: 2 }), 3)
    expect(r.ok).toBe(true)
    expect(row.payload['keep']).toBe(1)
    expect(row.payload['added']).toBe(2)
    expect(row.payload['promote_rev']).not.toBe('old')
  })

  it('首次(payload 还没有 promote_rev)以 null 作期望值', async () => {
    const { row, store } = makeStore({ a: 1 })
    expect((await mutatePayload({ store, uuid }, { id: 'r', client_id: 'c' }, (cur) => ({ ...cur }), 1)).ok).toBe(true)
    expect(typeof row.payload['promote_rev']).toBe('string')
  })

  it('被别的写手抢先:重读最新值再合并,别人的写入不被冲掉', async () => {
    let bumped = false
    const { row, store } = makeStore({ promote_rev: 'v1' }, (r) => {
      if (!bumped) { bumped = true; r.payload = { ...r.payload, other: 'kept', promote_rev: 'v2' } }
    })
    const r = await mutatePayload({ store, uuid }, { id: 'r', client_id: 'c' }, (cur) => ({ ...cur, mine: true }), 3)
    expect(r.ok).toBe(true)
    expect(row.payload['other']).toBe('kept')
    expect(row.payload['mine']).toBe(true)
  })

  it('只试 1 次时撞版本号直接 conflict;fn 返回字符串 = 拒绝且不写库', async () => {
    const { store, calls } = makeStore({ promote_rev: 'v1' }, (r) => { r.payload = { promote_rev: 'zzz' } })
    const r = await mutatePayload({ store, uuid }, { id: 'r', client_id: 'c' }, (cur) => ({ ...cur }), 1)
    expect(!r.ok && r.reason).toBe('conflict')
    const rejected = await mutatePayload({ store, uuid }, { id: 'r', client_id: 'c' }, () => '不行', 3)
    expect(!rejected.ok && rejected.reason).toBe('rejected')
    expect(calls()).toBe(1)
  })

  it('withAuth 只合并授权回执字段', () => {
    const out = withAuth({ x: 1, promote_authorization: { status: 'claimed', request_id: 'a' } }, { status: 'consumed' })
    expect(out['x']).toBe(1)
    expect(out['promote_authorization']).toEqual({ status: 'consumed', request_id: 'a' })
  })
})
