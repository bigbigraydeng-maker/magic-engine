import { describe, it, expect, vi, afterEach } from 'vitest'
import { extractBuyerFacingText, fetchAccountCustomAudiences, fetchAdCreativesReadback, fetchAdSetReadback, fetchCampaignStatus } from '../readback'

describe('extractBuyerFacingText —— 宁多勿漏', () => {
  it('摘 link_data 里的正文/标题/描述', () => {
    const out = extractBuyerFacingText({
      object_story_spec: {
        link_data: { message: '正文', name: '标题', description: '描述', caption: '副标' },
      },
    })
    expect(out).toEqual(expect.arrayContaining(['正文', '标题', '描述', '副标']))
  })

  it('摘 video_data 里的正文/标题', () => {
    const out = extractBuyerFacingText({
      object_story_spec: {
        video_data: { message: '视频正文', title: '视频标题', link_description: '链接说明' },
      },
    })
    expect(out).toEqual(expect.arrayContaining(['视频正文', '视频标题', '链接说明']))
  })

  it('顶层 body / title 也算', () => {
    expect(extractBuyerFacingText({ body: 'B', title: 'T' })).toEqual(expect.arrayContaining(['B', 'T']))
  })

  it('Advantage+ 自动化文案（数组形式）也摘', () => {
    const out = extractBuyerFacingText({
      asset_feed_spec: {
        bodies: [{ text: '文案A' }, { text: '文案B' }],
        titles: [{ text: '标题A' }],
      },
    })
    expect(out).toEqual(expect.arrayContaining(['文案A', '文案B', '标题A']))
  })

  it('空白和非字符串被滤掉', () => {
    const out = extractBuyerFacingText({
      body: '  ', title: null,
      object_story_spec: { link_data: { message: '有效', name: '' } },
    })
    expect(out).toEqual(['有效'])
  })

  it('去重 —— 同一句话出现在多处只打一次', () => {
    const out = extractBuyerFacingText({
      body: '同一句',
      object_story_spec: { link_data: { message: '同一句' } },
    })
    expect(out).toEqual(['同一句'])
  })

  it('传 null / 非对象不炸', () => {
    expect(extractBuyerFacingText(null)).toEqual([])
    expect(extractBuyerFacingText('字符串')).toEqual([])
    expect(extractBuyerFacingText(undefined)).toEqual([])
  })
})

// ── 核心：那句中文问候语必须被解析出来，不能是一坨转义 JSON ────────────
describe('page_welcome_message —— 2026-08-04 事故的原文', () => {
  const WELCOME = JSON.stringify({
    message: {
      text: '{{user_first_name}}，你好！请问有什么可以帮助你的?',
      quick_replies: [
        { title: '房子有没有车库？' },
        { title: '8月20日前签约的礼卡是什么？' },
        { title: '房子的具体地址在哪里？' },
      ],
    },
  })

  it('🔴 问候语正文被解析出来（而不是打出一坨 JSON）', () => {
    const out = extractBuyerFacingText({
      object_story_spec: { video_data: { message: '广告正文', page_welcome_message: WELCOME } },
    })
    expect(out).toContain('{{user_first_name}}，你好！请问有什么可以帮助你的?')
    expect(out.some(s => s.startsWith('{"message"'))).toBe(false)
  })

  it('🔴 建议回复按钮也要打出来 —— 买家点的就是它们', () => {
    const out = extractBuyerFacingText({
      object_story_spec: { video_data: { page_welcome_message: WELCOME } },
    })
    expect(out).toContain('8月20日前签约的礼卡是什么？')
    expect(out).toContain('房子有没有车库？')
  })

  it('text_format 那种嵌套写法也认', () => {
    const alt = JSON.stringify({ text_format: { message: { text: '另一种结构的问候语' } } })
    const out = extractBuyerFacingText({
      object_story_spec: { link_data: { page_welcome_message: alt } },
    })
    expect(out).toContain('另一种结构的问候语')
  })

  it('解析不了时原样给出去 —— 看不懂也好过悄悄丢掉', () => {
    const out = extractBuyerFacingText({
      object_story_spec: { link_data: { page_welcome_message: '这不是 JSON' } },
    })
    expect(out).toContain('这不是 JSON')
  })

  it('回归：整条真实创意 —— 广告正文 + 中文问候语 + 三个中文按钮全部现形', () => {
    const out = extractBuyerFacingText({
      object_story_spec: {
        video_data: {
          message: '🏡 Rangitoto College 学区 · Rothesay Bay 全新 4 房独立屋',
          title: '私信预约看房 · Rangitoto 学区',
          page_welcome_message: WELCOME,
        },
      },
    })
    // 买家会看到的每一句，一句不少
    expect(out.length).toBeGreaterThanOrEqual(6)
    expect(out.join('\n')).toContain('请问有什么可以帮助你的')
  })
})

/**
 * 2026-08-05 魏征 B5：三种创意形态的文案完全摘不到。
 *
 * 这三种不是边角料 —— 轮播是地产最常用的形态之一，自然帖投流是 boost 按钮的
 * 默认产物。摘不到就等于每日扫描对它们完全瞎，而那次得罪 5 个买家的问题
 * 正是「文案藏在结构更深一层、于是没人看见」。
 */
describe('extractBuyerFacingText — 三种漏摘形态（魏征 B5）', () => {
  it('轮播：每张卡自己的标题和描述都要摘到', () => {
    const texts = extractBuyerFacingText({
      object_story_spec: {
        link_data: {
          message: '卡片上方那段话',
          child_attachments: [
            { name: '第一张卡标题', description: '第一张卡描述' },
            { name: '第二张卡标题', description: '第二张卡描述' },
          ],
        },
      },
    })
    expect(texts).toContain('卡片上方那段话')
    expect(texts).toContain('第一张卡标题')
    expect(texts).toContain('第二张卡描述')
  })

  it('轮播卡上的按钮文字也算买家可见', () => {
    const texts = extractBuyerFacingText({
      object_story_spec: {
        link_data: {
          child_attachments: [
            { call_to_action: { type: 'LEARN_MORE', value: { link_title: '立即预约看房' } } },
          ],
        },
      },
    })
    expect(texts).toContain('立即预约看房')
  })

  it('动态商品广告：文案在 template_data，不在 link_data', () => {
    const texts = extractBuyerFacingText({
      object_story_spec: {
        template_data: {
          message: '{{product.name}} 现房在售',
          name: '{{product.price}}',
          description: '限时',
        },
      },
    })
    expect(texts).toContain('{{product.name}} 现房在售')
    expect(texts).toContain('限时')
  })

  it('绝不把 id 当成买家可见文案 —— 会污染语言判定', () => {
    const texts = extractBuyerFacingText({
      product_set_id: '1234567890',
      link_og_id: '9876543210',
      object_story_spec: { template_data: { message: '现房在售' } },
    })
    expect(texts).toEqual(['现房在售'])
  })

  it('自然帖投流：创意里一句文案都没有（要靠另取主页帖子）', () => {
    // 这里只锁「创意本身确实是空的」——去主页取的行为在下面那组测
    const texts = extractBuyerFacingText({
      id: 'cr1',
      effective_object_story_id: '227633594573276_123',
    })
    expect(texts).toEqual([])
  })
})

describe('fetchAdCreativesReadback — 自然帖投流要去主页把文案取回来', () => {
  afterEach(() => vi.unstubAllGlobals())

  function stub(handler: (url: string) => unknown) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        json: async () => handler(url),
        text: async () => JSON.stringify(handler(url)),
      })),
    )
  }

  it('创意里没文案时，去主页帖子取', async () => {
    stub((url) =>
      url.includes('/ads?')
        ? { data: [{ id: 'ad1', name: 'boost', creative: { id: 'cr1', effective_object_story_id: 'p_1' } }] }
        : { message: '本周末开放参观，欢迎预约', name: '30 Kiteroa Terrace' },
    )
    const rows = await fetchAdCreativesReadback('as1', 'tok')
    expect(rows).not.toBeNull()
    expect(rows![0].texts).toContain('本周末开放参观，欢迎预约')
    expect(rows![0].texts).toContain('30 Kiteroa Terrace')
  })

  it('创意里已有文案就不多打一次 Graph', async () => {
    const f = vi.fn(async (url: string) => ({
      ok: true, status: 200,
      json: async () => ({
        data: [{ id: 'ad1', name: 'x', creative: { body: '有文案', effective_object_story_id: 'p_1' } }],
      }),
      text: async () => '',
    }))
    vi.stubGlobal('fetch', f)
    await fetchAdCreativesReadback('as1', 'tok')
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('主页帖子也取不到 → 保持空，不编（空 ≠ 出错）', async () => {
    stub((url) =>
      url.includes('/ads?')
        ? { data: [{ id: 'ad1', name: 'boost', creative: { effective_object_story_id: 'p_1' } }] }
        : {},
    )
    const rows = await fetchAdCreativesReadback('as1', 'tok')
    expect(rows![0].texts).toEqual([])
  })
})

describe('回读要带状态 + 每次请求有超时（建「全程暂停」的广告要有回读证据）', () => {
  const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => '' }) as unknown as Response

  it('取广告组时索要 status 字段', async () => {
    const f = vi.fn(async () => okJson({ id: 'as1', status: 'PAUSED' }))
    vi.stubGlobal('fetch', f)
    const adSet = await fetchAdSetReadback('as1', 'tok')
    const url = (f.mock.calls[0] as unknown as [string])[0]
    expect(decodeURIComponent(url)).toMatch(/fields=[^&]*\bstatus\b/)
    expect(adSet?.status).toBe('PAUSED')
  })

  it('取广告时索要 status，并把每条广告的 status 带出来', async () => {
    const f = vi.fn(async () => okJson({ data: [{ id: 'ad1', name: 'x', status: 'PAUSED', creative: { body: 'hi' } }] }))
    vi.stubGlobal('fetch', f)
    const rows = await fetchAdCreativesReadback('as1', 'tok')
    expect(decodeURIComponent((f.mock.calls[0] as unknown as [string])[0])).toMatch(/fields=id,name,status,creative/)
    expect(rows?.[0].status).toBe('PAUSED')
  })

  it('系列状态：读到返回字符串；读不到 / 返回里没有 → null（不是 PAUSED）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ id: 'c1', status: 'PAUSED' })))
    expect(await fetchCampaignStatus('c1', 'tok')).toBe('PAUSED')
    vi.stubGlobal('fetch', vi.fn(async () => okJson({ id: 'c1' })))
    expect(await fetchCampaignStatus('c1', 'tok')).toBeNull()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, text: async () => 'x' }) as unknown as Response))
    expect(await fetchCampaignStatus('c1', 'tok')).toBeNull()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('timeout') }))
    expect(await fetchCampaignStatus('c1', 'tok')).toBeNull()
  })

  it('读请求带超时信号', async () => {
    const f = vi.fn(async () => okJson({ id: 'as1' }))
    vi.stubGlobal('fetch', f)
    await fetchAdSetReadback('as1', 'tok')
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('fetchAccountCustomAudiences — 读账户受众列表（读不全 / 读不到都是 null）', () => {
  afterEach(() => vi.unstubAllGlobals())

  function stub(body: unknown) {
    const f = vi.fn(async (_url: string) => ({
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    }))
    vi.stubGlobal('fetch', f)
    return f
  }

  it('把受众列表归一成稳定形状，并索要足够多', async () => {
    const f = stub({
      data: [
        {
          id: '1111111',
          name: 'Site visitors',
          subtype: 'WEBSITE',
          operation_status: { code: 200, description: 'Normal' },
          approximate_count_lower_bound: 1000,
        },
        { id: '2222222' },
      ],
    })
    const result = await fetchAccountCustomAudiences('act_1', 'tok')
    expect(result).toEqual([
      {
        id: '1111111',
        name: 'Site visitors',
        subtype: 'WEBSITE',
        operationStatusCode: 200,
        approxCountLowerBound: 1000,
      },
      {
        id: '2222222',
        name: null,
        subtype: null,
        operationStatusCode: null,
        approxCountLowerBound: null,
      },
    ])
    const url = (f.mock.calls[0] as unknown as [string])[0]
    expect(url).toContain('/act_1/customaudiences')
    expect(url).toContain('limit=200')
  })

  it('🔴 有下一页 → null（读不全就不假装读全）', async () => {
    stub({
      data: [{ id: '1111111', name: 'Site visitors' }],
      paging: { next: 'https://graph.facebook.com/next' },
    })
    expect(await fetchAccountCustomAudiences('act_1', 'tok')).toBeNull()
  })

  it('🔴 形状不对 / 缺 id → null', async () => {
    stub({ data: 'x' })
    expect(await fetchAccountCustomAudiences('act_1', 'tok')).toBeNull()
    stub({ data: [{ name: 'no id' }] })
    expect(await fetchAccountCustomAudiences('act_1', 'tok')).toBeNull()
  })

  it('HTTP 失败 → null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
      text: async () => '',
    })))
    expect(await fetchAccountCustomAudiences('act_1', 'tok')).toBeNull()
  })

  it('空列表是有效答案，不是 null', async () => {
    stub({ data: [] })
    expect(await fetchAccountCustomAudiences('act_1', 'tok')).toEqual([])
  })
})
