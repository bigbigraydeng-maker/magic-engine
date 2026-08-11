import { describe, it, expect } from 'vitest'
import { diffPageChange } from '../diff'
import { draftPageChange } from '../draft'
import type { GithubPageSnapshot, PageOptimizationIntent, WordpressPageSnapshot } from '../types'

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

function githubSnapshot(): GithubPageSnapshot {
  return {
    ok: true,
    provider: 'github',
    fetchedAt: '2026-08-11T00:00:00.000Z',
    rawContent: GITHUB_HTML,
    versionToken: 'blob-sha-1',
  }
}

function wordpressSnapshot(): WordpressPageSnapshot {
  return {
    ok: true,
    provider: 'wordpress',
    fetchedAt: '2026-08-11T00:00:00.000Z',
    rawFields: { title: 'Old Title', content: 'Old body', seoTitle: 'Old SEO Title', seoDescription: 'Old SEO Description' },
    versionToken: '2026-08-10T00:00:00.000Z',
  }
}

function intent(field: 'meta_title' | 'meta_description' | 'content_html', proposedValue: string): PageOptimizationIntent {
  return { field, proposedValue, semanticIntent: { known: false, reason: 'not_applicable' } }
}

describe('diffPageChange · 字段级 before/after', () => {
  it('GitHub：只改 meta_title，产出恰好一条 field 记录，changed=true', () => {
    const snapshot = githubSnapshot()
    const draft = draftPageChange(snapshot, [intent('meta_title', 'New Title')])
    const diff = diffPageChange(snapshot, draft)
    expect(diff.ok).toBe(true)
    if (diff.ok) {
      expect(diff.changes).toEqual([
        { field: 'meta_title', before: 'Old Title', after: 'New Title', changed: true },
      ])
    }
  })

  it('WordPress：三个字段各自独立的 before/after', () => {
    const snapshot = wordpressSnapshot()
    const draft = draftPageChange(snapshot, [
      intent('meta_title', 'New SEO Title'),
      intent('meta_description', 'Old SEO Description'), // 提议值跟原值一样
      intent('content_html', 'New body'),
    ])
    const diff = diffPageChange(snapshot, draft)
    expect(diff.ok).toBe(true)
    if (diff.ok) {
      expect(diff.changes).toEqual([
        { field: 'meta_title', before: 'Old SEO Title', after: 'New SEO Title', changed: true },
        { field: 'meta_description', before: 'Old SEO Description', after: 'Old SEO Description', changed: false },
        { field: 'content_html', before: 'Old body', after: 'New body', changed: true },
      ])
    }
  })

  it('diff 只有 field + before + after + changed 四项，没有多余字段', () => {
    const snapshot = wordpressSnapshot()
    const draft = draftPageChange(snapshot, [intent('meta_title', 'New SEO Title')])
    const diff = diffPageChange(snapshot, draft)
    expect(diff.ok).toBe(true)
    if (diff.ok) {
      for (const change of diff.changes) {
        expect(Object.keys(change).sort()).toEqual(['after', 'before', 'changed', 'field'])
      }
    }
  })

  it('是确定性的：同一份 snapshot + 同一份 draft，两次调用逐字节相同', () => {
    const snapshot = githubSnapshot()
    const draft = draftPageChange(snapshot, [intent('meta_title', 'New Title')])
    expect(diffPageChange(snapshot, draft)).toEqual(diffPageChange(snapshot, draft))
  })

  it('快照不可用 → diff 失败，不产出空数组冒充"没有改动"', () => {
    const diff = diffPageChange(
      { ok: false, provider: 'none', reason: '未连接任何 provider' },
      { ok: true, fields: [{ field: 'meta_title', value: 'x' }] },
    )
    expect(diff.ok).toBe(false)
  })

  it('草稿不可用 → diff 失败', () => {
    const diff = diffPageChange(githubSnapshot(), { ok: false, reason: '起草失败' })
    expect(diff.ok).toBe(false)
  })
})

describe('diffPageChange · 结果 JSON-safe（无损往返）', () => {
  it('成功的 PageDiffResult 能无损 JSON 往返', () => {
    const snapshot = wordpressSnapshot()
    const draft = draftPageChange(snapshot, [intent('meta_title', 'New SEO Title')])
    const diff = diffPageChange(snapshot, draft)
    expect(diff.ok).toBe(true)
    expect(JSON.parse(JSON.stringify(diff))).toEqual(diff)
  })

  it('失败的 PageDiffResult 能无损 JSON 往返', () => {
    const diff = diffPageChange({ ok: false, provider: 'none', reason: '未连接任何 provider' }, { ok: false, reason: '起草失败' })
    expect(diff.ok).toBe(false)
    expect(JSON.parse(JSON.stringify(diff))).toEqual(diff)
  })
})
