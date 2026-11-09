/**
 * 触点 metadata 的「带前提条件的合并写」：别人同时写进去的键不能被冲掉。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeFakeTouchpointDb } from './fake-touchpoint-db'

const holder = vi.hoisted(() => ({ db: null as null | { from: () => unknown } }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: () => holder.db!.from() } }))

import { mergeTouchpointMetadata } from '../touchpoint-metadata'

const base = () => [{ id: 'tp-1', client_id: 'c-1', metadata: { outcome: 'spoke', call_analysis_id: 'an-1' } }]
const addStance = () => ({ call_stance: 'not_now' })

describe('mergeTouchpointMetadata', () => {
  let fake: ReturnType<typeof makeFakeTouchpointDb>
  beforeEach(() => {
    fake = makeFakeTouchpointDb(base())
    holder.db = fake
  })

  it('一次写上：原有键保留、新键加上，写的时候带着「还是刚才那份」的前提', async () => {
    const r = await mergeTouchpointMetadata({ touchpointId: 'tp-1', clientId: 'c-1', decide: addStance })
    expect(r).toBe('written')
    expect(fake.rows[0].metadata).toEqual({ outcome: 'spoke', call_analysis_id: 'an-1', call_stance: 'not_now' })
    expect(JSON.parse(fake.guards[0])).toEqual({ outcome: 'spoke', call_analysis_id: 'an-1' })
  })

  it('中途有人改了 metadata → 第一次没写上，重读后重试一次写上，别人的改动保住', async () => {
    fake = makeFakeTouchpointDb(base(), { interfere: 1 })
    holder.db = fake
    const r = await mergeTouchpointMetadata({ touchpointId: 'tp-1', clientId: 'c-1', decide: addStance })
    expect(r).toBe('written')
    expect(fake.guards).toHaveLength(2)
    expect(fake.rows[0].metadata).toMatchObject({ other_writer: 1, call_stance: 'not_now', outcome: 'spoke' })
  })

  it('两次都被抢先 → 放弃（conflict），不硬写、不冲掉别人的', async () => {
    fake = makeFakeTouchpointDb(base(), { interfere: 5 })
    holder.db = fake
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const r = await mergeTouchpointMetadata({ touchpointId: 'tp-1', clientId: 'c-1', decide: addStance })
    expect(r).toBe('conflict')
    expect(fake.guards).toHaveLength(2)
    expect(fake.rows[0].metadata.call_stance).toBeUndefined()
    expect(fake.rows[0].metadata.other_writer).toBe(2)
    warn.mockRestore()
  })

  it('decide 返回 null → 不写', async () => {
    const r = await mergeTouchpointMetadata({ touchpointId: 'tp-1', clientId: 'c-1', decide: () => null })
    expect(r).toBe('skipped')
    expect(fake.updates).toHaveLength(0)
  })

  it('触点不属于这个客户 → missing，不写', async () => {
    const r = await mergeTouchpointMetadata({ touchpointId: 'tp-1', clientId: 'other', decide: addStance })
    expect(r).toBe('missing')
    expect(fake.updates).toHaveLength(0)
  })
})
