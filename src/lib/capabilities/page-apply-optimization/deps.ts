/**
 * page-apply-optimization · dependency injection surface
 *
 * 为什么要 DI：
 *   · **测试**：单元测试要能不发真 GitHub 请求就能跑 §16 的所有断言。
 *   · **架构边界**：capability 层不许自己 import supabaseAdmin
 *     （`kernel/boundaries.ts:113`）；GitHub PAT 从 `connection-store` 拿，
 *     它内部才是 supabaseAdmin 的合法调用方。这里只声明"需要一个能给我 PAT
 *     的函数"，具体实现由调用方注入。
 *
 * 默认 deps 用真实 `getConnection` + 真实 `new GithubClient(token)`；
 * 测试传假 deps。
 */

import { GithubClient } from '@/lib/cms/github-client'
import { getConnection } from '@/lib/cms/connection-store'
import type { PageWriteGuard } from '@/lib/seo/protected-pages'
import { systemPageGuard } from '@/lib/seo/system-page-guard'

export interface GithubConnectionResolution {
  readonly repoOwner: string
  readonly repoName: string
  readonly defaultBranch: string
  readonly contentPaths: readonly string[]
  readonly plainToken: string
}

export interface PageApplyOptimizationDeps {
  /** 解析该客户的 GitHub CMS 连接（含解密后的 PAT）。 */
  readonly resolveGithubConnection: (clientId: string) => Promise<GithubConnectionResolution | null>
  /** 用 PAT 造一个 GitHub 客户端。测试注入假的。 */
  readonly createGithubClient: (token: string) => GithubClient
  /**
   * Protected-page gate for this client. The capability runs inside the Kernel with no logged-in human, so the
   * implementation must use the SYSTEM actor: a protected page is refused here, with no override.
   */
  readonly createPageGuard: (clientId: string) => PageWriteGuard
}

export function defaultDeps(): PageApplyOptimizationDeps {
  return {
    resolveGithubConnection: async (clientId) => {
      const conn = await getConnection(clientId)
      if (!conn) return null
      return {
        repoOwner: conn.repoOwner,
        repoName: conn.repoName,
        defaultBranch: conn.branch || 'main',
        contentPaths: conn.contentPaths ?? [],
        plainToken: conn.plainToken,
      }
    },
    createGithubClient: (token) => new GithubClient(token),
    createPageGuard: (clientId) => systemPageGuard(clientId, 'page-apply-optimization'),
  }
}
