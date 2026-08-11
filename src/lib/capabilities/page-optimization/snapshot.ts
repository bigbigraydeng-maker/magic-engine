/**
 * snapshot —— 改之前先把原样存下来（Issue #878 / WP06）。
 *
 * 🔴 物理边界（WP00 Page 契约 §7）：这是本次改动里唯一需要 import provider
 *    客户端的文件，所以只能落在 `src/lib/capabilities/` 下——放
 *    `src/lib/cms/` 或 `src/lib/page-optimization/` 都会撞
 *    `src/lib/kernel/__tests__/architecture.test.ts` 的 `PROVIDER_WRITE_MODULES`
 *    检查。
 * 🔴 只读——只调用 `GithubClient.getFileContent`（读）和
 *    `getExistingWordpressPost`（读），零写方法调用
 *    （2026-08-11 实施指令第 5 条：「Read-only GitHub/WordPress snapshot
 *    calls...are the only operations」）。**不 import
 *    `connection-store.ts` / `supabaseAdmin`**——凭据由调用方解析好后通过
 *    `PageSnapshotTarget` 注入，本文件不做 DB 查询，也就不需要
 *    `assertClientOwnsTarget` 那层闸门（那层闸门仍然存在于凭据解析处，
 *    调用方必须经过它取得 token/config，本文件只负责拿到手之后怎么读）。
 * 🔴 Shopify 没有「读已有页面」的实现（`shopify-client.ts` 只有创建方法），
 *    未连接（none）同理——两者都直接返回显式不可用，不伪造快照。
 * 🔴 读方法通过 `PageSnapshotReaders` 注入，默认实现包一层现成的读方法；
 *    测试可以传入假读方法，不需要真的发网络请求或造 Supabase mock。
 */

import { GithubClient } from '@/lib/cms/github-client'
import { getExistingWordpressPost } from '@/lib/cms/wordpress-client'
import type { WordpressClientConfig, WordpressPostType } from '@/lib/cms/wordpress-client'
import type { PageSnapshot } from '@/lib/page-optimization'

export interface GithubSnapshotTarget {
  readonly provider: 'github'
  readonly owner: string
  readonly repo: string
  readonly path: string
  readonly branch: string
  /** 明文 PAT——由调用方解密后传入，本文件不碰加密/存储层。 */
  readonly token: string
}

export interface WordpressSnapshotTarget {
  readonly provider: 'wordpress'
  readonly config: WordpressClientConfig
  readonly postId: number
  readonly postType: WordpressPostType
}

export interface UnavailableSnapshotTarget {
  readonly provider: 'shopify' | 'none'
  readonly reason: string
}

export type PageSnapshotTarget = GithubSnapshotTarget | WordpressSnapshotTarget | UnavailableSnapshotTarget

interface WordpressReadResult {
  readonly title: string
  readonly content: string
  readonly seoTitle?: string
  readonly seoDescription?: string
  readonly modified: string
}

export interface PageSnapshotReaders {
  readonly readGithubFile?: (target: GithubSnapshotTarget) => Promise<{ content: string; sha: string }>
  readonly readWordpressPost?: (target: WordpressSnapshotTarget) => Promise<WordpressReadResult>
}

const defaultReadGithubFile: NonNullable<PageSnapshotReaders['readGithubFile']> = async (target) => {
  const client = new GithubClient(target.token)
  const file = await client.getFileContent(target.owner, target.repo, target.path, target.branch)
  return { content: file.decodedContent, sha: file.sha }
}

const defaultReadWordpressPost: NonNullable<PageSnapshotReaders['readWordpressPost']> = async (target) => {
  const post = await getExistingWordpressPost(target.config, target.postId, target.postType)
  return {
    title: post.title,
    content: post.content,
    seoTitle: post.seoTitle,
    seoDescription: post.seoDescription,
    modified: post.modified,
  }
}

/**
 * 取快照。**不改动传入的 `target` / `readers`**——两者都只读使用。
 */
export async function takePageSnapshot(
  target: PageSnapshotTarget,
  readers: PageSnapshotReaders = {},
): Promise<PageSnapshot> {
  const fetchedAt = new Date().toISOString()

  // switch（而不是两个独立 if）——TS 对「一个联合成员的判别字段本身是多值联合」
  // 这种情况，用 if/早退 的否定路径narrow不干净；switch 的 case 落体对判别式
  // 联合的窄化是可靠的。
  switch (target.provider) {
    case 'shopify':
    case 'none':
      return { ok: false, provider: target.provider, reason: target.reason }

    case 'github': {
      const read = readers.readGithubFile ?? defaultReadGithubFile
      const file = await read(target)
      return {
        ok: true,
        provider: 'github',
        fetchedAt,
        rawContent: file.content,
        versionToken: file.sha,
      }
    }

    case 'wordpress': {
      const read = readers.readWordpressPost ?? defaultReadWordpressPost
      const post = await read(target)
      return {
        ok: true,
        provider: 'wordpress',
        fetchedAt,
        rawFields: {
          title: post.title,
          content: post.content,
          seoTitle: post.seoTitle ?? '',
          seoDescription: post.seoDescription ?? '',
        },
        versionToken: post.modified,
      }
    }
  }
}
