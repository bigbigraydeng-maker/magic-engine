/**
 * writeThreeBooks 草稿 vs 已发布 三落库测试。
 *
 * 草稿上传(视频已上传但未公开)与真正发布走的是同一条三落库路径,但语义不同:
 * - 草稿:不产生 execution_items(没有「已完成」的交付物),flywheel 行标记 DRAFT,
 *   work log 必须说清「草稿已上传 / 未公开」,不能谎称「已发到」。
 * - 已发布:execution_items 落一条 completed,flywheel 行标记 PUBLISHED 并挂上
 *   execution_item_id,work log 说「已发到 meta_graph」。
 *
 * 这里直接调用导出的 writeThreeBooks,断言三张表各自的 payload —— 证明分支真的接上了,
 * 而不是只测了一个纯函数。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('./facebook-reel-adapter', () => ({
  facebookReelAdapter: {
    publish: vi.fn(),
    findExisting: vi.fn(async () => null),
  },
}))

import { writeThreeBooks } from './publish-worker'
import { supabaseAdmin } from '@/lib/supabase'
import type { PublishedRef } from '@/lib/factory/types'

const mockFrom = vi.mocked(supabaseAdmin.from)

const CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'
const WO_ID = 'wo-1'
const ANGLE = 'Alpine tour'

const baseRef: PublishedRef = {
  platform: 'facebook',
  page_id: 'pg1',
  post_id: 'p1',
  video_id: 'v1',
  published_at: '2026-10-18T00:00:00Z',
  permalink: 'https://fb/p1',
}

interface InsertRecord {
  table: string
  payload: Record<string, unknown>
}

let inserts: InsertRecord[]

function installMocks() {
  inserts = []

  mockFrom.mockImplementation((table: string) => {
    const builder: Record<string, unknown> = {}
    for (const m of ['eq', 'or', 'order', 'limit', 'maybeSingle', 'single']) {
      builder[m] = () => builder
    }
    builder.select = () => builder
    builder.insert = (payload: Record<string, unknown>) => {
      inserts.push({ table, payload })
      return builder
    }
    ;(builder as { then: unknown }).then = (
      resolve: (v: { data: { id: string }; error: null }) => unknown,
    ) => resolve({ data: { id: 'exec-1' }, error: null })
    return builder as never
  })
}

const findInsert = (table: string): InsertRecord | undefined =>
  inserts.find((i) => i.table === table)

const findInserts = (table: string): InsertRecord[] =>
  inserts.filter((i) => i.table === table)

beforeEach(() => {
  vi.clearAllMocks()
  installMocks()
})

describe('writeThreeBooks draft vs published', () => {
  it('DRAFT: no execution_items, flywheel marked DRAFT, work log says draft not published', async () => {
    await writeThreeBooks(WO_ID, { ...baseRef, video_state: 'DRAFT' }, CLIENT_ID, ANGLE)

    expect(findInserts('execution_items')).toHaveLength(0)

    const flywheel = findInserts('flywheel_actions')
    expect(flywheel).toHaveLength(1)
    const fw = flywheel[0].payload
    expect(fw.action_type).toBe('factory_reel_publish')
    expect(fw.execution_item_id).toBeNull()
    expect(fw.flywheel).toBe('social')
    expect(fw.expected_metric).toBe('reel_plays')
    expect(fw.vendor).toBe('meta_graph')
    expect(fw.execution_mode).toBe('in_house')
    const fwPayload = fw.payload as Record<string, unknown>
    expect(fwPayload.video_state).toBe('DRAFT')
    expect(fwPayload.work_order_id).toBe(WO_ID)

    const logs = findInserts('fde_work_logs')
    expect(logs).toHaveLength(1)
    const summary = String(logs[0].payload.summary)
    expect(summary).toContain('草稿已上传')
    expect(summary).toContain('未公开')
    expect(summary).not.toContain('已发到')
  })

  it('PUBLISHED: execution_items completed, flywheel linked, work log says published', async () => {
    await writeThreeBooks(WO_ID, { ...baseRef, video_state: 'PUBLISHED' }, CLIENT_ID, ANGLE)

    const exec = findInserts('execution_items')
    expect(exec).toHaveLength(1)
    expect(exec[0].payload.status).toBe('completed')
    expect(String(exec[0].payload.title)).toContain('工厂自动发布 Reel')

    const flywheel = findInserts('flywheel_actions')
    expect(flywheel).toHaveLength(1)
    const fw = flywheel[0].payload
    expect(fw.execution_item_id).toBe('exec-1')
    const fwPayload = fw.payload as Record<string, unknown>
    expect(fwPayload.video_state).toBe('PUBLISHED')

    const logs = findInserts('fde_work_logs')
    expect(logs).toHaveLength(1)
    const summary = String(logs[0].payload.summary)
    expect(summary).toContain('已发到 meta_graph')
    expect(summary).not.toContain('草稿')
  })

  it('undefined video_state (legacy/recovered ref) behaves like PUBLISHED', async () => {
    await writeThreeBooks(WO_ID, baseRef, CLIENT_ID, ANGLE)

    const exec = findInserts('execution_items')
    expect(exec).toHaveLength(1)
    expect(exec[0].payload.status).toBe('completed')

    const logs = findInserts('fde_work_logs')
    expect(logs).toHaveLength(1)
    expect(String(logs[0].payload.summary)).toContain('已发到')
  })

  it('flywheel row shape is identical apart from execution_item_id and video_state', async () => {
    await writeThreeBooks(WO_ID, { ...baseRef, video_state: 'DRAFT' }, CLIENT_ID, ANGLE)
    const draftFw = findInsert('flywheel_actions')!.payload

    installMocks()
    await writeThreeBooks(WO_ID, { ...baseRef, video_state: 'PUBLISHED' }, CLIENT_ID, ANGLE)
    const publishedFw = findInsert('flywheel_actions')!.payload

    expect(Object.keys(draftFw).sort()).toEqual(Object.keys(publishedFw).sort())
  })
})
