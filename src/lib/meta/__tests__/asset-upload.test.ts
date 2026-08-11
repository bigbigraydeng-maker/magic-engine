/**
 * 传素材到 Meta。
 *
 * 这个模块存在的唯一理由是：在它之前，建广告那条线直接收调用方给的
 * `imageHash`，全程不碰 client_assets —— 那道「素材必须属于这套房」的闸门
 * 因此形同虚设（子牙 2026-08-05 复审）。有了它，服务端才有能力自己换 id。
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { uploadImageToMeta, uploadVideoToMeta, uploadAssetToMeta } from '../asset-upload'

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
