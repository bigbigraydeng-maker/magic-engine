/**
 * 素材抓取管道测试 —— 覆盖对抗审查(2026-07-25)点名的三条:
 * ① 先查后下:重复跑不该把同一批图重下重传(cron 每天跑同一搜索词会大量命中同图)
 * ② 下载防护:非图片内容 / 超大文件 / 超时,不能进桶(进了 i2v 会失败)
 * ③ 并发上限:不能把整批大图同时读进内存
 *
 * 这些是 IO 编排,用注入的 fetch/storage 替身测,不打真网络。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HarvestedImage } from './stock-harvest'

// ── supabase 替身 ────────────────────────────────────────────────────────────
const state = {
  existingRows: [] as { storage_url: string }[],
  bucketObjects: [] as { name: string }[],
  uploaded: [] as string[],
  inserted: [] as Record<string, unknown>[],
  uploadError: null as { message: string } | null,
}

vi.mock('@/lib/supabase', () => {
  const table = () => {
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'in', 'or', 'order', 'limit', 'maybeSingle']) {
      q[m] = () => q
    }
    q.insert = (rows: Record<string, unknown>[]) => {
      state.inserted.push(...rows)
      return Promise.resolve({ error: null })
    }
    ;(q as { then: unknown }).then = (res: (r: unknown) => unknown) =>
      res({ data: state.existingRows, error: null })
    return q
  }
  return {
    supabaseAdmin: {
      from: () => table(),
      storage: {
        from: () => ({
          upload: (path: string) => {
            if (state.uploadError) return Promise.resolve({ error: state.uploadError })
            state.uploaded.push(path)
            return Promise.resolve({ error: null })
          },
          list: () => Promise.resolve({ data: state.bucketObjects, error: null }),
        }),
      },
    },
  }
})

import { ingestHarvestedImages } from './stock-pipeline'

const img = (u: string): HarvestedImage => ({
  url: u, width: 800, height: 1280, saves: 500,
  title: 't', dominantColor: null, aspectRatio: 1.6,
})

/** 可控 fetch 替身 */
function mockFetch(opts: { contentType?: string; bytes?: number; status?: number } = {}) {
  const { contentType = 'image/jpeg', bytes = 1024, status = 200 } = opts
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => (k === 'content-type' ? contentType : null) },
    arrayBuffer: async () => new ArrayBuffer(bytes),
  })) as unknown as typeof fetch
}

beforeEach(() => {
  state.existingRows = []
  state.bucketObjects = []
  state.uploaded = []
  state.inserted = []
  state.uploadError = null
})

describe('🔴 先查后下 —— 重复跑不该重下重传', () => {
  it('库里有行且桶里有对象 → 完全不下载', async () => {
    // 先跑一次拿到真实 path
    global.fetch = mockFetch()
    await ingestHarvestedImages('c-1', [img('https://x/a.jpg')], 'q')
    const path = state.uploaded[0]
    expect(path).toBeTruthy()

    // 第二次:模拟「已入库 + 桶里在」
    state.existingRows = [{ storage_url: path }]
    state.bucketObjects = [{ name: path.split('/').pop()! }]
    state.uploaded = []
    state.inserted = []
    const spy = mockFetch()
    global.fetch = spy

    const r = await ingestHarvestedImages('c-1', [img('https://x/a.jpg')], 'q')
    expect(spy).not.toHaveBeenCalled()      // 关键:一次网络都没打
    expect(state.uploaded).toHaveLength(0)  // 没重传
    expect(r.ingested).toBe(0)              // 也没重插
  })

  it('🔴 库里有行但桶里对象没了 → 要重新上传(否则留悬空行,i2v 拿到 404)', async () => {
    global.fetch = mockFetch()
    await ingestHarvestedImages('c-1', [img('https://x/b.jpg')], 'q')
    const path = state.uploaded[0]

    state.existingRows = [{ storage_url: path }]
    state.bucketObjects = []          // 桶被清空
    state.uploaded = []
    state.inserted = []
    global.fetch = mockFetch()

    await ingestHarvestedImages('c-1', [img('https://x/b.jpg')], 'q')
    expect(state.uploaded).toContain(path) // 重新补回对象
    expect(state.inserted).toHaveLength(0) // 但不重复插行
  })
})

describe('🔴 下载防护 —— 坏内容不能进桶', () => {
  it('HTTP 200 但返回 HTML 错误页 → 拒(存进去 i2v 必失败)', async () => {
    global.fetch = mockFetch({ contentType: 'text/html' })
    const r = await ingestHarvestedImages('c-1', [img('https://x/c.jpg')], 'q')
    expect(state.uploaded).toHaveLength(0)
    expect(r.ingested).toBe(0)
    expect(r.errors.join()).toMatch(/非图片/)
  })

  it('超大文件 → 拒', async () => {
    global.fetch = mockFetch({ bytes: 20 * 1024 * 1024 })
    const r = await ingestHarvestedImages('c-1', [img('https://x/d.jpg')], 'q')
    expect(state.uploaded).toHaveLength(0)
    expect(r.errors.join()).toMatch(/太大/)
  })

  it('空文件 → 拒', async () => {
    global.fetch = mockFetch({ bytes: 0 })
    const r = await ingestHarvestedImages('c-1', [img('https://x/e.jpg')], 'q')
    expect(state.uploaded).toHaveLength(0)
    expect(r.errors.join()).toMatch(/空文件/)
  })

  it('下载失败(403)→ 记错但不炸,其他张照常', async () => {
    let n = 0
    global.fetch = vi.fn(async () => {
      n += 1
      const bad = n === 1
      return {
        ok: !bad, status: bad ? 403 : 200,
        headers: { get: () => 'image/jpeg' },
        arrayBuffer: async () => new ArrayBuffer(1024),
      }
    }) as unknown as typeof fetch

    const r = await ingestHarvestedImages('c-1', [img('https://x/f.jpg'), img('https://x/g.jpg')], 'q')
    expect(r.errors).toHaveLength(1)
    expect(r.ingested).toBe(1) // 另一张成功
  })

  it('上传失败 → 该张跳过,不入库(绝不留只有行没有对象的状态)', async () => {
    global.fetch = mockFetch()
    state.uploadError = { message: 'bucket full' }
    const r = await ingestHarvestedImages('c-1', [img('https://x/h.jpg')], 'q')
    expect(r.ingested).toBe(0)
    expect(state.inserted).toHaveLength(0)
  })
})

describe('入库产物', () => {
  it('落库行带红线标记(静图 / 非真拍 / b_generated)', async () => {
    global.fetch = mockFetch()
    await ingestHarvestedImages('c-1', [img('https://x/i.jpg')], 'q')
    const row = state.inserted[0] as { track: string; source_meta: Record<string, unknown> }
    expect(row.track).toBe('b_generated')
    expect(row.source_meta.is_still_image).toBe(true)
    expect(row.source_meta.is_real_footage).toBe(false)
  })

  it('🔴 max 有硬上限,调用方传大数也不越界', async () => {
    global.fetch = mockFetch()
    const many = Array.from({ length: 100 }, (_, i) => img(`https://x/m${i}.jpg`))
    await ingestHarvestedImages('c-1', many, 'q', { max: 999 })
    expect(state.uploaded.length).toBeLessThanOrEqual(30) // HARD_MAX
  })

  it('同一 URL → 同一 storage path(哈希稳定,天然幂等)', async () => {
    global.fetch = mockFetch()
    await ingestHarvestedImages('c-1', [img('https://x/same.jpg')], 'q')
    const p1 = state.uploaded[0]
    state.uploaded = []; state.inserted = []; state.existingRows = []
    global.fetch = mockFetch()
    await ingestHarvestedImages('c-1', [img('https://x/same.jpg')], 'q')
    expect(state.uploaded[0]).toBe(p1)
  })
})
