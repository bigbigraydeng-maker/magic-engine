import { describe, expect, it, vi } from 'vitest'
import {
  DEPLOY_GRACE_MINUTES,
  deployCheckFailedItem,
  mainlineOf,
  pushDeployHealthItems,
  renderDeploysUrl,
} from '../deploy-health-items'
import type { ManualItem } from '../manual-item-types'

const ENV = {
  RENDER: 'true',
  RENDER_GIT_COMMIT: 'ab7131ac0000000000000000000000000000abcd',
  RENDER_SERVICE_ID: 'srv-test123',
  GITHUB_TOKEN: 'gh-test',
}

const NOW = new Date('2026-09-25T12:00:00Z')

function ghFetch(status: number, body: unknown) {
  return vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status }))
}

/** One commit as it appears in a GitHub compare response. */
const c = (sha: string, message: string, date: string, parent?: string) => ({
  sha,
  ...(parent ? { parents: [{ sha: parent }] } : {}),
  commit: { message, committer: { date } },
})

describe('deploy health items', () => {
  it('does nothing when not running on Render', async () => {
    const fetchImpl = ghFetch(200, { ahead_by: 5, commits: [] })
    const items: ManualItem[] = []
    await pushDeployHealthItems(items, { RENDER_GIT_COMMIT: 'x' }, fetchImpl, NOW)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(items).toEqual([])
  })

  it('pushes nothing when main is fully live', async () => {
    const fetchImpl = ghFetch(200, { status: 'identical', ahead_by: 0, commits: [] })
    const items: ManualItem[] = []
    await pushDeployHealthItems(items, ENV, fetchImpl, NOW)

    expect(items).toEqual([])
    const call = fetchImpl.mock.calls[0]
    expect(call[0]).toContain('/compare/ab7131ac0000000000000000000000000000abcd...main')
    expect((call[1]?.headers as Record<string, string>).Authorization).toBe('Bearer gh-test')
  })

  it('pushes nothing while a normal deploy is probably still running', async () => {
    const fetchImpl = ghFetch(200, {
      ahead_by: 1,
      commits: [c('aaa1111', 'Merge pull request #2003 from x/y', '2026-09-25T11:50:00Z')],
    })
    const items: ManualItem[] = []
    await pushDeployHealthItems(items, ENV, fetchImpl, NOW)
    expect(items).toEqual([])
  })

  it('pushes one item for the 2026-09-25 incident shape', async () => {
    const fetchImpl = ghFetch(200, {
      ahead_by: 6,
      commits: [
        c('1111111', 'fix: something', '2026-09-25T04:00:00Z', 'ab7131ac0000000000000000000000000000abcd'),
        c(
          '668e2402aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          'Merge pull request #2003 from x/y',
          '2026-09-25T04:45:00Z',
          'ab7131ac0000000000000000000000000000abcd',
        ),
        c('2222222', 'chore: another', '2026-09-25T05:00:00Z', '1111111'),
        // 分支上「把主干拉进来」产生的合并提交，不是一次 PR 合并，不能算数
        c('5555555', "Merge branch 'main' into feat/x", '2026-09-25T05:10:00Z', '2222222'),
        c('3333333', 'Merge pull request #2010 from x/z', '2026-09-25T05:30:00Z', '668e2402aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
        c('4444444', 'Merge pull request #2015 from x/w', '2026-09-25T09:00:00Z', '3333333'),
      ],
    })
    const items: ManualItem[] = []
    await pushDeployHealthItems(items, ENV, fetchImpl, NOW)

    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('deploy_not_live')
    expect(items[0].client_id).toBe('infra')
    expect(items[0].href).toBe('https://dashboard.render.com/web/srv-test123/deploys')
    expect(items[0].what).toContain('PR #2003')
    expect(items[0].what).toContain('3 次合并')
    expect(items[0].what).toContain('7 小时')
    expect(items[0].what).toContain('ab7131a')
    expect(items[0].how).toContain('668e240')
  })

  it('falls back to all commits when there are no merge commits', async () => {
    const fetchImpl = ghFetch(200, {
      ahead_by: 2,
      commits: [
        c('aaaaaaa', 'fix: one', '2026-09-25T10:00:00Z', 'ab7131ac0000000000000000000000000000abcd'),
        c('bbbbbbb', 'fix: two', '2026-09-25T11:00:00Z', 'aaaaaaa'),
      ],
    })
    const items: ManualItem[] = []
    await pushDeployHealthItems(items, ENV, fetchImpl, NOW)

    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('2 个改动')
    expect(items[0].what).toContain('2 小时')
    expect(items[0].what).not.toContain('PR #')
  })

  it('ignores a stacked PR merged into a branch, not main', async () => {
    const fetchImpl = ghFetch(200, {
      ahead_by: 2,
      commits: [
        c(
          '9999999',
          'Merge pull request #1990 from x/stacked',
          '2026-09-20T00:00:00Z',
          'ab7131ac0000000000000000000000000000abcd',
        ),
        c(
          '668e2402aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          'Merge pull request #2003 from x/y',
          '2026-09-25T11:45:00Z',
          'ab7131ac0000000000000000000000000000abcd',
        ),
      ],
    })
    const items: ManualItem[] = []
    await pushDeployHealthItems(items, ENV, fetchImpl, NOW)
    expect(items).toEqual([])
  })

  it('rejects when production is not on the main line', async () => {
    const fetchImpl = ghFetch(200, {
      status: 'diverged',
      ahead_by: 3,
      commits: [c('aaaaaaa', 'fix: one', '2026-09-25T04:00:00Z', 'ab7131ac0000000000000000000000000000abcd')],
    })
    await expect(pushDeployHealthItems([], ENV, fetchImpl, NOW)).rejects.toThrow('diverged')
  })

  it('does nothing when the service deploys a non-main branch', async () => {
    const fetchImpl = ghFetch(200, { ahead_by: 5, commits: [] })
    const items: ManualItem[] = []
    await pushDeployHealthItems(items, { ...ENV, RENDER_GIT_BRANCH: 'feat/x' }, fetchImpl, NOW)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(items).toEqual([])
  })

  it('still checks when the service deploys main', async () => {
    const fetchImpl = ghFetch(200, { status: 'identical', ahead_by: 0, commits: [] })
    const items: ManualItem[] = []
    await pushDeployHealthItems(items, { ...ENV, RENDER_GIT_BRANCH: 'main' }, fetchImpl, NOW)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(items).toEqual([])
  })

  it('says "at least" when GitHub truncated the commit list', async () => {
    const fetchImpl = ghFetch(200, {
      ahead_by: 400,
      total_commits: 400,
      commits: [
        c('1111111', 'Merge pull request #2003 from x/y', '2026-09-25T04:45:00Z'),
        c('2222222', 'Merge pull request #2010 from x/z', '2026-09-25T05:30:00Z'),
        c('3333333', 'Merge pull request #2015 from x/w', '2026-09-25T09:00:00Z'),
      ],
    })
    const items: ManualItem[] = []
    await pushDeployHealthItems(items, ENV, fetchImpl, NOW)

    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('至少 3 次合并')
  })

  it('walks the first-parent line and drops side-branch commits', () => {
    const commits = [
      c('side111', 'fix: side', '2026-09-25T04:00:00Z', 'ab7131ac0000000000000000000000000000abcd'),
      c('main111', 'Merge pull request #2003 from x/y', '2026-09-25T04:45:00Z', 'ab7131ac0000000000000000000000000000abcd'),
      c('main222', 'Merge pull request #2010 from x/z', '2026-09-25T05:30:00Z', 'main111'),
    ]
    expect(mainlineOf(commits).map((x) => x.sha)).toEqual(['main111', 'main222'])
  })

  it('rejects when GITHUB_TOKEN is missing on Render', async () => {
    const fetchImpl = ghFetch(200, { ahead_by: 0 })
    await expect(
      pushDeployHealthItems([], { ...ENV, GITHUB_TOKEN: undefined }, fetchImpl, NOW),
    ).rejects.toThrow('GITHUB_TOKEN')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects when GitHub answers 404', async () => {
    const fetchImpl = ghFetch(404, { message: 'Not Found' })
    await expect(pushDeployHealthItems([], ENV, fetchImpl, NOW)).rejects.toThrow('404')
  })

  it('rejects when the fetch itself throws', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network')
    })
    await expect(pushDeployHealthItems([], ENV, fetchImpl, NOW)).rejects.toThrow()
  })

  it('rejects when GitHub says ahead but gives no commits', async () => {
    const fetchImpl = ghFetch(200, { ahead_by: 3, commits: [] })
    await expect(pushDeployHealthItems([], ENV, fetchImpl, NOW)).rejects.toThrow()
  })

  it('starts alerting exactly at the grace window, not a minute earlier', async () => {
    const at = (minutesAgo: number) =>
      ghFetch(200, {
        ahead_by: 1,
        commits: [
          c('aaa1111', 'Merge pull request #2003 from x/y', new Date(NOW.getTime() - minutesAgo * 60000).toISOString()),
        ],
      })
    const before: ManualItem[] = []
    await pushDeployHealthItems(before, ENV, at(DEPLOY_GRACE_MINUTES - 1), NOW)
    expect(before).toEqual([])

    const onTheDot: ManualItem[] = []
    await pushDeployHealthItems(onTheDot, ENV, at(DEPLOY_GRACE_MINUTES), NOW)
    expect(onTheDot).toHaveLength(1)
    expect(onTheDot[0].what).toContain('30 分钟')
  })

  it('turns a failed check into its own item instead of staying silent', () => {
    const item = deployCheckFailedItem(new Error('GitHub 回了 401'))
    expect(item.kind).toBe('deploy_check_failed')
    expect(item.client_id).toBe('infra')
    expect(item.what).toContain('GitHub 回了 401')
  })

  it('exposes the grace window and the deploys url', () => {
    expect(DEPLOY_GRACE_MINUTES).toBe(30)
    expect(renderDeploysUrl('srv-test123')).toBe('https://dashboard.render.com/web/srv-test123/deploys')
  })
})
