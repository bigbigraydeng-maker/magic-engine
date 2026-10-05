/**
 * 传素材到 Meta。
 *
 * 这个模块存在的唯一理由是：在它之前，建广告那条线直接收调用方给的
 * `imageHash`，全程不碰 client_assets —— 那道「素材必须属于这套房」的闸门
 * 因此形同虚设（子牙 2026-08-05 复审）。有了它，服务端才有能力自己换 id。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { uploadImageToMeta, uploadVideoToMeta, uploadAssetToMeta, waitForVideoReady } from '../asset-upload'

afterEach(() => vi.unstubAllGlobals())

/** url → 该次 fetch 的返回。第一次调用取素材，第二次调 Graph。 */
function stub(handler: (url: string, init?: RequestInit) => Partial<Response> & { _body?: string }) {
  const calls: { url: string; init?: RequestInit }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      const r = handler(url, init)
      return {
        ok: r.ok ?? true,
        status: r.status ?? 200,
        text: async () => r._body ?? '',
        arrayBuffer: async () => new ArrayBuffer(1024),
      } as Response
    }),
  )
  return calls
}

describe('uploadImageToMeta', () => {
  it('传成功 → 返回 hash', async () => {
    stub((url) =>
      url.includes('/adimages')
        ? { _body: JSON.stringify({ images: { 'a.jpg': { hash: 'HASH123', url: 'x' } } }) }
        : {},
    )
    const r = await uploadImageToMeta('act_1', 'https://s/a.jpg', 'tok', 'a.jpg')
    expect(r).toEqual({ ok: true, asset: { kind: 'image', hash: 'HASH123' } })
  })

  it('🔴 Meta 改了回执里的文件名也要拿得到 hash', async () => {
    // 实测 Meta 会去扩展名 / 加后缀。按文件名取会静默拿到 undefined，
    // 然后建出一条**没有图**的广告 —— 而且看起来完全成功。
    stub((url) =>
      url.includes('/adimages')
        ? { _body: JSON.stringify({ images: { 'a_renamed_by_meta': { hash: 'H9' } } }) }
        : {},
    )
    const r = await uploadImageToMeta('act_1', 'https://s/a.jpg', 'tok', 'a.jpg')
    expect(r).toEqual({ ok: true, asset: { kind: 'image', hash: 'H9' } })
  })

  it('回执里没有 hash → 失败，不返回空 hash', async () => {
    stub((url) => (url.includes('/adimages') ? { _body: JSON.stringify({ images: {} }) } : {}))
    const r = await uploadImageToMeta('act_1', 'https://s/a.jpg', 'tok')
    expect(r.ok).toBe(false)
  })

  it('取素材 404 → 失败，且说清是取素材失败不是 Meta 拒收', async () => {
    stub((url) => (url.includes('/adimages') ? {} : { ok: false, status: 404 }))
    const r = await uploadImageToMeta('act_1', 'https://s/gone.jpg', 'tok')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('取素材失败')
  })

  it('Meta 拒收 → 带上它的原话，别让人猜', async () => {
    stub((url) =>
      url.includes('/adimages')
        ? { ok: false, status: 400, _body: '{"error":{"message":"Invalid image"}}' }
        : {},
    )
    const r = await uploadImageToMeta('act_1', 'https://s/a.jpg', 'tok')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('Invalid image')
  })

  it('空文件 → 不往 Meta 传', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, text: async () => '', arrayBuffer: async () => new ArrayBuffer(0),
    } as Response)))
    const r = await uploadImageToMeta('act_1', 'https://s/empty.jpg', 'tok')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('空')
  })

  it('超大图 → 明说超了多少，别丢一个 Meta 的天书错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, text: async () => '',
      arrayBuffer: async () => new ArrayBuffer(40 * 1024 * 1024),
    } as Response)))
    const r = await uploadImageToMeta('act_1', 'https://s/big.jpg', 'tok')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toContain('MB')
  })
})

describe('uploadVideoToMeta', () => {
  it('走 file_url 让 Meta 自己拉 —— 不把几十 MB 过一遍我们的进程', async () => {
    const calls = stub(() => ({ _body: JSON.stringify({ id: 'V1' }) }))
    const r = await uploadVideoToMeta('act_1', 'https://s/v.mp4', 'tok', '片名')
    expect(r).toEqual({ ok: true, asset: { kind: 'video', videoId: 'V1' } })
    expect(calls).toHaveLength(1) // 没有先下载那一次
    expect(String(calls[0].init?.body)).toContain('file_url')
  })

  it('回执里没有 id → 失败', async () => {
    stub(() => ({ _body: '{}' }))
    expect((await uploadVideoToMeta('act_1', 'https://s/v.mp4', 'tok')).ok).toBe(false)
  })
})

describe('uploadAssetToMeta — 按 mime 分流，不按文件名', () => {
  it('mime 是视频 → 走视频那条（哪怕文件名像图片）', async () => {
    const calls = stub(() => ({ _body: JSON.stringify({ id: 'V2' }) }))
    const r = await uploadAssetToMeta(
      'act_1', { storageUrl: 'https://s/x.jpg', mimeType: 'video/mp4' }, 'tok',
    )
    expect(r).toEqual({ ok: true, asset: { kind: 'video', videoId: 'V2' } })
    expect(calls[0].url).toContain('/advideos')
  })

  it('mime 是图片 → 走图片那条（哪怕文件名像视频）', async () => {
    const calls = stub((url) =>
      url.includes('/adimages') ? { _body: JSON.stringify({ images: { a: { hash: 'H' } } }) } : {},
    )
    await uploadAssetToMeta('act_1', { storageUrl: 'https://s/x.mp4', mimeType: 'image/jpeg' }, 'tok')
    expect(calls.some((c) => c.url.includes('/adimages'))).toBe(true)
  })

  it('mime 缺失 → 当图片处理（宁可少当视频用）', async () => {
    const calls = stub((url) =>
      url.includes('/adimages') ? { _body: JSON.stringify({ images: { a: { hash: 'H' } } }) } : {},
    )
    await uploadAssetToMeta('act_1', { storageUrl: 'https://s/x', mimeType: null }, 'tok')
    expect(calls.some((c) => c.url.includes('/adimages'))).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// waitForVideoReady —— 上传完还要转码，转码没完就建广告会失败
// ─────────────────────────────────────────────────────────────────────────────

type Step = { status?: number; json?: unknown; text?: string; throws?: boolean }

/** 假时钟 + 按顺序给的假回执：sleep 会让时间往前走，不用真等。 */
function waitHarness(steps: Record<string, Step[]> | Step[]) {
  let t = 0
  const sleeps: number[] = []
  const urls: string[] = []
  const queue = new Map<string, Step[]>()
  const fallback = Array.isArray(steps) ? steps : null
  if (!Array.isArray(steps)) for (const [k, v] of Object.entries(steps)) queue.set(k, [...v])
  let flat = fallback ? [...fallback] : []

  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(url)
    const id = url.split('/').pop()!.split('?')[0]
    const list = fallback ? flat : queue.get(id) ?? []
    const step = list.length > 1 ? list.shift()! : list[0] // 最后一条重复使用
    if (!step) throw new Error('没有给这个视频准备回执')
    if (step.throws) throw new Error('network down')
    const status = step.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => step.text ?? JSON.stringify(step.json ?? {}),
    } as Response
  }))
  void flat
  return {
    urls, sleeps,
    opts: {
      intervalMs: 4_000, timeoutMs: 20_000,
      now: () => t,
      sleep: async (ms: number) => { sleeps.push(ms); t += ms },
    },
    elapsed: () => t,
  }
}

const READY = { json: { status: { video_status: 'ready' } } }
const PROCESSING = { json: { status: { video_status: 'processing' } } }
const apiError = (httpStatus: number, code: number, extra: object = {}) => ({
  status: httpStatus, json: { error: { code, message: 'm', ...extra } },
})

describe('waitForVideoReady', () => {
  it('一上来就好了 → 通过，不用睡', async () => {
    const h = waitHarness([READY])
    expect(await waitForVideoReady(['v1'], 'tok', h.opts)).toEqual({ ok: true })
    expect(h.sleeps).toEqual([])
    expect(h.urls[0]).toContain('/v1?')
    expect(h.urls[0]).toContain('fields=status')
  })

  it('先在处理中，后来好了 → 通过，中间睡了一次', async () => {
    const h = waitHarness([PROCESSING, READY])
    expect(await waitForVideoReady(['v1'], 'tok', h.opts)).toEqual({ ok: true })
    expect(h.sleeps).toEqual([4_000])
  })

  it('一直在处理 → 超时失败，文案如实说「广告没建」，不假装好了', async () => {
    const h = waitHarness([PROCESSING])
    const r = await waitForVideoReady(['v1'], 'tok', h.opts)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('timeout')
    expect(r.error).toContain('广告没建')
    expect(r.error).toContain('v1')
    expect(h.elapsed()).toBeLessThanOrEqual(20_000)
  })

  it('状态字段缺失 / 没见过的值 → 当「还没好」继续等，不当好了', async () => {
    for (const body of [{ json: {} }, { json: { status: {} } }, { json: { status: { video_status: 'mystery' } } }]) {
      const h = waitHarness([body])
      const r = await waitForVideoReady(['v1'], 'tok', h.opts)
      expect(r.ok, JSON.stringify(body)).toBe(false)
      if (!r.ok) expect(r.reason).toBe('timeout')
    }
  })

  it('Meta 报转码失败(error) → 立刻失败，不白等', async () => {
    const h = waitHarness([{ json: { status: { video_status: 'error' } } }])
    const r = await waitForVideoReady(['v1'], 'tok', h.opts)
    expect(r).toEqual({ ok: false, reason: 'video_error', error: expect.stringContaining('转码失败') })
    expect(h.sleeps).toEqual([])
  })

  it('限流常常是 HTTP 400 不是 429：按 error.code 判 → 继续等，不当致命错误', async () => {
    for (const code of [4, 17, 32, 341, 613, 80004]) {
      const h = waitHarness([apiError(400, code), READY])
      expect(await waitForVideoReady(['v1'], 'tok', h.opts), `code ${code}`).toEqual({ ok: true })
    }
  })

  it('is_transient=true / HTTP 429 / HTTP 5xx → 继续等', async () => {
    for (const first of [apiError(400, 99, { is_transient: true }), { status: 429, text: 'slow down' }, { status: 503, text: 'oops' }]) {
      const h = waitHarness([first, READY])
      expect(await waitForVideoReady(['v1'], 'tok', h.opts)).toEqual({ ok: true })
    }
  })

  it('非临时性的 4xx(视频不存在 / 无权限) → 立刻失败，只问一次', async () => {
    const h = waitHarness([apiError(400, 100)])
    const r = await waitForVideoReady(['v1'], 'tok', h.opts)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('fatal')
    expect(h.urls).toHaveLength(1)
  })

  it('响应体不是 JSON 的 4xx(分类不了) → 立刻失败', async () => {
    const h = waitHarness([{ status: 403, text: '<html>forbidden</html>' }])
    const r = await waitForVideoReady(['v1'], 'tok', h.opts)
    expect(r.ok).toBe(false)
    expect(h.urls).toHaveLength(1)
  })

  it('授权失效(code 190) → 立刻失败，并说清楚是授权的事', async () => {
    const h = waitHarness([apiError(400, 190, { type: 'OAuthException' })])
    const r = await waitForVideoReady(['v1'], 'tok', h.opts)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('授权')
  })

  it('网络抖动 / 请求超时 → 继续等', async () => {
    const h = waitHarness([{ throws: true }, READY])
    expect(await waitForVideoReady(['v1'], 'tok', h.opts)).toEqual({ ok: true })
  })

  it('多条视频共用一个总期限，不是每条各一份', async () => {
    const h = waitHarness({ v1: [READY], v2: [PROCESSING] })
    const r = await waitForVideoReady(['v1', 'v2'], 'tok', h.opts)
    expect(r.ok).toBe(false)
    expect(h.elapsed()).toBeLessThanOrEqual(20_000)
    // 好了的视频不再重复问
    expect(h.urls.filter((u) => u.includes('/v1?'))).toHaveLength(1)
  })

  it('同一个视频号重复出现只问一次', async () => {
    const h = waitHarness([READY])
    expect(await waitForVideoReady(['v1', 'v1'], 'tok', h.opts)).toEqual({ ok: true })
    expect(h.urls).toHaveLength(1)
  })

  it('没有视频号 → 立刻失败，不发请求', async () => {
    const h = waitHarness([READY])
    const r = await waitForVideoReady([''], 'tok', h.opts)
    expect(r.ok).toBe(false)
    expect(h.urls).toHaveLength(0)
  })

  it('同一轮里所有没好的视频同时查（串行的话 4 条各卡 15 秒，一轮就是 60 秒）', async () => {
    let inFlight = 0
    let peak = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return { ok: true, status: 200, text: async () => JSON.stringify({ status: { video_status: 'ready' } }) } as Response
    }))
    expect(await waitForVideoReady(['a', 'b', 'c', 'd'], 'tok')).toEqual({ ok: true })
    expect(peak).toBe(4)
  })

  it('单次查询的超时随剩余期限收紧，但不低于 1 秒', async () => {
    const h = waitHarness([PROCESSING])
    await waitForVideoReady(['v1'], 'tok', { ...h.opts, timeoutMs: 3_000, requestTimeoutMs: 15_000 })
    const spy = vi.spyOn(AbortSignal, 'timeout')
    const h2 = waitHarness([READY])
    await waitForVideoReady(['v1'], 'tok', { ...h2.opts, timeoutMs: 3_000, requestTimeoutMs: 15_000 })
    expect(spy).toHaveBeenCalledWith(3_000)
    spy.mockRestore()
  })

  it('异常配置不会变成热循环：timeoutMs=NaN 回到默认 25 秒；intervalMs=0 回到默认(不连着打 Graph)', async () => {
    const h = waitHarness([PROCESSING])
    const r = await waitForVideoReady(['v1'], 'tok', { ...h.opts, timeoutMs: NaN, intervalMs: 0 })
    expect(r.ok).toBe(false)
    expect(h.elapsed()).toBeLessThanOrEqual(25_000 + 4_000)
    expect(h.sleeps.every((ms) => ms >= 500)).toBe(true)
    expect(h.urls.length).toBeLessThan(20)
  })

  it('每次查询都带超时信号', async () => {
    const h = waitHarness([READY])
    await waitForVideoReady(['v1'], 'tok', h.opts)
    const init = (vi.mocked(fetch).mock.calls[0] as [string, RequestInit])[1]
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
})
