import { describe, expect, it, vi } from 'vitest'
import {
  MAX_REDIRECTS,
  extractPixelIds,
  isProbeUrlAllowed,
  probeLanding,
  utmPreserved,
} from '../landing-probe'
import { RETRY_DELAY_MS } from '../retry'

/** 测试里不真等：失败重试前的等待直接略过。 */
const noSleep = async (): Promise<void> => undefined

// 全部用虚构的域名和编号：平台通用代码的测试里不许出现真实客户的域名 / 编号。
const SITE = 'https://www.example-shop.test'
const PX1 = '2000000000000001'
const PX2 = '2000000000000002'
const PX3 = '2000000000000003'

describe('extractPixelIds · 页面 HTML 里的 Meta 像素编号', () => {
  it('noscript 图片写法（& 原样）', () => {
    const html = `<noscript><img height="1" width="1" src="https://www.facebook.com/tr?id=${PX1}&ev=PageView&noscript=1"/></noscript>`
    expect(extractPixelIds(html)).toEqual([PX1])
  })

  it('noscript 图片写法（&amp; 转义）', () => {
    const html = `<img src="https://www.facebook.com/tr?id=${PX1}&amp;ev=PageView&amp;noscript=1">`
    expect(extractPixelIds(html)).toEqual([PX1])
  })

  it('被塞进 JSON 字符串里的写法（\\u0026 转义，Next.js 页面里真实出现过）', () => {
    const html = String.raw`{"children":"<img src=\"https://www.facebook.com/tr?id=${PX2}&ev=PageView&noscript=1\"/>"}`
    expect(extractPixelIds(html)).toEqual([PX2])
  })

  it('fbq init 写法：单双引号、空格都认', () => {
    expect(extractPixelIds(`fbq('init', '${PX1}');`)).toEqual([PX1])
    expect(extractPixelIds(`fbq( "init" ,"${PX2}" )`)).toEqual([PX2])
  })

  it('多处出现按首次出现顺序去重', () => {
    const html = `fbq('init','${PX2}') <img src="https://www.facebook.com/tr?id=${PX1}&ev=PageView"> <img src="https://www.facebook.com/tr?id=${PX2}&ev=PageView">`
    expect(extractPixelIds(html)).toEqual([PX2, PX1])
  })

  it('不是数字的占位（模板没渲染出来）和太短的数字不算', () => {
    expect(extractPixelIds('https://www.facebook.com/tr?id=${pixelId}&ev=PageView')).toEqual([])
    expect(extractPixelIds('https://www.facebook.com/tr?id=123&ev=PageView')).toEqual([])
  })

  it('fbq track 不算 init；无关的 id= 也不算', () => {
    expect(extractPixelIds(`fbq('track','PageView'); <div data-id="${PX3}">`)).toEqual([])
  })

  it('fbq init 后面带高级匹配参数也认', () => {
    expect(extractPixelIds(`fbq('init', '${PX3}', {em: 'a@b.test'});`)).toEqual([PX3])
  })

  it('两个像素同时出现', () => {
    const html = `<img src="https://www.facebook.com/tr?id=${PX1}&ev=PageView"><img src="https://www.facebook.com/tr?id=${PX2}&ev=PageView">`
    expect(extractPixelIds(html)).toEqual([PX1, PX2])
  })

  it('id 不是紧跟 facebook.com/tr? 的第一个参数也认；id= 前面必须是参数边界（xid=、pid= 不算）', () => {
    expect(extractPixelIds(`https://www.facebook.com/tr?ev=PageView&noscript=1&id=${PX1}`)).toEqual([PX1])
    expect(extractPixelIds(`https://www.facebook.com/tr?xid=${PX1}&pid=${PX2}`)).toEqual([])
  })

  it('查询串在引号 / 尖括号处结束：引号后面的 id= 不算这个 tr? 的', () => {
    expect(extractPixelIds(`<a href="https://www.facebook.com/tr?ev=PageView">x</a> <p id=${PX1}>`)).toEqual([])
  })

  // 🔴 审查整改（魏征实测）：恶意大页面里堆很多「facebook.com/tr?」再接一大片没有引号的字符，
  //    旧写法对每个起点都扫到页尾，二次方级别，能把进程卡住。新写法每个起点只看一小段。
  it('大量 "facebook.com/tr?" 后面跟一大片没有引号的字符 → 线性时间内返回（旧写法要好几秒）', () => {
    const html = 'facebook.com/tr?'.repeat(10_000) + 'a'.repeat(300_000)
    const started = Date.now()
    expect(extractPixelIds(html)).toEqual([])
    expect(Date.now() - started).toBeLessThan(500)
  })

  it('同样的恶意页面末尾有一个真像素 → 照样认出来，而且很快', () => {
    const html = 'facebook.com/tr?'.repeat(10_000) + 'a'.repeat(300_000) + `<img src="https://www.facebook.com/tr?id=${PX1}&ev=PageView">`
    const started = Date.now()
    expect(extractPixelIds(html)).toEqual([PX1])
    expect(Date.now() - started).toBeLessThan(500)
  })
})

describe('utmPreserved · 跳转之后 UTM 还在不在', () => {
  const req = `${SITE}/p?utm_source=facebook&utm_content=a`

  it('请求地址本身没有 UTM → null（没得比）', () => {
    expect(utmPreserved(`${SITE}/p?x=1`, `${SITE}/p`)).toBeNull()
  })

  it('原样保留 / 顺序不同 / 多出别的参数 → true', () => {
    expect(utmPreserved(req, req)).toBe(true)
    expect(utmPreserved(req, `${SITE}/p?utm_content=a&utm_source=facebook`)).toBe(true)
    expect(utmPreserved(req, `${SITE}/p?utm_source=facebook&utm_content=a&extra=1`)).toBe(true)
  })

  it('整段查询串被丢掉 / 少一个 / 值被改 → false', () => {
    expect(utmPreserved(req, `${SITE}/p`)).toBe(false)
    expect(utmPreserved(req, `${SITE}/p?utm_source=facebook`)).toBe(false)
    expect(utmPreserved(req, `${SITE}/p?utm_source=facebook&utm_content=b`)).toBe(false)
  })

  it('只看 utm_ 开头的参数，别的参数丢了不算', () => {
    expect(utmPreserved(`${SITE}/p?utm_content=a&fbclid=zzz`, `${SITE}/p?utm_content=a`)).toBe(true)
  })
})

describe('isProbeUrlAllowed · 只许探官网自己的主机（防止被配置带去探别的地方）', () => {
  it('同主机、www 与非 www 互认', () => {
    expect(isProbeUrlAllowed(`${SITE}/a?utm_content=x`, SITE)).toBe(true)
    expect(isProbeUrlAllowed('https://example-shop.test/a', SITE)).toBe(true)
    expect(isProbeUrlAllowed(`${SITE}/a`, 'https://example-shop.test')).toBe(true)
  })

  it('别的主机、长得像的主机、子域名骗局 → 否', () => {
    expect(isProbeUrlAllowed('https://evil.test/a', SITE)).toBe(false)
    expect(isProbeUrlAllowed('https://www.example-shop.test.evil.test/a', SITE)).toBe(false)
    expect(isProbeUrlAllowed('https://evilexample-shop.test/a', SITE)).toBe(false)
    expect(isProbeUrlAllowed('https://api.example-shop.test/a', SITE)).toBe(false)
  })

  it('必须 https、不许带账号密码、不许非默认端口、不许怪协议', () => {
    expect(isProbeUrlAllowed('http://www.example-shop.test/a', SITE)).toBe(false)
    expect(isProbeUrlAllowed('https://user:pw@www.example-shop.test/a', SITE)).toBe(false)
    expect(isProbeUrlAllowed('https://www.example-shop.test:8443/a', SITE)).toBe(false)
    expect(isProbeUrlAllowed('javascript:alert(1)', SITE)).toBe(false)
    expect(isProbeUrlAllowed('file:///etc/passwd', SITE)).toBe(false)
  })

  it('地址或官网地址本身不合法 → 否', () => {
    expect(isProbeUrlAllowed('not a url', SITE)).toBe(false)
    expect(isProbeUrlAllowed(`${SITE}/a`, 'not a url')).toBe(false)
  })
})

type Step = { status: number; location?: string; body?: string } | Error

function scripted(steps: Step[]) {
  const calls: { url: string; init: RequestInit | undefined }[] = []
  let i = 0
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    const step = steps[Math.min(i, steps.length - 1)]
    i += 1
    if (step instanceof Error) throw step
    const headers: Record<string, string> = {}
    if (step.location) headers.location = step.location
    return new Response(step.body ?? null, { status: step.status, headers })
  })
  return { fetcher, calls }
}

const TARGET = { label: '落地页 A', url: `${SITE}/p?utm_source=facebook&utm_content=a` }
const HTML = `<html><noscript><img src="https://www.facebook.com/tr?id=${PX1}&ev=PageView&noscript=1"/></noscript></html>`

describe('probeLanding', () => {
  it('直接 200：读出状态、最终地址、像素编号，UTM 保留', async () => {
    const { fetcher, calls } = scripted([{ status: 200, body: HTML }])
    const fact = await probeLanding(TARGET, { siteUrl: SITE, fetcher })
    expect(fact).toEqual({
      label: '落地页 A', url: TARGET.url, http_status: 200, final_url: TARGET.url,
      redirects: 0, utm_preserved: true, pixel_ids: [PX1], error: null,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(TARGET.url)
    expect(calls[0].init?.redirect).toBe('manual')
    expect(calls[0].init?.signal).toBeDefined()
  })

  it('相对地址的跳转（带原查询串）→ 跟过去，redirects=1，UTM 保留', async () => {
    const { fetcher, calls } = scripted([
      { status: 308, location: '/p?utm_source=facebook&utm_content=a' },
      { status: 200, body: HTML },
    ])
    const fact = await probeLanding({ label: 'A', url: `${SITE}/p/?utm_source=facebook&utm_content=a` }, { siteUrl: SITE, fetcher })
    expect(fact.http_status).toBe(200)
    expect(fact.redirects).toBe(1)
    expect(fact.final_url).toBe(`${SITE}/p?utm_source=facebook&utm_content=a`)
    expect(fact.utm_preserved).toBe(true)
    expect(calls[1].url).toBe(`${SITE}/p?utm_source=facebook&utm_content=a`)
  })

  it('非 www 跳到 www：同官网，允许；跳转把查询串丢了 → utm_preserved=false', async () => {
    const { fetcher } = scripted([
      { status: 301, location: `${SITE}/p` },
      { status: 200, body: HTML },
    ])
    const fact = await probeLanding({ label: 'A', url: 'https://example-shop.test/p?utm_content=a' }, { siteUrl: SITE, fetcher })
    expect(fact.http_status).toBe(200)
    expect(fact.utm_preserved).toBe(false)
  })

  it('跳到别的主机 → 立刻停下，不再请求，状态码留 3xx，写明原因', async () => {
    const { fetcher, calls } = scripted([{ status: 301, location: 'https://evil.test/x' }])
    const fact = await probeLanding(TARGET, { siteUrl: SITE, fetcher })
    expect(calls).toHaveLength(1)
    expect(fact.http_status).toBe(301)
    expect(fact.pixel_ids).toEqual([])
    expect(fact.error).toContain('站外')
  })

  it('跳转超过 MAX_REDIRECTS 次 → 停下，写明原因', async () => {
    expect(MAX_REDIRECTS).toBe(5)
    const { fetcher, calls } = scripted([{ status: 302, location: `${SITE}/loop` }])
    const fact = await probeLanding(TARGET, { siteUrl: SITE, fetcher })
    expect(calls).toHaveLength(MAX_REDIRECTS + 1)
    expect(fact.http_status).toBe(302)
    expect(fact.redirects).toBe(MAX_REDIRECTS)
    expect(fact.error).toContain('5')
  })

  it('404：记下状态码，不去解析页面', async () => {
    const { fetcher } = scripted([{ status: 404, body: HTML }])
    const fact = await probeLanding(TARGET, { siteUrl: SITE, fetcher })
    expect(fact.http_status).toBe(404)
    expect(fact.pixel_ids).toEqual([])
  })

  it('网络错误：状态码为空，错误文案里不带令牌（先重试了一次，两次都失败才算）', async () => {
    const { fetcher, calls } = scripted([new Error('fetch failed access_token=SECRET_TOKEN_VALUE_123')])
    const fact = await probeLanding(TARGET, { siteUrl: SITE, fetcher, sleep: noSleep })
    expect(calls).toHaveLength(2)
    expect(fact.http_status).toBeNull()
    expect(fact.final_url).toBeNull()
    expect(fact.pixel_ids).toEqual([])
    expect(fact.error).toBeTruthy()
    expect(JSON.stringify(fact)).not.toContain('SECRET_TOKEN_VALUE_123')
  })

  it('配置里的落地页不在官网主机上 → 一次请求都不发', async () => {
    const { fetcher, calls } = scripted([{ status: 200, body: HTML }])
    const fact = await probeLanding({ label: 'B', url: 'https://evil.test/p?utm_content=a' }, { siteUrl: SITE, fetcher })
    expect(calls).toHaveLength(0)
    expect(fact.http_status).toBeNull()
    expect(fact.error).toContain('官网')
  })

  it('响应头来了但正文一直不发 → 到时限就放弃，按「没连上」处理（不是「没有像素」）', async () => {
    const hanging = {
      status: 200,
      headers: new Headers(),
      text: () => new Promise<string>(() => undefined),
    }
    const fetcher = vi.fn(async () => hanging as Response)
    const fact = await probeLanding(TARGET, { siteUrl: SITE, fetcher, timeoutMs: 30 })
    expect(fact.http_status).toBeNull()
    expect(fact.pixel_ids).toEqual([])
    expect(fact.error).toContain('超时')
  })

  it('请求地址没有 UTM → utm_preserved 为 null', async () => {
    const { fetcher } = scripted([{ status: 200, body: HTML }])
    const fact = await probeLanding({ label: 'A', url: `${SITE}/p` }, { siteUrl: SITE, fetcher })
    expect(fact.utm_preserved).toBeNull()
  })
})

describe('probeLanding · 正文读取有上限（审查整改：恶意大页面不能把内存读爆）', () => {
  it('对方一直发数据 → 只读到上限就停手并取消，上限之前的像素标记照样认', async () => {
    let pulled = 0
    const head = new TextEncoder().encode(HTML)
    const chunk = new TextEncoder().encode('x'.repeat(256 * 1024))
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1
        if (pulled === 1) { controller.enqueue(head); return }
        if (pulled > 400) { controller.close(); return }
        controller.enqueue(chunk)
      },
    })
    const fetcher = vi.fn(async () => new Response(stream, { status: 200 }))
    const fact = await probeLanding(TARGET, { siteUrl: SITE, fetcher, timeoutMs: 5000 })
    expect(fact.http_status).toBe(200)
    expect(fact.pixel_ids).toEqual([PX1])
    expect(pulled).toBeLessThan(40)
  })

  it('页面比上限小 → 照常读完', async () => {
    const { fetcher } = scripted([{ status: 200, body: HTML }])
    const fact = await probeLanding(TARGET, { siteUrl: SITE, fetcher })
    expect(fact.pixel_ids).toEqual([PX1])
  })
})

describe('probeLanding · 瞬时故障重试一次（审查整改）', () => {
  it('第一次连接失败（超时 / 网络错误）→ 等一下再试一次，第二次成功就当没发生过', async () => {
    const sleeps: number[] = []
    const { fetcher, calls } = scripted([new Error('network down'), { status: 200, body: HTML }])
    const fact = await probeLanding(TARGET, { siteUrl: SITE, fetcher, sleep: async ms => { sleeps.push(ms) } })
    expect(fact.http_status).toBe(200)
    expect(fact.error).toBeNull()
    expect(fact.pixel_ids).toEqual([PX1])
    expect(calls).toHaveLength(2)
    expect(sleeps).toEqual([RETRY_DELAY_MS])
  })

  it('502 / 503 / 504 / 429 → 再试一次；第二次 200 就用第二次的', async () => {
    for (const status of [502, 503, 504, 429]) {
      const { fetcher, calls } = scripted([{ status }, { status: 200, body: HTML }])
      const fact = await probeLanding(TARGET, { siteUrl: SITE, fetcher, sleep: noSleep })
      expect(fact.http_status, String(status)).toBe(200)
      expect(calls, String(status)).toHaveLength(2)
    }
  })

  it('连着两次 503 → 最终就是 503（落地页红），一共只发两次', async () => {
    const { fetcher, calls } = scripted([{ status: 503 }])
    const fact = await probeLanding(TARGET, { siteUrl: SITE, fetcher, sleep: noSleep })
    expect(fact.http_status).toBe(503)
    expect(calls).toHaveLength(2)
  })

  it('404 和跳转不重试（它们不是瞬时故障）', async () => {
    const notFound = scripted([{ status: 404 }])
    await probeLanding(TARGET, { siteUrl: SITE, fetcher: notFound.fetcher, sleep: noSleep })
    expect(notFound.calls).toHaveLength(1)

    const redirect = scripted([{ status: 301, location: 'https://evil.test/x' }])
    await probeLanding(TARGET, { siteUrl: SITE, fetcher: redirect.fetcher, sleep: noSleep })
    expect(redirect.calls).toHaveLength(1)
  })

  it('两次都抛错 → 没连上（状态码空），错误文案不带令牌，一共只发两次', async () => {
    const { fetcher, calls } = scripted([new Error('down access_token=SECRET_TOKEN_VALUE_123')])
    const fact = await probeLanding(TARGET, { siteUrl: SITE, fetcher, sleep: noSleep })
    expect(fact.http_status).toBeNull()
    expect(calls).toHaveLength(2)
    expect(JSON.stringify(fact)).not.toContain('SECRET_TOKEN_VALUE_123')
  })

  it('跳转链上的某一跳瞬时失败 → 只重试那一跳，不从头再来', async () => {
    const { fetcher, calls } = scripted([
      { status: 308, location: '/p?utm_source=facebook&utm_content=a' },
      { status: 503 },
      { status: 200, body: HTML },
    ])
    const fact = await probeLanding(
      { label: 'A', url: `${SITE}/p/?utm_source=facebook&utm_content=a` },
      { siteUrl: SITE, fetcher, sleep: noSleep },
    )
    expect(fact.http_status).toBe(200)
    expect(fact.redirects).toBe(1)
    expect(calls.map(c => c.url)).toEqual([
      `${SITE}/p/?utm_source=facebook&utm_content=a`,
      `${SITE}/p?utm_source=facebook&utm_content=a`,
      `${SITE}/p?utm_source=facebook&utm_content=a`,
    ])
  })
})
