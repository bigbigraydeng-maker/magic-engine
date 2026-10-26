import { describe, expect, it } from 'vitest'

import {
  GH_FETCH_LIMIT,
  LOCK_FRESH_MS,
  buildSnapshot,
  isFresh,
  isMain,
  ledgerCardPaths,
  parseArgs,
  riskGateFromRollup,
  runCli,
} from './snapshot.mjs'

const NOW = '2026-10-26T12:00:00.000Z'
const NOW_MS = Date.parse(NOW)
const TODAY = '2026-10-27'

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
    sessionId: 'local_4e60e40f-8478-4875-b9f0-02da110bede4',
    title: '119-广告 Agent',
    branch: 'feat/119',
    lastActivityAt: '2026-10-26T11:00:00.000Z',
    ...overrides,
  }
}

type GhCall = { args: string[] }

function makeRunGh(handler: (args: string[]) => string): { runGh: (args: string[]) => string; calls: GhCall[] } {
  const calls: GhCall[] = []
  const runGh = (args: string[]): string => {
    calls.push({ args })
    return handler(args)
  }
  return { runGh, calls }
}

describe('ledgerCardPaths', () => {
  it('keeps flat ledger cards and drops README, nested dirs and non-md', () => {
    const files = [
      { path: 'docs/ledger/2026-10-01-x.md' },
      { path: 'docs/ledger/README.md' },
      { path: 'docs/ledger/nested/y.md' },
      { path: 'docs/ledger/notes.txt' },
      { path: 'src/a.ts' },
    ]
    expect(ledgerCardPaths(files)).toEqual(['docs/ledger/2026-10-01-x.md'])
  })

  it('returns [] for non-array input', () => {
    expect(ledgerCardPaths(undefined as unknown as Array<{ path: string }>)).toEqual([])
  })
})

describe('riskGateFromRollup', () => {
  it('reads SUCCESS from a check run', () => {
    expect(riskGateFromRollup([{ name: 'Risk gate', status: 'COMPLETED', conclusion: 'SUCCESS' }])).toBe('success')
  })

  it('reads failure from FAILURE / TIMED_OUT / CANCELLED', () => {
    expect(riskGateFromRollup([{ name: 'Risk gate', conclusion: 'FAILURE' }])).toBe('failure')
    expect(riskGateFromRollup([{ name: 'Risk gate', conclusion: 'TIMED_OUT' }])).toBe('failure')
    expect(riskGateFromRollup([{ name: 'Risk gate', conclusion: 'CANCELLED' }])).toBe('failure')
  })

  it('reads failure from a StatusContext with state FAILURE or ERROR', () => {
    expect(riskGateFromRollup([{ context: 'Risk gate', state: 'FAILURE' }])).toBe('failure')
    expect(riskGateFromRollup([{ context: 'Risk gate', state: 'ERROR' }])).toBe('failure')
  })

  it('reads success from a StatusContext with state SUCCESS', () => {
    expect(riskGateFromRollup([{ context: 'Risk gate', state: 'SUCCESS' }])).toBe('success')
  })

  it('returns pending when found but neither success nor failure', () => {
    expect(riskGateFromRollup([{ name: 'Risk gate', status: 'IN_PROGRESS' }])).toBe('pending')
  })

  it('returns unknown when missing or not an array', () => {
    expect(riskGateFromRollup([{ name: 'Other', conclusion: 'SUCCESS' }])).toBe('unknown')
    expect(riskGateFromRollup(undefined)).toBe('unknown')
    expect(riskGateFromRollup(null as unknown as undefined)).toBe('unknown')
  })
})

describe('isFresh', () => {
  it('returns false for null or garbage', () => {
    expect(isFresh(null, NOW_MS)).toBe(false)
    expect(isFresh('not-a-date', NOW_MS)).toBe(false)
  })

  it('returns false exactly at the limit', () => {
    const at = new Date(NOW_MS - LOCK_FRESH_MS).toISOString()
    expect(isFresh(at, NOW_MS)).toBe(false)
  })

  it('returns true just inside the limit', () => {
    const at = new Date(NOW_MS - LOCK_FRESH_MS + 1).toISOString()
    expect(isFresh(at, NOW_MS)).toBe(true)
  })

  it('returns false for a future timestamp', () => {
    const at = new Date(NOW_MS + 1000).toISOString()
    expect(isFresh(at, NOW_MS)).toBe(false)
  })
})

describe('parseArgs', () => {
  it('parses all flags', () => {
    const result = parseArgs([
      '--sessions',
      's.json',
      '--out-dir',
      'out',
      '--today',
      '2026-10-27',
      '--now',
      NOW,
      '--force',
    ])
    expect(result).toEqual({ sessions: 's.json', outDir: 'out', today: '2026-10-27', now: NOW, force: true })
  })

  it('throws on an unknown flag', () => {
    expect(() => parseArgs(['--bogus'])).toThrow('不认识的参数 --bogus')
  })

  it('throws when a value is missing', () => {
    expect(() => parseArgs(['--sessions'])).toThrow('--sessions 缺少值')
    expect(() => parseArgs(['--out-dir', '--force'])).toThrow('--out-dir 缺少值')
  })
})

describe('buildSnapshot', () => {
  function baseDeps(overrides: {
    sessions?: Session[]
    runGh?: (args: string[]) => string
    readLedgerCard?: (path: string) => string | null
  } = {}) {
    return {
      sessions: overrides.sessions ?? [],
      nowIso: NOW,
      today: TODAY,
      runGh: overrides.runGh ?? (() => '[]'),
      readLedgerCard: overrides.readLedgerCard ?? (() => null),
    }
  }

  it('builds windows, dots, collisions and card state', () => {
    const sessions: Session[] = [
      session({ sessionId: 'local_open', title: '119-广告 Agent', branch: 'feat/119', prNumber: 10, prState: 'OPEN' }),
      session({ sessionId: 'local_merged', title: '74-CTS广告总控', branch: 'feat/74', prNumber: 11, prState: 'MERGED' }),
      session({ sessionId: 'local_old', title: '76 CRM', branch: 'feat/76', lastActivityAt: '2026-10-01T00:00:00.000Z' }),
    ]

    const openList = [
      { number: 10, title: 'a', headRefName: 'feat/119', files: [{ path: 'src/a.ts' }] },
      { number: 11, title: 'b', headRefName: 'feat/74', files: [{ path: 'src/a.ts' }] },
    ]

    const { runGh } = makeRunGh((args) => {
      if (args[0] === 'pr' && args[1] === 'list') return JSON.stringify(openList)
      if (args[0] === 'pr' && args[1] === 'view') {
        const num = Number(args[2])
        if (num === 10) {
          return JSON.stringify({
            files: [],
            statusCheckRollup: [{ name: 'Risk gate', conclusion: 'SUCCESS' }],
            comments: [
              {
                author: { login: 'github-actions' },
                body: '<!-- me-dev-gate:{"v":1,"head":"h10","risk":"B"} -->',
              },
            ],
            headRefOid: 'h10',
          })
        }
        if (num === 11) {
          return JSON.stringify({
            files: [{ path: 'docs/ledger/2026-10-01-x.md' }],
            statusCheckRollup: [{ name: 'Risk gate', conclusion: 'SUCCESS' }],
            comments: [],
            headRefOid: 'h11',
          })
        }
      }
      return '[]'
    })

    const model = buildSnapshot(
      baseDeps({
        sessions,
        runGh,
        readLedgerCard: (path) =>
          path === 'docs/ledger/2026-10-01-x.md'
            ? '---\nid: x\nstatus: verified\nverify_by: 2026-10-20\n---\nbody'
            : null,
      }),
    )

    expect(model.windows).toHaveLength(2)
    expect(model.inactiveCount).toBe(1)

    const open = model.windows.find((w) => w.prNumber === 10)
    const merged = model.windows.find((w) => w.prNumber === 11)
    expect(open).toBeDefined()
    expect(merged).toBeDefined()
    if (!open || !merged) throw new Error('missing window')

    expect(open.risk).toBe('B')
    expect(open.dots).toEqual({ opened: 'ok', merged: 'none', verified: 'none' })

    expect(merged.risk).toBe('?')
    expect(merged.dots).toEqual({ opened: 'ok', merged: 'ok', verified: 'ok' })

    expect(model.collisions).toHaveLength(1)
    expect(model.collisions[0].file).toBe('src/a.ts')
    expect(model.collisions[0].prs.map((pr) => pr.number)).toEqual([10, 11])
    expect(model.collisions[0].prs.map((pr) => pr.window)).toEqual(['119', '74'])
    expect(model.collisionsOtherCount).toBe(0)

    expect(model.errors).toEqual([])
  })

  it('counts collisions that belong to no active window as other', () => {
    const openList = [
      { number: 20, title: 'c', headRefName: 'feat/20', files: [{ path: 'src/b.ts' }] },
      { number: 21, title: 'd', headRefName: 'feat/21', files: [{ path: 'src/b.ts' }] },
    ]
    const { runGh } = makeRunGh((args) => {
      if (args[0] === 'pr' && args[1] === 'list') return JSON.stringify(openList)
      return '[]'
    })
    const model = buildSnapshot(baseDeps({ runGh }))
    expect(model.collisions).toEqual([])
    expect(model.collisionsOtherCount).toBe(1)
  })

  it('gives risk ? when the gate marker head differs from headRefOid', () => {
    const { runGh } = makeRunGh((args) => {
      if (args[0] === 'pr' && args[1] === 'list') return '[]'
      if (args[0] === 'pr' && args[1] === 'view') {
        return JSON.stringify({
          files: [],
          statusCheckRollup: [{ name: 'Risk gate', conclusion: 'SUCCESS' }],
          comments: [
            {
              author: { login: 'github-actions' },
              body: '<!-- me-dev-gate:{"v":1,"head":"old","risk":"A"} -->',
            },
          ],
          headRefOid: 'new',
        })
      }
      return '[]'
    })
    const model = buildSnapshot(
      baseDeps({
        sessions: [session({ prNumber: 10, prState: 'OPEN' })],
        runGh,
      }),
    )
    expect(model.windows[0].risk).toBe('?')
  })

  it('records a generic error and no collisions when the PR list throws', () => {
    const { runGh } = makeRunGh(() => {
      throw new Error('SECRET-OUTPUT-XYZ')
    })
    const model = buildSnapshot(
      baseDeps({
        sessions: [session({ prNumber: 10, prState: 'OPEN' })],
        runGh,
      }),
    )
    expect(model.collisions).toEqual([])
    expect(model.errors).toContain('GitHub 开着的 PR 列表没取到，撞车检查是空的，不代表没有撞车')
    for (const err of model.errors) {
      expect(err).not.toContain('SECRET-OUTPUT-XYZ')
    }
  })

  it('adds the over-limit error when the list has exactly GH_FETCH_LIMIT items', () => {
    const items = Array.from({ length: GH_FETCH_LIMIT }, (_, i) => ({
      number: i + 1,
      title: `t${i}`,
      headRefName: `b${i}`,
      files: [],
    }))
    const { runGh } = makeRunGh((args) => {
      if (args[0] === 'pr' && args[1] === 'list') return JSON.stringify(items)
      return '[]'
    })
    const model = buildSnapshot(baseDeps({ runGh }))
    expect(model.errors).toContain('GitHub 开着的 PR 超过 300 个，撞车检查只看了前 300 个')
  })
})

type FakeIo = {
  readFile: (path: string) => string
  writeFile: (path: string, text: string) => void
  exists: (path: string) => boolean
  mkdirp: (path: string) => void
  runGh: (args: string[]) => string
  now: () => number
  log: (text: string) => void
  repoRoot: string
}

function makeFakeIo(initial: Record<string, string>, ghHandler: (args: string[]) => string): {
  io: FakeIo
  files: Map<string, string>
  writes: string[]
  logs: string[]
  ghCalls: GhCall[]
} {
  const files = new Map<string, string>(Object.entries(initial))
  const writes: string[] = []
  const logs: string[] = []
  const ghCalls: GhCall[] = []

  const io: FakeIo = {
    readFile: (path) => {
      const text = files.get(path)
      if (text === undefined) throw new Error(`ENOENT ${path}`)
      return text
    },
    writeFile: (path, text) => {
      writes.push(path)
      files.set(path, text)
    },
    exists: (path) => files.has(path),
    mkdirp: () => {},
    runGh: (args) => {
      ghCalls.push({ args })
      return ghHandler(args)
    },
    now: () => NOW_MS,
    log: (text) => {
      logs.push(text)
    },
    repoRoot: '/repo',
  }

  return { io, files, writes, logs, ghCalls }
}

const SESSIONS_FIXTURE: Session[] = [
  session({
    sessionId: 'local_open',
    title: 'SECRET-TITLE-ALPHA',
    branch: 'feat/119',
    prNumber: 10,
    prState: 'OPEN',
  }),
]

function defaultGh(args: string[]): string {
  if (args[0] === 'pr' && args[1] === 'list') {
    return JSON.stringify([
      { number: 10, title: 'a', headRefName: 'feat/119', files: [{ path: 'src/a.ts' }] },
    ])
  }
  if (args[0] === 'pr' && args[1] === 'view') {
    return JSON.stringify({ files: [], statusCheckRollup: [{ name: 'Risk gate', conclusion: 'SUCCESS' }] })
  }
  return '[]'
}

describe('runCli', () => {
  it('writes the three output files plus the lock and returns 0', () => {
    const { io, writes, files } = makeFakeIo(
      { '/sessions.json': JSON.stringify(SESSIONS_FIXTURE) },
      defaultGh,
    )
    const code = runCli(['--sessions', '/sessions.json', '--out-dir', '/out'], io)
    expect(code).toBe(0)
    expect(writes).toContain('/out/snapshot.json')
    expect(writes).toContain('/out/snapshot-full.html')
    expect(writes).toContain('/out/snapshot-mobile.html')
    expect(writes).toContain('/out/.snapshot.lock')
    expect(files.has('/out/snapshot.json')).toBe(true)
  })

  it('does not leak the secret title into the mobile html', () => {
    const { io, files } = makeFakeIo(
      { '/sessions.json': JSON.stringify(SESSIONS_FIXTURE) },
      defaultGh,
    )
    runCli(['--sessions', '/sessions.json', '--out-dir', '/out'], io)
    const mobile = files.get('/out/snapshot-mobile.html') ?? ''
    expect(mobile).not.toContain('SECRET-TITLE-ALPHA')
    const full = files.get('/out/snapshot-full.html') ?? ''
    expect(full).toContain('SECRET-TITLE-ALPHA')
  })

  it('reuses the previous result within 10 minutes without calling gh', () => {
    const { io, logs, ghCalls } = makeFakeIo(
      {
        '/sessions.json': JSON.stringify(SESSIONS_FIXTURE),
        '/out/.snapshot.lock': NOW,
        '/out/snapshot.json': '{"errors":[]}',
      },
      defaultGh,
    )
    const code = runCli(['--sessions', '/sessions.json', '--out-dir', '/out'], io)
    expect(code).toBe(0)
    expect(logs).toContain('10 分钟内已经跑过，沿用上一份结果')
    expect(ghCalls).toHaveLength(0)
  })

  it('returns 2 when reusing a previous result that had errors', () => {
    const { io, logs, ghCalls } = makeFakeIo(
      {
        '/sessions.json': JSON.stringify(SESSIONS_FIXTURE),
        '/out/.snapshot.lock': NOW,
        '/out/snapshot.json': '{"errors":["x"]}',
      },
      defaultGh,
    )
    const code = runCli(['--sessions', '/sessions.json', '--out-dir', '/out'], io)
    expect(code).toBe(2)
    expect(logs).toContain('10 分钟内已经跑过，沿用上一份结果')
    expect(logs).toContain('上一份结果里有数据没取到，页面上已标红')
    expect(ghCalls).toHaveLength(0)
  })

  it('runs again when the lock is fresh but snapshot.json is not valid json', () => {
    const { io, ghCalls } = makeFakeIo(
      {
        '/sessions.json': JSON.stringify(SESSIONS_FIXTURE),
        '/out/.snapshot.lock': NOW,
        '/out/snapshot.json': 'not json',
      },
      defaultGh,
    )
    const code = runCli(['--sessions', '/sessions.json', '--out-dir', '/out'], io)
    expect(code).toBe(0)
    expect(ghCalls.length).toBeGreaterThan(0)
  })

  it('runs again with --force', () => {
    const { io, ghCalls } = makeFakeIo(
      {
        '/sessions.json': JSON.stringify(SESSIONS_FIXTURE),
        '/out/.snapshot.lock': NOW,
        '/out/snapshot.json': '{}',
      },
      defaultGh,
    )
    const code = runCli(['--sessions', '/sessions.json', '--out-dir', '/out', '--force'], io)
    expect(code).toBe(0)
    expect(ghCalls.length).toBeGreaterThan(0)
  })

  it('returns 2 when gh throws', () => {
    const { io } = makeFakeIo(
      { '/sessions.json': JSON.stringify(SESSIONS_FIXTURE) },
      () => {
        throw new Error('boom')
      },
    )
    const code = runCli(['--sessions', '/sessions.json', '--out-dir', '/out'], io)
    expect(code).toBe(2)
  })

  it('returns 1 with a usage message when --sessions is missing', () => {
    const { io, logs } = makeFakeIo({}, defaultGh)
    const code = runCli(['--out-dir', '/out'], io)
    expect(code).toBe(1)
    expect(logs.some((line) => line.startsWith('用法：'))).toBe(true)
  })

  it('accepts a sessions file that is an object with a sessions array', () => {
    const { io, files } = makeFakeIo(
      { '/sessions.json': JSON.stringify({ sessions: SESSIONS_FIXTURE }) },
      defaultGh,
    )
    const code = runCli(['--sessions', '/sessions.json', '--out-dir', '/out'], io)
    expect(code).toBe(0)
    const snapshot = files.get('/out/snapshot.json') ?? ''
    expect(snapshot).toContain('SECRET-TITLE-ALPHA')
  })

  it('never writes outside the out dir', () => {
    const { io, writes } = makeFakeIo(
      { '/sessions.json': JSON.stringify(SESSIONS_FIXTURE) },
      defaultGh,
    )
    runCli(['--sessions', '/sessions.json', '--out-dir', '/out'], io)
    expect(writes.length).toBeGreaterThan(0)
    for (const path of writes) {
      expect(path.startsWith('/out/')).toBe(true)
    }
  })
})

describe('risk gate only matters while the PR is open', () => {
  const failing = JSON.stringify({ files: [], statusCheckRollup: [{ name: 'Risk gate', conclusion: 'FAILURE' }] })
  const deps = (prState: 'OPEN' | 'MERGED') => ({
    sessions: [session({ prNumber: 5, prState })],
    nowIso: NOW,
    today: TODAY,
    runGh: (args: string[]) => (args[1] === 'list' ? '[]' : failing),
    readLedgerCard: () => null,
  })

  it('warns on an open PR whose Risk gate failed', () => {
    expect(buildSnapshot(deps('OPEN')).windows[0].dots.opened).toBe('warn')
  })

  it('does not warn on a merged PR with an old failed Risk gate', () => {
    expect(buildSnapshot(deps('MERGED')).windows[0].dots.opened).toBe('ok')
  })
})

describe('isMain', () => {
  it('does not treat a plain import as the main module', () => {
    expect(isMain()).toBe(false)
  })
})

describe('runCli lock without a previous result', () => {
  it('runs again when the lock is fresh but snapshot.json is missing', () => {
    const { io, ghCalls } = makeFakeIo(
      { '/sessions.json': JSON.stringify(SESSIONS_FIXTURE), '/out/.snapshot.lock': NOW },
      defaultGh,
    )
    const code = runCli(['--sessions', '/sessions.json', '--out-dir', '/out'], io)
    expect(code).toBe(0)
    expect(ghCalls.length).toBeGreaterThan(0)
  })
})
