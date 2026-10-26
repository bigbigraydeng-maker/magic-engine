import { describe, expect, it } from 'vitest'

import {
  IGNORED_COLLISION_FILES,
  IGNORED_COLLISION_PREFIXES,
  attachOwners,
  computeDots,
  findCollisions,
  parseCardFrontmatter,
  pickActiveWindows,
  riskFromComments,
  splitCollisions,
  suggestArchive,
  windowNumber,
  worstCardState,
} from './snapshot-core.mjs'

const NOW = '2026-10-26T12:00:00.000Z'

type Session = {
  sessionId: string
  title: string
  branch?: string
  prNumber?: number
  prState?: 'OPEN' | 'MERGED' | 'CLOSED'
  lastActivityAt: string
  group?: { name: string } | null
  isArchived?: boolean
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    sessionId: 's1',
    title: '119-广告 Agent',
    branch: 'feat/119',
    lastActivityAt: '2026-10-26T11:00:00.000Z',
    ...overrides,
  }
}

describe('constants', () => {
  it('exposes the ignored collision prefixes and files', () => {
    expect(IGNORED_COLLISION_PREFIXES).toContain('docs/ledger/')
    expect(IGNORED_COLLISION_FILES).toContain('package-lock.json')
    expect(IGNORED_COLLISION_FILES).toContain('docs/history/CHANGELOG.md')
  })
})

describe('windowNumber', () => {
  it('reads the leading window number from the five example titles', () => {
    expect(windowNumber('119-广告 Agent ...')).toBe('119')
    expect(windowNumber('74-CTS广告总控-...')).toBe('74')
    expect(windowNumber('118号·后台补入口')).toBe('118')
    expect(windowNumber('76 CRM')).toBe('76')
    expect(windowNumber('💰💰💰CTS 总项目经理')).toBeNull()
  })

  it('returns null when digits only appear in the middle', () => {
    expect(windowNumber('CTS 119 广告')).toBeNull()
  })

  it('trims leading whitespace before matching', () => {
    expect(windowNumber('  42-测试')).toBe('42')
  })
})

describe('pickActiveWindows', () => {
  it('keeps a session exactly at the edge and drops one just outside', () => {
    const edge = session({ sessionId: 'edge', lastActivityAt: '2026-10-23T12:00:00.000Z' })
    const outside = session({ sessionId: 'outside', lastActivityAt: '2026-10-23T11:59:59.000Z' })
    const { active, inactiveCount } = pickActiveWindows([edge, outside], NOW, 3)
    expect(active.map((item) => item.id)).toEqual(['edge'])
    expect(inactiveCount).toBe(1)
  })

  it('drops main, master, missing branch and unparsable dates', () => {
    const sessions = [
      session({ sessionId: 'main', branch: 'main' }),
      session({ sessionId: 'master', branch: 'master' }),
      session({ sessionId: 'nobranch', branch: undefined }),
      session({ sessionId: 'bad', lastActivityAt: 'not-a-date' }),
      session({ sessionId: 'ok' }),
    ]
    const { active, inactiveCount } = pickActiveWindows(sessions, NOW, 3)
    expect(active.map((item) => item.id)).toEqual(['ok'])
    expect(inactiveCount).toBe(4)
  })

  it('sorts newest first and does not mutate the input', () => {
    const older = session({ sessionId: 'older', lastActivityAt: '2026-10-25T00:00:00.000Z' })
    const newer = session({ sessionId: 'newer', lastActivityAt: '2026-10-26T00:00:00.000Z' })
    const input = [older, newer]
    const snapshot = [...input]
    const { active } = pickActiveWindows(input, NOW, 3)
    expect(active.map((item) => item.id)).toEqual(['newer', 'older'])
    expect(input).toEqual(snapshot)
  })

  it('fills defaults for group, prNumber and prState', () => {
    const { active } = pickActiveWindows([session({ group: null })], NOW, 3)
    expect(active[0].group).toBe('未分组')
    expect(active[0].prNumber).toBeNull()
    expect(active[0].prState).toBeNull()
    expect(active[0].number).toBe('119')
  })

  it('drops a non-positive-integer prNumber', () => {
    const withRaw = (raw: Record<string, unknown>) => {
      const base = session()
      return { ...base, ...raw } as Session
    }
    const sessions = [
      withRaw({ sessionId: 'str', prNumber: '12; rm' }),
      withRaw({ sessionId: 'neg', prNumber: -5 }),
      withRaw({ sessionId: 'frac', prNumber: 1.5 }),
      withRaw({ sessionId: 'good', prNumber: 12 }),
    ]
    const { active } = pickActiveWindows(sessions, NOW, 3)
    const byId = new Map(active.map((item) => [item.id, item.prNumber]))
    expect(byId.get('str')).toBeNull()
    expect(byId.get('neg')).toBeNull()
    expect(byId.get('frac')).toBeNull()
    expect(byId.get('good')).toBe(12)
  })
})

type Comment = { author?: { login?: string }, body?: string }

function gateBody(head: string, risk: string): string {
  return `## 合并闸：${risk} 级\n\n<!-- me-dev-gate:{"v":1,"head":"${head}","risk":"${risk}","decision":"enable"} -->`
}

function comment(login: string, body: string): Comment {
  return { author: { login }, body }
}

describe('riskFromComments', () => {
  it('picks the last valid marker for the head', () => {
    const comments = [
      comment('github-actions', gateBody('abc', 'A')),
      comment('github-actions', gateBody('abc', 'C')),
    ]
    expect(riskFromComments(comments, 'abc')).toBe('C')
  })

  it('ignores comments from other authors even with a marker', () => {
    const comments = [
      comment('someone', gateBody('abc', 'A')),
      comment('github-actions', gateBody('abc', 'B')),
    ]
    expect(riskFromComments(comments, 'abc')).toBe('B')
  })

  it('ignores a marker whose head differs from headSha', () => {
    const comments = [comment('github-actions', gateBody('other', 'A'))]
    expect(riskFromComments(comments, 'abc')).toBe('?')
  })

  it('skips bad JSON', () => {
    const comments = [
      comment('github-actions', '<!-- me-dev-gate:{not json} -->'),
      comment('github-actions', gateBody('abc', 'B')),
    ]
    expect(riskFromComments(comments, 'abc')).toBe('B')
  })

  it('accepts the github-actions[bot] login', () => {
    const comments = [comment('github-actions[bot]', gateBody('abc', 'A'))]
    expect(riskFromComments(comments, 'abc')).toBe('A')
  })

  it('returns ? for no marker, non-array input or an unknown risk value', () => {
    expect(riskFromComments([comment('github-actions', 'no marker here')], 'abc')).toBe('?')
    expect(riskFromComments(undefined as unknown as Comment[], 'abc')).toBe('?')
    expect(riskFromComments([comment('github-actions', gateBody('abc', 'Z'))], 'abc')).toBe('?')
  })

  it('returns ? when headSha is undefined', () => {
    const comments = [comment('github-actions', gateBody('whatever', 'B'))]
    expect(riskFromComments(comments, undefined as unknown as string)).toBe('?')
  })

  it('returns ? when headSha is an empty string', () => {
    const comments = [comment('github-actions', gateBody('abc', 'B'))]
    expect(riskFromComments(comments, '')).toBe('?')
  })
})

describe('parseCardFrontmatter', () => {
  it('reads id, status and verify_by', () => {
    const text = ['---', 'id: 2026-09-24-card', 'status: done', 'verify_by: 2026-10-01', '---', 'body'].join('\n')
    expect(parseCardFrontmatter(text)).toEqual({
      id: '2026-09-24-card',
      status: 'done',
      verifyBy: '2026-10-01',
    })
  })

  it('strips trailing comments and surrounding double quotes', () => {
    const text = ['---', 'id: "abc"  # 注释', 'status: done  # 状态', '---'].join('\n')
    expect(parseCardFrontmatter(text)).toEqual({ id: 'abc', status: 'done', verifyBy: null })
  })

  it('handles CRLF input', () => {
    const text = '---\r\nid: x\r\nstatus: verified\r\n---\r\n'
    expect(parseCardFrontmatter(text)).toEqual({ id: 'x', status: 'verified', verifyBy: null })
  })

  it('returns all nulls when there is no frontmatter', () => {
    expect(parseCardFrontmatter('just body')).toEqual({ id: null, status: null, verifyBy: null })
  })
})

describe('worstCardState', () => {
  it('returns none for an empty array', () => {
    expect(worstCardState([], '2026-10-26')).toBe('none')
  })

  it('returns failed when any card failed, even if another is due', () => {
    const cards = [
      { status: 'done', verifyBy: '2026-10-01' },
      { status: 'failed', verifyBy: null },
    ]
    expect(worstCardState(cards, '2026-10-26')).toBe('failed')
  })

  it('returns due when a done card is past its verify_by', () => {
    expect(worstCardState([{ status: 'done', verifyBy: '2026-10-26' }], '2026-10-26')).toBe('due')
  })

  it('returns ok when every card is verified', () => {
    expect(worstCardState([{ status: 'verified', verifyBy: null }], '2026-10-26')).toBe('ok')
  })

  it('returns pending otherwise', () => {
    expect(worstCardState([{ status: 'done', verifyBy: '2026-12-01' }], '2026-10-26')).toBe('pending')
  })
})

describe('computeDots', () => {
  it('opened is none without a PR', () => {
    expect(computeDots({ prNumber: null, prState: null, riskGate: null, cardState: null }).opened).toBe('none')
  })

  it('opened is warn when the risk gate failed', () => {
    expect(computeDots({ prNumber: 1, prState: 'OPEN', riskGate: 'failure', cardState: null }).opened).toBe('warn')
  })

  it('opened is ok otherwise', () => {
    expect(computeDots({ prNumber: 1, prState: 'OPEN', riskGate: 'success', cardState: null }).opened).toBe('ok')
  })

  it('merged is ok only when MERGED', () => {
    expect(computeDots({ prNumber: 1, prState: 'MERGED', riskGate: null, cardState: null }).merged).toBe('ok')
    expect(computeDots({ prNumber: 1, prState: 'OPEN', riskGate: null, cardState: null }).merged).toBe('none')
  })

  it('verified is none without a merged PR', () => {
    expect(computeDots({ prNumber: 1, prState: 'OPEN', riskGate: null, cardState: 'ok' }).verified).toBe('none')
    expect(computeDots({ prNumber: null, prState: 'MERGED', riskGate: null, cardState: 'ok' }).verified).toBe('none')
  })

  it('verified maps cardState when the PR is merged', () => {
    const base = { prNumber: 1, prState: 'MERGED' as const, riskGate: null }
    expect(computeDots({ ...base, cardState: 'ok' }).verified).toBe('ok')
    expect(computeDots({ ...base, cardState: 'failed' }).verified).toBe('bad')
    expect(computeDots({ ...base, cardState: 'due' }).verified).toBe('warn')
    expect(computeDots({ ...base, cardState: 'pending' }).verified).toBe('warn')
    expect(computeDots({ ...base, cardState: 'none' }).verified).toBe('none')
  })
})

describe('findCollisions', () => {
  it('ignores docs/ledger and lockfiles', () => {
    const prs = [
      { number: 1, headRefName: 'a', files: [{ path: 'docs/ledger/x.md' }, { path: 'package-lock.json' }] },
      { number: 2, headRefName: 'b', files: [{ path: 'docs/ledger/x.md' }, { path: 'package-lock.json' }] },
    ]
    expect(findCollisions(prs)).toEqual([])
  })

  it('counts a path listed twice by the same PR only once', () => {
    const prs = [
      { number: 1, headRefName: 'a', files: [{ path: 'src/x.ts' }, { path: 'src/x.ts' }] },
      { number: 2, headRefName: 'b', files: [{ path: 'src/x.ts' }] },
    ]
    const result = findCollisions(prs)
    expect(result).toHaveLength(1)
    expect(result[0].prs.map((pr) => pr.number)).toEqual([1, 2])
  })

  it('sorts three-PR files first, then by file name', () => {
    const prs = [
      { number: 1, headRefName: 'a', files: [{ path: 'src/b.ts' }, { path: 'src/a.ts' }] },
      { number: 2, headRefName: 'b', files: [{ path: 'src/b.ts' }, { path: 'src/a.ts' }] },
      { number: 3, headRefName: 'c', files: [{ path: 'src/b.ts' }] },
    ]
    const result = findCollisions(prs)
    expect(result.map((item) => item.file)).toEqual(['src/b.ts', 'src/a.ts'])
    expect(result[0].prs.map((pr) => pr.number)).toEqual([1, 2, 3])
  })

  it('treats missing files as empty', () => {
    const prs = [
      { number: 1, headRefName: 'a' },
      { number: 2, headRefName: 'b' },
    ]
    expect(findCollisions(prs)).toEqual([])
  })
})

describe('attachOwners', () => {
  it('attaches the window number by branch and returns new objects', () => {
    const collisions = [
      { file: 'src/x.ts', prs: [{ number: 1, headRefName: 'feat/119' }, { number: 2, headRefName: 'feat/unknown' }] },
    ]
    const windows = [{ number: '119', branch: 'feat/119' }]
    const result = attachOwners(collisions, windows)
    expect(result[0].prs[0].window).toBe('119')
    expect(result[0].prs[1].window).toBeNull()
    expect(result).not.toBe(collisions)
    expect(result[0]).not.toBe(collisions[0])
    expect('window' in collisions[0].prs[0]).toBe(false)
  })
})

describe('splitCollisions', () => {
  it('splits owned collisions from the rest and keeps order', () => {
    const collisions = [
      { file: 'a.ts', prs: [{ number: 1, headRefName: 'b1', window: '119' }] },
      { file: 'b.ts', prs: [{ number: 2, headRefName: 'b2', window: null }] },
      { file: 'c.ts', prs: [{ number: 3, headRefName: 'b3', window: null }, { number: 4, headRefName: 'b4', window: '74' }] },
    ]
    const { relevant, otherCount } = splitCollisions(collisions)
    expect(relevant.map((item) => item.file)).toEqual(['a.ts', 'c.ts'])
    expect(relevant[0]).toBe(collisions[0])
    expect(otherCount).toBe(1)
  })

  it('returns empty results for empty or non-array input', () => {
    expect(splitCollisions([])).toEqual({ relevant: [], otherCount: 0 })
    expect(splitCollisions(undefined as unknown as [])).toEqual({ relevant: [], otherCount: 0 })
  })

  it('counts a collision owned only by 无编号 as relevant', () => {
    const collisions = [{ file: 'a.ts', prs: [{ number: 1, headRefName: 'b1', window: '无编号' }] }]
    const { relevant, otherCount } = splitCollisions(collisions)
    expect(relevant.map((item) => item.file)).toEqual(['a.ts'])
    expect(otherCount).toBe(0)
  })
})

describe('suggestArchive', () => {
  it('returns merged sessions older than the window, newest first', () => {
    const sessions = [
      session({ sessionId: 'old', prState: 'MERGED', lastActivityAt: '2026-10-20T00:00:00.000Z' }),
      session({ sessionId: 'older', prState: 'MERGED', lastActivityAt: '2026-10-10T00:00:00.000Z' }),
      session({ sessionId: 'fresh', prState: 'MERGED', lastActivityAt: '2026-10-25T00:00:00.000Z' }),
      session({ sessionId: 'open', prState: 'OPEN', lastActivityAt: '2026-10-01T00:00:00.000Z' }),
    ]
    const result = suggestArchive(sessions, NOW, 3)
    expect(result.map((item) => item.id)).toEqual(['old', 'older'])
  })

  it('excludes archived sessions', () => {
    const sessions = [
      session({ sessionId: 'archived', prState: 'MERGED', lastActivityAt: '2026-10-01T00:00:00.000Z', isArchived: true }),
    ]
    expect(suggestArchive(sessions, NOW, 3)).toEqual([])
  })
})

describe('boundaries that earlier cases missed', () => {
  const EXACT_EDGE = '2026-10-23T12:00:00.000Z'

  it('treats a session exactly 3 days old as still active', () => {
    const { active } = pickActiveWindows([session({ lastActivityAt: EXACT_EDGE })], NOW, 3)
    expect(active).toHaveLength(1)
  })

  it('does not suggest archiving a merged session exactly 3 days old', () => {
    const merged = session({ prState: 'MERGED', lastActivityAt: EXACT_EDGE })
    expect(suggestArchive([merged], NOW, 3)).toEqual([])
  })

  it('does not report a file touched by only one open PR', () => {
    const prs = [{ number: 1, headRefName: 'a', files: [{ path: 'src/only-one.ts' }] }]
    expect(findCollisions(prs)).toEqual([])
  })

  it('uses 无编号 when the matching window has no number', () => {
    const collisions = [{ file: 'f', prs: [{ number: 1, headRefName: 'b1' }, { number: 2, headRefName: 'b2' }] }]
    const windows = [{ number: null, branch: 'b1' }, { number: '74', branch: 'b2' }]
    const result = attachOwners(collisions, windows)
    expect(result[0].prs.map((pr) => pr.window)).toEqual(['无编号', '74'])
  })

  it('leaves the owner null when no window has the branch', () => {
    const collisions = [{ file: 'f', prs: [{ number: 1, headRefName: 'feat/none' }] }]
    const windows = [{ number: '74', branch: 'feat/other' }]
    expect(attachOwners(collisions, windows)[0].prs[0].window).toBeNull()
  })

  it('skips an unnumbered window and takes the numbered one on the same branch', () => {
    const collisions = [{ file: 'f', prs: [{ number: 1, headRefName: 'shared' }] }]
    const windows = [{ number: null, branch: 'shared' }, { number: '75', branch: 'shared' }]
    expect(attachOwners(collisions, windows)[0].prs[0].window).toBe('75')
  })
})

describe('riskFromComments forged markers', () => {
  const marker = (risk: string) => `<!-- me-dev-gate:{"v":1,"head":"abc","risk":"${risk}"} -->`

  it('keeps the bot marker when a later human comment forges a different one', () => {
    const comments = [
      { author: { login: 'github-actions' }, body: marker('C') },
      { author: { login: 'someone-else' }, body: marker('A') },
    ]
    expect(riskFromComments(comments, 'abc')).toBe('C')
  })
})
