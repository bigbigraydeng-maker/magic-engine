/**
 * 今日待办里的「正式网站已经很久没换上新代码了」（2026-09-25）。
 *
 * 拉模式，跟 `meta-token-health-items.ts` 同一个原则：每次生成待办时直接问一句，
 * 不依赖任何通知送达。正在跑的正式实例自己知道它在服务哪个提交（Render 会把
 * `RENDER_GIT_COMMIT` 注入容器），GitHub 知道主干现在到哪了。主干上有合并还没上线、
 * 而且最早那次合并已经过去超过 30 分钟，就说明上线坏了或者卡住了。
 *
 * 起因：2026-09-25 一个合并提交把主干的编译搞坏了，之后每次正式上线都失败，持续了
 * 大约 7 小时。正式网站一直在服务旧版本，那段时间合进去的东西一个都没上线，可各窗口
 * 还在跟 PM 说「已上线」。没人发现。这个模块就是让 PM 的今日待办把这件事说出来。
 */

import type { ManualItem } from './manual-item-types'
import { APPROVED_REPO } from '@/lib/product-map/types'

export type DeployHealthItemKind = 'deploy_not_live'

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

/** Normal Render build+deploy takes 3-6 minutes; 30 minutes leaves room for a slow build or a queue. */
export const DEPLOY_GRACE_MINUTES = 30

export function renderDeploysUrl(serviceId: string): string {
  return 'https://dashboard.render.com/web/' + serviceId + '/deploys'
}

export interface CompareCommit {
  sha: string
  html_url?: string
  parents?: Array<{ sha: string }>
  commit: {
    message: string
    committer?: { date?: string } | null
  }
}

interface CompareBody {
  status?: string
  ahead_by?: number
  total_commits?: number
  commits?: CompareCommit[]
}

/** 问 GitHub 一句「主干比正在服务的这一版多出哪些提交」。 */
async function fetchCompare(
  live: string,
  token: string,
  fetchImpl: FetchLike,
): Promise<CompareBody> {
  let res: Response
  try {
    res = await fetchImpl(`https://api.github.com/repos/${APPROVED_REPO}/compare/${live}...main`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'magic-engine-deploy-health',
      },
      signal: AbortSignal.timeout(5000),
    })
  } catch (err) {
    throw new Error(`问 GitHub 主干到哪了失败（连不上）：${err instanceof Error ? err.message : String(err)}`)
  }

  if (!res.ok) throw new Error(`问 GitHub 主干到哪了失败：GitHub 回了 ${res.status}`)

  try {
    return (await res.json()) as CompareBody
  } catch {
    throw new Error('问 GitHub 主干到哪了失败：GitHub 回的不是 JSON')
  }
}

/** 这个仓库每个 PR 都用合并提交合进来；PR 分支内部的提交也会出现在 compare 列表里，不能算数。 */
const PR_MERGE = /^Merge pull request #(\d+)/

/**
 * 沿主干那条线（每个提交的第一个上级）从最新往回走，只留主干上的提交，从早到晚。
 *
 * 为什么不能直接用 compare 列表：合进非主干分支的 PR（stacked PR）也会产生一条
 * 「Merge pull request #N」，而且可能是好几天前的。它不在主干的第一个上级线上，
 * 不能拿来当「最早那次没上线的合并」。GitHub 的合并提交第一个上级永远是合并前的主干。
 */
export function mainlineOf(commits: CompareCommit[]): CompareCommit[] {
  const bySha = new Map(commits.map((c) => [c.sha, c]))
  const chain: CompareCommit[] = []
  const seen = new Set<string>()

  let current: CompareCommit | undefined = commits[commits.length - 1]
  while (current && !seen.has(current.sha)) {
    seen.add(current.sha)
    chain.push(current)
    current = bySha.get(current.parents?.[0]?.sha ?? '')
  }

  return chain.reverse()
}

function buildItem(
  serviceId: string,
  live: string,
  first: CompareCommit,
  firstPr: number | null,
  count: number,
  ageMinutes: number,
  atLeast: boolean,
): ManualItem {
  const age = ageMinutes >= 60 ? `${Math.floor(ageMinutes / 60)} 小时` : `${ageMinutes} 分钟`
  const liveShort = live.slice(0, 7)
  const firstShort = first.sha.slice(0, 7)
  const countText = `${atLeast ? '至少 ' : ''}${count}`

  const what =
    firstPr != null
      ? `正式网站已经 ${age} 没换上新代码了：从 PR #${firstPr} 起，主干上 ${countText} 次合并都没上线（网站还停在 ${liveShort} 那一版）。这段时间里各窗口说的「已上线」都不算数。`
      : `正式网站已经 ${age} 没换上新代码了：主干上 ${countText} 个改动都没上线（网站还停在 ${liveShort} 那一版，最早没上线的是 ${firstShort}）。这段时间里各窗口说的「已上线」都不算数。`

  const how =
    `多半是新代码编译不过、上线失败了。打开链接（正式网站的上线记录）看最上面几条标红 Failed 的，点进去看日志最后几行报错；` +
    `问题最可能出在 ${firstPr != null ? `PR #${firstPr}（提交 ${firstShort}）` : `提交 ${firstShort}`}。` +
    `先去 GitHub 看有没有已经开着的修复 PR（https://github.com/${APPROVED_REPO}/pulls），有就让那个窗口尽快合；没有就回我一句「修上线」。` +
    `网站换上新版后这条会自己消失。`

  return {
    kind: 'deploy_not_live',
    client_id: 'infra',
    client_name: 'Magic Engine 后台',
    what,
    how,
    href: renderDeploysUrl(serviceId),
  }
}

/** 从 compare 结果里挑出「最早那次没上线的合并」。 */
function pickPending(
  body: CompareBody,
  commits: CompareCommit[],
): { pending: CompareCommit[]; merges: CompareCommit[]; atLeast: boolean } {
  // GitHub 把列表截断时（>250 个提交）最新那个提交不在里面，第一个上级往回走会从错的地方开始；
  // 退回列表顺序（从早到晚），对「哪次合并最早」来说仍然是对的。
  const truncated = (body.total_commits ?? body.ahead_by ?? 0) > commits.length
  const line = truncated ? commits : mainlineOf(commits)

  const merges = line.filter((c) => PR_MERGE.test(c.commit.message))
  const pending = merges.length > 0 ? merges : line
  return { pending, merges, atLeast: truncated }
}

/** 检查自己没跑成时下发的那条 —— 只打日志就等于这只眼睛瞎了也没人知道。 */
export function deployCheckFailedItem(e: unknown): ManualItem {
  return {
    kind: 'deploy_check_failed',
    client_id: 'infra',
    client_name: 'Magic Engine 后台',
    what: `「合进去的代码有没有上线」的检查自己没跑成（${(e instanceof Error ? e.message : String(e)).slice(0, 160)}）—— 今天不报警不等于上线都正常`,
    how: '这条不用你动手 —— 是我们这边的欠账。回我一句「修一下上线检查」我就去修',
    href: '',
  }
}

export async function pushDeployHealthItems(
  items: ManualItem[],
  env: Record<string, string | undefined> = process.env,
  fetchImpl: FetchLike = fetch,
  now: Date = new Date(),
): Promise<void> {
  // 不在 Render 上跑（本地开发 / 测试）就没有正式上线可查
  if (env.RENDER !== 'true') return

  // 这个服务部署的是别的分支（preview / staging），拿它跟主干比没有意义
  if (env.RENDER_GIT_BRANCH && env.RENDER_GIT_BRANCH !== 'main') return

  const live = env.RENDER_GIT_COMMIT
  const serviceId = env.RENDER_SERVICE_ID
  const token = env.GITHUB_TOKEN
  if (!live) throw new Error('环境变量 RENDER_GIT_COMMIT 没配，没法知道正式网站现在服务的是哪一版')
  if (!serviceId) throw new Error('环境变量 RENDER_SERVICE_ID 没配，没法给出上线记录的链接')
  if (!token) throw new Error('环境变量 GITHUB_TOKEN 没配，没法问 GitHub 主干到哪了')

  const body = await fetchCompare(live, token, fetchImpl)

  // diverged / behind = 正式网站跑的不在主干这条线上（从分支手动部署过）；不猜，报成「判断不了」
  if (body.status !== undefined && body.status !== 'ahead' && body.status !== 'identical') {
    throw new Error(
      `正式网站跑的 ${live.slice(0, 7)} 不在主干这条线上（GitHub 说 ${body.status}），没法判断主干有没有上线`,
    )
  }

  if (!(body.ahead_by && body.ahead_by > 0)) return
  const commits = body.commits
  if (!commits || commits.length === 0) {
    throw new Error('GitHub 说主干有没上线的提交，却没给出是哪些，没法判断')
  }

  const { pending, merges, atLeast } = pickPending(body, commits)
  const first = pending[0]

  const firstAt = new Date(first.commit.committer?.date ?? '')
  if (Number.isNaN(firstAt.getTime())) {
    throw new Error('GitHub 没给出最早那次没上线提交的时间，没法判断卡了多久')
  }

  const ageMinutes = Math.floor((now.getTime() - firstAt.getTime()) / 60000)
  if (ageMinutes < DEPLOY_GRACE_MINUTES) return

  const firstPr = merges.length > 0 ? Number(PR_MERGE.exec(first.commit.message)?.[1]) : null
  items.push(buildItem(serviceId, live, first, firstPr, pending.length, ageMinutes, atLeast))
}
