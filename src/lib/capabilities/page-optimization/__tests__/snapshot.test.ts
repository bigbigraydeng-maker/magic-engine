import { describe, it, expect, vi } from 'vitest'
import { takePageSnapshot } from '../snapshot'
import type { GithubSnapshotTarget, PageSnapshotTarget, WordpressSnapshotTarget } from '../snapshot'

describe('takePageSnapshot · GitHub', () => {
  const target: GithubSnapshotTarget = Object.freeze({
    provider: 'github',
    owner: 'owner',
    repo: 'repo',
    path: 'index.html',
    branch: 'main',
    token: 'fake-pat',
  })

  it('blob SHA 原样保留成并发令牌，不做任何加工', async () => {
    const readGithubFile = vi.fn(async () => ({ content: '<html></html>', sha: 'blob-sha-abc123' }))
    const snapshot = await takePageSnapshot(target, { readGithubFile })
    expect(snapshot.ok).toBe(true)
    if (snapshot.ok && snapshot.provider === 'github') {
      expect(snapshot.versionToken).toBe('blob-sha-abc123')
      expect(snapshot.rawContent).toBe('<html></html>')
    }
  })

  it('不改动传入的 target（冻结对象，改了就会抛错）', async () => {
    const readGithubFile = vi.fn(async () => ({ content: '<html></html>', sha: 'sha-1' }))
    await expect(takePageSnapshot(target, { readGithubFile })).resolves.toBeDefined()
    expect(Object.isFrozen(target)).toBe(true)
  })

  it('只调用一次注入的读方法，不重复发请求', async () => {
    const readGithubFile = vi.fn(async () => ({ content: 'x', sha: 'y' }))
    await takePageSnapshot(target, { readGithubFile })
    expect(readGithubFile).toHaveBeenCalledTimes(1)
    expect(readGithubFile).toHaveBeenCalledWith(target)
  })
})

describe('takePageSnapshot · WordPress', () => {
  const target: WordpressSnapshotTarget = Object.freeze({
    provider: 'wordpress',
    config: Object.freeze({ siteUrl: 'https://romanhu.com', username: 'me', appPassword: 'fake' }),
    postId: 42,
    postType: 'page',
  })

  it('modified 时间戳原样保留成并发令牌', async () => {
    const readWordpressPost = vi.fn(async () => ({
      title: 'Listing 123',
      content: '<p>body</p>',
      seoTitle: 'Listing 123 | Roman Hu',
      seoDescription: 'A great listing',
      modified: '2026-08-10T09:00:00.000Z',
    }))
    const snapshot = await takePageSnapshot(target, { readWordpressPost })
    expect(snapshot.ok).toBe(true)
    if (snapshot.ok && snapshot.provider === 'wordpress') {
      expect(snapshot.versionToken).toBe('2026-08-10T09:00:00.000Z')
      expect(snapshot.rawFields.seoTitle).toBe('Listing 123 | Roman Hu')
    }
  })

  it('只调用一次注入的读方法', async () => {
    const readWordpressPost = vi.fn(async () => ({
      title: 't', content: 'c', seoTitle: 's', seoDescription: 'd', modified: 'm',
    }))
    await takePageSnapshot(target, { readWordpressPost })
    expect(readWordpressPost).toHaveBeenCalledTimes(1)
  })
})

describe('takePageSnapshot · Shopify/none 不能伪装成一份已有页面的快照', () => {
  it('Shopify → 显式不可用，不产出任何 rawContent/rawFields', async () => {
    const target: PageSnapshotTarget = { provider: 'shopify', reason: 'Shopify 没有读已有页面的实现' }
    const snapshot = await takePageSnapshot(target)
    expect(snapshot.ok).toBe(false)
    expect(snapshot).not.toHaveProperty('rawContent')
    expect(snapshot).not.toHaveProperty('rawFields')
    if (!snapshot.ok) expect(snapshot.reason).toBe('Shopify 没有读已有页面的实现')
  })

  it('none（未连接）→ 显式不可用', async () => {
    const target: PageSnapshotTarget = { provider: 'none', reason: '未连接任何 provider' }
    const snapshot = await takePageSnapshot(target)
    expect(snapshot.ok).toBe(false)
  })
})

describe('takePageSnapshot · 不触发 fetch（默认实现之外，注入路径零网络）', () => {
  it('用注入读方法时不会调用全局 fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await takePageSnapshot(
      { provider: 'github', owner: 'o', repo: 'r', path: 'p', branch: 'b', token: 't' },
      { readGithubFile: async () => ({ content: 'x', sha: 'y' }) },
    )
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})
