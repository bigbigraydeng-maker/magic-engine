/**
 * SSRF 防护测试。
 *
 * 要防的事：有后台权限的人提交一个公开 HTTPS 地址，让它 302 到
 * `http://169.254.169.254/`（云元数据）或内网，服务器替他去访问。
 * 只校验初始 URL 是不够的 —— 每一跳都要重新查。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({ lookup: vi.fn() }))
vi.mock('dns/promises', () => ({ lookup: mocks.lookup, default: { lookup: mocks.lookup } }))

import { isBlockedAddress, safeProbeRemoteFile, safeDownloadRemoteFile } from '../safe-remote-fetch'

/** 假写流：记下写了什么，让测试能断言"写到哪一步就中断了"而不用碰真磁盘。 */
function fakeWriteStream() {
  const chunks: Buffer[] = []
  return {
    chunks,
    write: vi.fn((chunk: Buffer, cb: (err?: Error) => void) => { chunks.push(chunk); cb() }),
    end: vi.fn((cb: (err?: Error) => void) => cb()),
    destroy: vi.fn(),
  }
}
/** 假响应体：按顺序吐出给定的 chunk，模拟 fetch 的 ReadableStream。 */
function fakeBody(chunks: Uint8Array[]) {
  let i = 0
  return {
    getReader: () => ({
      read: vi.fn(async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true, value: undefined })),
    }),
  }
}

const fsMocks = vi.hoisted(() => ({ createWriteStream: vi.fn() }))
vi.mock('node:fs', () => ({ createWriteStream: fsMocks.createWriteStream }))

describe('isBlockedAddress —— 私网/保留段一律拦', () => {
  const blocked = [
    ['云元数据服务', '169.254.169.254'],
    ['链路本地', '169.254.1.1'],
    ['10/8 内网', '10.0.0.1'],
    ['172.16/12 内网', '172.16.5.4'],
    ['172.31 仍在段内', '172.31.255.255'],
    ['192.168 内网', '192.168.1.1'],
    ['环回', '127.0.0.1'],
    ['0.0.0.0/8', '0.0.0.0'],
    ['CGNAT', '100.64.0.1'],
    ['组播', '239.1.1.1'],
    ['IPv6 环回', '::1'],
    ['IPv6 链路本地', 'fe80::1'],
    ['IPv6 唯一本地 fc', 'fc00::1'],
    ['IPv6 唯一本地 fd', 'fd12:3456::1'],
    ['🔴 IPv4-mapped 绕过尝试', '::ffff:169.254.169.254'],
    ['🔴 IPv4-mapped 内网', '::ffff:10.0.0.1'],
    ['解析不出来的垃圾', 'not-an-ip'],
  ] as const
  for (const [name, ip] of blocked) {
    it(`拦：${name} (${ip})`, () => expect(isBlockedAddress(ip)).toBe(true))
  }

  const allowed = [
    ['公网 v4', '8.8.8.8'],
    ['公网 v4 边界', '172.15.0.1'],
    ['公网 v4 边界2', '172.32.0.1'],
    ['公网 v4 类 192', '192.167.1.1'],
    ['公网 v6', '2606:4700:4700::1111'],
  ] as const
  for (const [name, ip] of allowed) {
    it(`放行：${name} (${ip})`, () => expect(isBlockedAddress(ip)).toBe(false))
  }
})

describe('safeProbeRemoteFile —— 逐跳校验', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.lookup.mockResolvedValue([{ address: '8.8.8.8' }])
  })
  afterEach(() => vi.unstubAllGlobals())

  it('非 http(s) 协议直接拒', async () => {
    const r = await safeProbeRemoteFile('file:///etc/passwd')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('协议')
  })

  it('初始域名就解析到内网 → 拒，且一次网络请求都不发', async () => {
    mocks.lookup.mockResolvedValue([{ address: '169.254.169.254' }])
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const r = await safeProbeRemoteFile('https://evil.example/x.mp4')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('内部地址')
    expect(fetchSpy, '判定为内网就不该发请求').not.toHaveBeenCalled()
  })

  it('域名解析出多个地址，只要有一个是内网就拒（防混合解析绕过）', async () => {
    mocks.lookup.mockResolvedValue([{ address: '8.8.8.8' }, { address: '10.0.0.1' }])
    vi.stubGlobal('fetch', vi.fn())
    const r = await safeProbeRemoteFile('https://mixed.example/x.mp4')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('内部地址')
  })

  it('🔴 公网地址 302 跳到内网 → 第二跳被拦（这就是只校验首个 URL 会漏的那种）', async () => {
    mocks.lookup
      .mockResolvedValueOnce([{ address: '8.8.8.8' }])          // 第一跳：公网，放行
      .mockResolvedValueOnce([{ address: '169.254.169.254' }])  // 第二跳：元数据，必须拦
    const fetchSpy = vi.fn().mockResolvedValue({
      status: 302,
      headers: { get: (k: string) => (k === 'location' ? 'http://169.254.169.254/latest/meta-data/' : null) },
    })
    vi.stubGlobal('fetch', fetchSpy)

    const r = await safeProbeRemoteFile('https://ok.example/x.mp4')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('内部地址')
    expect(fetchSpy, '只该发出第一跳，第二跳在校验阶段就被挡下').toHaveBeenCalledTimes(1)
  })

  it('🔴 不许用 redirect:follow —— 必须自己逐跳走', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true, status: 206, headers: { get: () => 'video/mp4' },
    })
    vi.stubGlobal('fetch', fetchSpy)
    await safeProbeRemoteFile('https://ok.example/x.mp4')
    expect(fetchSpy.mock.calls[0][1].redirect).toBe('manual')
  })

  it('跳转次数过多 → 拒', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      status: 302,
      headers: { get: (k: string) => (k === 'location' ? 'https://ok.example/again' : null) },
    })
    vi.stubGlobal('fetch', fetchSpy)
    const r = await safeProbeRemoteFile('https://ok.example/x.mp4')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('跳转太多次')
  })

  it('正常公网视频 → 通过，带回 content-type', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 206, headers: { get: () => 'video/mp4' },
    }))
    const r = await safeProbeRemoteFile('https://ok.example/x.mp4')
    expect(r.ok).toBe(true)
    expect(r.contentType).toBe('video/mp4')
  })

  it('相对跳转也能解，且新地址照样校验', async () => {
    mocks.lookup
      .mockResolvedValueOnce([{ address: '8.8.8.8' }])
      .mockResolvedValueOnce([{ address: '8.8.8.8' }])
    let call = 0
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
      call++
      return call === 1
        ? { status: 302, headers: { get: (k: string) => (k === 'location' ? '/moved.mp4' : null) } }
        : { ok: true, status: 206, headers: { get: () => 'video/mp4' } }
    }))
    const r = await safeProbeRemoteFile('https://ok.example/x.mp4')
    expect(r.ok).toBe(true)
    expect(r.finalUrl).toBe('https://ok.example/moved.mp4')
  })
})

describe('safeDownloadRemoteFile —— 下载也走逐跳校验(不是只探活)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.lookup.mockResolvedValue([{ address: '8.8.8.8' }])
    fsMocks.createWriteStream.mockImplementation(() => fakeWriteStream())
  })
  afterEach(() => vi.unstubAllGlobals())

  it('🔴 提交时探活是公网，真下载时同一个域名解析变成内网 → 拦下(TOCTOU，Codex 复审的原话场景)', async () => {
    // 探活和下载是两次独立请求，中间可能过了几分钟(排队等 worker)，
    // 攻击者用短 TTL DNS 在这个窗口把域名从公网地址换成内网地址。
    mocks.lookup.mockResolvedValue([{ address: '169.254.169.254' }]) // 下载这一刻已经是内网了
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const r = await safeDownloadRemoteFile('https://was-public-at-submit-time.example/x.mp4', '/tmp/out.mp4')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('内部地址')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(fsMocks.createWriteStream, '校验没过就不该碰文件系统').not.toHaveBeenCalled()
  })

  it('🔴 公网地址 302 到内网 → 下载阶段照样拦(不是只有探活会拦)', async () => {
    mocks.lookup
      .mockResolvedValueOnce([{ address: '8.8.8.8' }])
      .mockResolvedValueOnce([{ address: '169.254.169.254' }])
    const fetchSpy = vi.fn().mockResolvedValue({
      status: 302,
      headers: { get: (k: string) => (k === 'location' ? 'http://169.254.169.254/latest/meta-data/' : null) },
    })
    vi.stubGlobal('fetch', fetchSpy)
    const r = await safeDownloadRemoteFile('https://ok.example/x.mp4', '/tmp/out.mp4')
    expect(r.ok).toBe(false)
    expect(fsMocks.createWriteStream).not.toHaveBeenCalled()
  })

  it('🔴 不许用 redirect:follow —— 下载函数也必须自己逐跳走', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: { get: () => 'video/mp4' }, body: fakeBody([]),
    })
    vi.stubGlobal('fetch', fetchSpy)
    await safeDownloadRemoteFile('https://ok.example/x.mp4', '/tmp/out.mp4')
    expect(fetchSpy.mock.calls[0][1].redirect).toBe('manual')
  })

  it('正常公网文件 → 真的写盘', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: { get: () => 'video/mp4' }, body: fakeBody([Buffer.from('hello')]),
    }))
    const r = await safeDownloadRemoteFile('https://ok.example/x.mp4', '/tmp/out.mp4')
    expect(r.ok).toBe(true)
    expect(fsMocks.createWriteStream).toHaveBeenCalledWith('/tmp/out.mp4')
  })

  it('响应没有 body → 报错，不假装成功', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, headers: { get: () => null }, body: null }))
    const r = await safeDownloadRemoteFile('https://ok.example/x.mp4', '/tmp/out.mp4')
    expect(r.ok).toBe(false)
  })

  it('🔴 累计字节数超过硬上限 → 立刻中断，不把整个文件写完(Codex 复审：不能只信 Content-Length)', async () => {
    // 传一个很小的 maxBytes 模拟"文件比声称的大得多"或"响应根本没完没了"。
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: { get: () => 'video/mp4' },
      body: fakeBody([Buffer.alloc(8), Buffer.alloc(8)]), // 第二块进来就累计到 16，超过下面的 10
    }))
    const r = await safeDownloadRemoteFile('https://ok.example/huge.mp4', '/tmp/out.mp4', 20000, 10)
    expect(r.ok).toBe(false)
    expect(r.error).toContain('上限')
  })

  it('🔴 超限时销毁写流、不留半个文件假装写完(end 不该被调用)', async () => {
    const ws = fakeWriteStream()
    fsMocks.createWriteStream.mockReturnValue(ws)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: { get: () => 'video/mp4' },
      body: fakeBody([Buffer.alloc(20)]),
    }))
    const r = await safeDownloadRemoteFile('https://ok.example/huge.mp4', '/tmp/out.mp4', 20000, 10)
    expect(r.ok).toBe(false)
    expect(ws.destroy).toHaveBeenCalled()
    expect(ws.end, '中途中断不该走到正常收尾').not.toHaveBeenCalled()
  })

  it('没超限的正常大小文件 → 每个 chunk 都实际写进流里', async () => {
    const ws = fakeWriteStream()
    fsMocks.createWriteStream.mockReturnValue(ws)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: { get: () => 'video/mp4' },
      body: fakeBody([Buffer.from('ab'), Buffer.from('cd')]),
    }))
    const r = await safeDownloadRemoteFile('https://ok.example/x.mp4', '/tmp/out.mp4', 20000, 100)
    expect(r.ok).toBe(true)
    expect(ws.chunks.map((c) => c.toString())).toEqual(['ab', 'cd'])
    expect(ws.end).toHaveBeenCalled()
  })
})
