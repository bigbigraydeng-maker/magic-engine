import { describe, it, expect, vi } from 'vitest'
import { draftPageChange } from '../draft'
import type {
  GithubPageSnapshot,
  PageOptimizationField,
  PageOptimizationIntent,
  PageOptimizationRequest,
  WordpressPageSnapshot,
} from '../types'

const GITHUB_HTML = `<!doctype html>
<html>
<head>
  <title>Old Title</title>
  <meta name="description" content="Old description">
</head>
<body>
  <!-- ME:PAGE-CONTENT:START -->
  <p>Old body</p>
  <!-- ME:PAGE-CONTENT:END -->
</body>
</html>`

function githubSnapshot(rawContent = GITHUB_HTML): GithubPageSnapshot {
  return Object.freeze({
    ok: true,
    provider: 'github',
    fetchedAt: '2026-08-11T00:00:00.000Z',
    rawContent,
    versionToken: 'blob-sha-1',
  })
}

function wordpressSnapshot(): WordpressPageSnapshot {
  return Object.freeze({
    ok: true,
    provider: 'wordpress',
    fetchedAt: '2026-08-11T00:00:00.000Z',
    rawFields: Object.freeze({
      title: 'Old Title',
      content: 'Old body',
      seoTitle: 'Old SEO Title',
      seoDescription: 'Old SEO Description',
    }),
    versionToken: '2026-08-10T00:00:00.000Z',
  })
}

function intent(field: PageOptimizationField, proposedValue: string): PageOptimizationIntent {
  return { field, proposedValue, semanticIntent: { known: false, reason: 'not_applicable' } }
}

describe('draftPageChange · 只接受 v1 冻结的三个字段', () => {
  it('拒绝不在冻结字段集合内的字段', () => {
    // 故意构造一个越过类型系统的非法字段（模拟跨 JSON 边界传入的畸形请求），
    // 断言运行时校验真的挡得住，不是只靠编译期类型撑门面。
    const bogus = {
      field: 'slug',
      proposedValue: 'x',
      semanticIntent: { known: false, reason: 'not_applicable' },
    } as unknown as PageOptimizationIntent
    const result = draftPageChange(githubSnapshot(), [bogus])
    expect(result.ok).toBe(false)
  })

  it('接受三个冻结字段各自单独出现', () => {
    for (const field of ['meta_title', 'meta_description', 'content_html'] as const) {
      const result = draftPageChange(wordpressSnapshot(), [intent(field, 'new value')])
      expect(result.ok).toBe(true)
    }
  })

  it('同一字段出现不止一次意图 → 拒绝（歧义）', () => {
    const result = draftPageChange(wordpressSnapshot(), [
      intent('meta_title', 'A'),
      intent('meta_title', 'B'),
    ])
    expect(result.ok).toBe(false)
  })

  it('空意图集合 → 拒绝', () => {
    const result = draftPageChange(wordpressSnapshot(), [])
    expect(result.ok).toBe(false)
  })
})

describe('draftPageChange · proposedValue 必须是字符串（JSON-safe 运行时事实，不只是类型注释）', () => {
  it('proposedValue 是 undefined（跨 JSON 边界丢失的典型形状）→ 拒绝', () => {
    const bogus = {
      field: 'meta_title',
      proposedValue: undefined,
      semanticIntent: { known: false, reason: 'not_applicable' },
    } as unknown as PageOptimizationIntent
    const result = draftPageChange(wordpressSnapshot(), [bogus])
    expect(result.ok).toBe(false)
  })

  it('proposedValue 是数字 → 拒绝', () => {
    const bogus = {
      field: 'meta_title',
      proposedValue: 42,
      semanticIntent: { known: false, reason: 'not_applicable' },
    } as unknown as PageOptimizationIntent
    const result = draftPageChange(wordpressSnapshot(), [bogus])
    expect(result.ok).toBe(false)
  })

  it('proposedValue 是 null → 拒绝', () => {
    const bogus = {
      field: 'meta_title',
      proposedValue: null,
      semanticIntent: { known: false, reason: 'not_applicable' },
    } as unknown as PageOptimizationIntent
    const result = draftPageChange(wordpressSnapshot(), [bogus])
    expect(result.ok).toBe(false)
  })
})

describe('draftPageChange · 不在没有快照的情况下起草', () => {
  it('快照不可用（shopify）→ 起草失败，不假装能起草', () => {
    const result = draftPageChange(
      { ok: false, provider: 'shopify', reason: 'Shopify 没有更新已有页面的实现' },
      [intent('meta_title', 'x')],
    )
    expect(result.ok).toBe(false)
  })

  it('快照不可用（none）→ 起草失败', () => {
    const result = draftPageChange(
      { ok: false, provider: 'none', reason: '未连接任何 provider' },
      [intent('meta_title', 'x')],
    )
    expect(result.ok).toBe(false)
  })
})

describe('draftPageChange · GitHub 静态页 facade', () => {
  it('成功起草：只改 meta_title，产出的字段就是提议的值', () => {
    const result = draftPageChange(githubSnapshot(), [intent('meta_title', 'New Title')])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.fields).toEqual([{ field: 'meta_title', value: 'New Title' }])
    }
  })

  it('目标页面没有 <title> 标签 → 起草失败，不猜一个值', () => {
    const brokenHtml = '<!doctype html><html><head></head><body>no title here</body></html>'
    const result = draftPageChange(githubSnapshot(brokenHtml), [intent('meta_title', 'New Title')])
    expect(result.ok).toBe(false)
  })
})

describe('draftPageChange · 不调用任何 provider / 网络依赖', () => {
  it('起草过程中不触发 fetch', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    draftPageChange(githubSnapshot(), [intent('meta_title', 'New Title')])
    draftPageChange(wordpressSnapshot(), [intent('content_html', 'New body')])
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('不改动传入的 snapshot / intents（都是冻结对象，改了就会抛错）', () => {
    const snapshot = githubSnapshot()
    const intents = [intent('meta_title', 'New Title')]
    expect(() => draftPageChange(snapshot, intents)).not.toThrow()
  })
})

describe('JSON-safe（无损往返）', () => {
  const request: PageOptimizationRequest = {
    clientId: 'client-1',
    page: { url: 'https://romanhu.com/listings/123' },
    intents: [intent('meta_title', 'New Title')],
    lineage: { findingRefs: ['finding-1'] },
    verification: {
      metricRef: 'geo.owned_page_citation',
      windowDays: 14,
      baseline: 'previous_measurement',
      criteria: { success: 'citation increases', failure: 'citation unchanged or drops', indeterminate: 'not_comparable' },
    },
    constraints: { doNotTouch: [] },
    basedOnVersion: { known: false, reason: 'not_recorded_by_source' },
  }

  it('PageOptimizationRequest 能无损 JSON 往返（GrowthJsonValue 兼容性的运行时证据）', () => {
    expect(JSON.parse(JSON.stringify(request))).toEqual(request)
  })

  it('成功的 PageDraftResult 能无损 JSON 往返', () => {
    const result = draftPageChange(wordpressSnapshot(), request.intents)
    expect(result.ok).toBe(true)
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
  })

  it('失败的 PageDraftResult 能无损 JSON 往返', () => {
    const result = draftPageChange({ ok: false, provider: 'none', reason: '未连接任何 provider' }, request.intents)
    expect(result.ok).toBe(false)
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
  })
})
