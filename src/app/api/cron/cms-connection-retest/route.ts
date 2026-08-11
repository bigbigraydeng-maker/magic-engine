/**
 * 每天把「坏了」的发布通道重测一遍，让临时故障自己好。
 *
 * 🔴 起因（2026-08-05 实测）：Oztop 的 WordPress 通道 2026-06-19 被标成 error，
 *    原因是客户主机商的安全防护把我们的服务器当机器人拦了。**那天正好是
 *    最后一篇文章成功上线的日子。** 之后 47 天没有任何东西重测过它 ——
 *    全仓没有一个 cron 碰 `cms_connections`，只有人手点「测试连接」才会重测。
 *    一次很可能只持续几分钟的拦截，就这样变成了永久停止发布。
 *
 * 只碰 `status='error'` 的行。**不测正常的连接** —— 把一条好连接因为一次
 * 网络抖动翻成 error，正是上面那场事故的成因。
 *
 * Auth: Bearer ${CRON_SECRET}
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { startCronRun } from '@/lib/cron/run-logger'
import { retestBrokenConnections, classifyFailure } from '@/lib/cms/retest'
import {
  getConnection,
  markConnectionTested,
  getWordpressConnection,
  markWordpressConnectionTested,
} from '@/lib/cms/connection-store'
import { GithubClient, GitHubApiError } from '@/lib/cms/github-client'
import { testWordpressConnection } from '@/lib/cms/wordpress-client'

export const maxDuration = 300

/** 密钥绝不出现在返回值或日志里 —— 照 /cms/test 路由的既有做法。 */
function redact(msg: string): string {
  return msg.replace(/ghp_[A-Za-z0-9]+/g, '[REDACTED]')
}

async function testOne(clientId: string, provider: string): Promise<{ ok: boolean; error?: string }> {
  if (provider === 'wordpress') {
    const conn = await getWordpressConnection(clientId)
    if (!conn) return { ok: false, error: '连接记录不存在' }
    const res = await testWordpressConnection({
      siteUrl: conn.siteUrl,
      username: conn.username,
      appPassword: conn.plainAppPassword,
    })
    return res.ok ? { ok: true } : { ok: false, error: res.error }
  }

  if (provider === 'github') {
    const conn = await getConnection(clientId)
    if (!conn) return { ok: false, error: '连接记录不存在' }
    try {
      await new GithubClient(conn.plainToken).getRepo(conn.repoOwner, conn.repoName)
      return { ok: true }
    } catch (err) {
      const msg =
        err instanceof GitHubApiError
          ? `GitHub ${err.status}: ${redact(err.message)}`
          : 'GitHub API unreachable'
      return { ok: false, error: msg }
    }
  }

  // 认不出的 provider 不动它 —— 别把一条我们不会测的连接判成「测过了还是坏的」
  return { ok: false, error: `暂不支持自动重测的通道类型: ${provider}` }
}

async function markOne(
  clientId: string,
  provider: string,
  ok: boolean,
  error?: string,
): Promise<void> {
  if (provider === 'wordpress') {
    await markWordpressConnectionTested(clientId, ok, error)
    return
  }
  if (provider === 'github') {
    await markConnectionTested(clientId, ok, error)
    return
  }
  // 不支持的类型：什么都不写，保持原状
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'Server misconfiguration: CRON_SECRET not set' },
      { status: 500 },
    )
  }

  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cronRun = await startCronRun('cms-connection-retest')

  try {
    const result = await retestBrokenConnections(
      supabaseAdmin,
      { testConnection: testOne, markTested: markOne },
      new Date(),
    )

    await cronRun.finish({
      processed: result.checked,
      completed: result.recovered,
      failed: result.stillBroken,
      // 一条都没测时要说清是「没有坏连接」还是「都还没到重测间隔」，
      // 否则运行记录看起来跟「跑了但什么都没做」一模一样。
      summary: {
        recovered: result.recovered,
        still_broken: result.stillBroken,
        note:
          result.checked === 0
            ? '本轮没有到期需要重测的坏连接（要么全都是好的，要么离上次测不够 20 小时）'
            : undefined,
        broken_reasons: result.outcomes
          .filter((o) => !o.ok)
          .map((o) => `${o.provider}: ${classifyFailure(o.error)}`),
      },
    })

    return NextResponse.json({
      success: true,
      checked: result.checked,
      recovered: result.recovered,
      still_broken: result.stillBroken,
      outcomes: result.outcomes.map((o) => ({
        client_id: o.client_id,
        provider: o.provider,
        ok: o.ok,
        reason: o.ok ? null : classifyFailure(o.error),
      })),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await cronRun.finish({ failed: 1, error: msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
