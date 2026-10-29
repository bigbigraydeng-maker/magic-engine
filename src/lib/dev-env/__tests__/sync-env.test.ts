import { lstatSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  applyEnvUpdates,
  debugMetaToken,
  fetchRenderEnvVars,
  readEnvValue,
  selectWhitelisted,
  syncEnvFromRender,
  type RenderEnvVar,
} from '../sync-env'

// Fake secrets: obviously fake, but distinctive so any leak is caught by a plain substring check.
const NEW_TOKEN = 'FAKE_NEW_TOKEN_aaaa1111'
const OLD_TOKEN = 'FAKE_OLD_TOKEN_bbbb2222'
const OTHER_SECRET = 'FAKE_DB_PASSWORD_cccc3333'
const KEY = 'META_SYSTEM_USER_TOKEN_CTSTOURS_CO_NZ'
const PREFIXES = ['META_SYSTEM_USER_TOKEN_'] as const

function fakeFetch(pages: unknown[], status = 200): typeof fetch {
  let i = 0
  return (async () => {
    const body = pages[Math.min(i, pages.length - 1)]
    i += 1
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response
  }) as typeof fetch
}

const remote = (vars: RenderEnvVar[]) => vars.map((v) => ({ envVar: v, cursor: `c-${v.key}` }))

describe('selectWhitelisted', () => {
  it('keeps only prefixed, well-formed, non-empty variables', () => {
    const picked = selectWhitelisted(
      [
        { key: KEY, value: NEW_TOKEN },
        { key: 'DATABASE_PASSWORD', value: OTHER_SECRET },
        { key: 'META_SYSTEM_USER_TOKEN_EMPTY', value: '' },
        { key: 'META_SYSTEM_USER_TOKEN_lower', value: 'x' },
      ],
      PREFIXES,
    )
    expect(picked).toEqual([{ key: KEY, value: NEW_TOKEN }])
  })
})

describe('value safety', () => {
  it('drops values that could inject lines or need escaping', () => {
    const picked = selectWhitelisted(
      [
        { key: 'META_SYSTEM_USER_TOKEN_A', value: 't\nDATABASE_URL=evil' },
        { key: 'META_SYSTEM_USER_TOKEN_B', value: 'has"quote' },
        { key: 'META_SYSTEM_USER_TOKEN_C', value: 'has\\slash' },
        { key: 'META_SYSTEM_USER_TOKEN_D', value: 'ctrl\u0007char' },
        { key: 'META_SYSTEM_USER_TOKEN_OK', value: 'fine-1' },
      ],
      PREFIXES,
    )
    expect(picked.map((v) => v.key)).toEqual(['META_SYSTEM_USER_TOKEN_OK'])
  })
})

describe('readEnvValue / applyEnvUpdates', () => {
  it('reads the last assignment, strips quotes and ignores comments', () => {
    const text = `# ${KEY}=commented\n${KEY}=first\nexport ${KEY}="second"\n`
    expect(readEnvValue(text, KEY)).toBe('second')
    expect(readEnvValue(text, 'MISSING')).toBeNull()
  })

  it('updates in place, keeps other lines, appends missing keys', () => {
    const original = `# header\nFOO=1\n${KEY}=${OLD_TOKEN}\nexport BAR=2\n`
    const out = applyEnvUpdates(original, [
      { key: KEY, value: NEW_TOKEN },
      { key: 'META_SYSTEM_USER_TOKEN_NEW', value: 'n-1' },
    ])
    expect(out.updated).toEqual([KEY])
    expect(out.added).toEqual(['META_SYSTEM_USER_TOKEN_NEW'])
    expect(out.content).toBe(`# header\nFOO=1\n${KEY}=${NEW_TOKEN}\nexport BAR=2\nMETA_SYSTEM_USER_TOKEN_NEW=n-1\n`)
  })

  it('reports unchanged when the value already matches and rewrites every duplicate otherwise', () => {
    expect(applyEnvUpdates(`${KEY}=${NEW_TOKEN}\n`, [{ key: KEY, value: NEW_TOKEN }]).unchanged).toEqual([KEY])
    const dup = applyEnvUpdates(`${KEY}=a\nX=1\nexport ${KEY}='b'\n`, [{ key: KEY, value: NEW_TOKEN }])
    expect(dup.content).toBe(`${KEY}=${NEW_TOKEN}\nX=1\nexport ${KEY}=${NEW_TOKEN}\n`)
  })

  it('quotes values that contain a space or #', () => {
    const out = applyEnvUpdates('', [{ key: 'META_SYSTEM_USER_TOKEN_Q', value: 'a b#c' }])
    expect(out.content).toBe('META_SYSTEM_USER_TOKEN_Q="a b#c"\n')
  })

  it('updates CRLF lines in place instead of appending a duplicate', () => {
    const out = applyEnvUpdates(`${KEY}=old\r\nX=1\r\n`, [{ key: KEY, value: NEW_TOKEN }])
    expect(out.updated).toEqual([KEY])
    expect(out.content.split('\n').filter((l) => l.startsWith(KEY))).toHaveLength(1)
  })

  it('an inline comment does not make an equal value look changed', () => {
    const out = applyEnvUpdates(`${KEY}=${NEW_TOKEN} # note\n`, [{ key: KEY, value: NEW_TOKEN }])
    expect(out.unchanged).toEqual([KEY])
  })
})

describe('fetchRenderEnvVars', () => {
  it('accepts both item shapes and follows the cursor', async () => {
    const full = Array.from({ length: 100 }, (_, n) => ({ envVar: { key: `K${n}`, value: 'v' }, cursor: `c${n}` }))
    const vars = await fetchRenderEnvVars(
      'srv-x',
      'rnd_fake',
      fakeFetch([full, [{ key: KEY, value: NEW_TOKEN }]]),
    )
    expect(vars).toHaveLength(101)
    expect(vars[100]).toEqual({ key: KEY, value: NEW_TOKEN })
  })

  it('throws instead of returning a truncated list when pagination never ends', async () => {
    const full = Array.from({ length: 100 }, (_, n) => ({ envVar: { key: `K${n}`, value: 'v' }, cursor: `c${n}` }))
    await expect(fetchRenderEnvVars('srv-x', 'rnd_fake', fakeFetch([full]))).rejects.toThrow('more pages than expected')
  })

  it('never puts the response body or the api key in an error', async () => {
    const body = { message: `leaks ${NEW_TOKEN}` }
    const err = await fetchRenderEnvVars('srv-x', 'rnd_fake_KEY', fakeFetch([body], 401)).catch((e: unknown) => e)
    expect(String(err)).toBe('Error: Render API HTTP 401')
    expect(String(err)).not.toContain(NEW_TOKEN)
    expect(String(err)).not.toContain('rnd_fake_KEY')
  })
})

function setup(content: string) {
  const dir = mkdtempSync(join(tmpdir(), 'envsync-'))
  const file = join(dir, '.env.local')
  writeFileSync(file, content, { mode: 0o644 })
  return { dir, file }
}

const opts = (file: string, pages: unknown[], extra: Partial<Parameters<typeof syncEnvFromRender>[0]> = {}) => ({
  envFile: file,
  serviceId: 'srv-x',
  apiKey: 'rnd_fake',
  prefixes: PREFIXES,
  dryRun: false,
  fetchImpl: fakeFetch(pages),
  now: () => new Date(2026, 9, 19, 8, 30, 15),
  ...extra,
})

describe('syncEnvFromRender', () => {
  const page = remote([
    { key: KEY, value: NEW_TOKEN },
    { key: 'DATABASE_PASSWORD', value: OTHER_SECRET },
  ])

  it('backs up first, writes atomically with 0600, touches only the whitelisted key and leaks nothing', async () => {
    const original = `FOO=1\n${KEY}=${OLD_TOKEN}\nDATABASE_PASSWORD=local\n`
    const { dir, file } = setup(original)
    const report = await syncEnvFromRender(opts(file, [page]))
    expect(report.entries).toEqual([{ key: KEY, status: 'updated' }])
    expect(readFileSync(file, 'utf8')).toBe(`FOO=1\n${KEY}=${NEW_TOKEN}\nDATABASE_PASSWORD=local\n`)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(report.backupPath).toBe(`${realpathSync(file)}.bak-20261019-083015`)
    expect(readFileSync(report.backupPath ?? '', 'utf8')).toBe(original)
    expect(statSync(report.backupPath ?? '').mode & 0o777).toBe(0o600)
    expect(readdirSync(dir).filter((n) => n.includes('.tmp-'))).toEqual([])
    const serialised = JSON.stringify(report)
    for (const secret of [NEW_TOKEN, OLD_TOKEN, OTHER_SECRET]) expect(serialised).not.toContain(secret)
  })

  it('a dry run writes nothing at all', async () => {
    const original = `${KEY}=${OLD_TOKEN}\n`
    const { dir, file } = setup(original)
    const report = await syncEnvFromRender(opts(file, [page], { dryRun: true }))
    expect(report.entries).toEqual([{ key: KEY, status: 'updated' }])
    expect(readFileSync(file, 'utf8')).toBe(original)
    expect(readdirSync(dir)).toEqual(['.env.local'])
  })

  it('nothing changed -> no write and no backup', async () => {
    const { dir, file } = setup(`${KEY}=${NEW_TOKEN}\n`)
    const report = await syncEnvFromRender(opts(file, [page]))
    expect(report.entries).toEqual([{ key: KEY, status: 'unchanged' }])
    expect(report.backupPath).toBeNull()
    expect(readdirSync(dir)).toEqual(['.env.local'])
  })

  it('refuses to proceed when no whitelisted variable is found, leaving the file untouched', async () => {
    const original = `${KEY}=${OLD_TOKEN}\n`
    const { file } = setup(original)
    await expect(syncEnvFromRender(opts(file, [remote([{ key: 'DATABASE_PASSWORD', value: OTHER_SECRET }])]))).rejects.toThrow(
      'no whitelisted variables found',
    )
    expect(readFileSync(file, 'utf8')).toBe(original)
  })

  it('does not create a missing env file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'envsync-'))
    await expect(syncEnvFromRender(opts(join(dir, '.env.local'), [page]))).rejects.toThrow('env file not found')
    expect(readdirSync(dir)).toEqual([])
  })

  it('keeps only the three newest backups', async () => {
    const { dir, file } = setup(`${KEY}=v0\n`)
    for (let n = 1; n <= 5; n += 1) {
      const token = `FAKE_ROUND_${n}`
      await syncEnvFromRender(
        opts(file, [remote([{ key: KEY, value: token }])], { now: () => new Date(2026, 9, 19, 8, 30, n) }),
      )
    }
    const backups = readdirSync(dir).filter((n) => n.includes('.bak-')).sort()
    expect(backups).toEqual(['.env.local.bak-20261019-083003', '.env.local.bak-20261019-083004', '.env.local.bak-20261019-083005'])
  })

  it('two syncs in the same second do not overwrite the first backup', async () => {
    const { file } = setup(`${KEY}=v0\n`)
    const sameSecond = () => new Date(2026, 9, 19, 8, 30, 15)
    await syncEnvFromRender(opts(file, [remote([{ key: KEY, value: 'FAKE_A' }])], { now: sameSecond }))
    await expect(
      syncEnvFromRender(opts(file, [remote([{ key: KEY, value: 'FAKE_B' }])], { now: sameSecond })),
    ).rejects.toThrow()
    expect(readFileSync(`${realpathSync(file)}.bak-20261019-083015`, 'utf8')).toBe(`${KEY}=v0\n`)
  })
})


const graph = (body: unknown, status = 200) => ({ ok: status < 300, status, json: async () => body }) as Response

function router(render: unknown[], metaBody: (token: string) => unknown) {
  let i = 0
  return (async (url: string) => {
    if (url.startsWith('https://graph.facebook.com/')) {
      const token = new URL(url).searchParams.get('input_token') ?? ''
      return graph(metaBody(token))
    }
    const body = render[Math.min(i, render.length - 1)]
    i += 1
    return graph(body)
  }) as unknown as typeof fetch
}

describe('guards on what may be synced', () => {
  const page = remote([{ key: KEY, value: NEW_TOKEN }])

  it.each([[''], ['DATABASE_'], ['META_']])('refuses the widening prefix %j', async (prefix) => {
    const { file } = setup(`${KEY}=${OLD_TOKEN}\n`)
    await expect(syncEnvFromRender(opts(file, [page], { prefixes: [prefix] }))).rejects.toThrow(/prefix/)
    expect(readFileSync(file, 'utf8')).toBe(`${KEY}=${OLD_TOKEN}\n`)
  })

  it('reports unsafe values by name only and never writes them', async () => {
    const { file } = setup(`${KEY}=${OLD_TOKEN}\n`)
    const bad = 'META_SYSTEM_USER_TOKEN_BAD'
    const report = await syncEnvFromRender(
      opts(file, [remote([{ key: KEY, value: NEW_TOKEN }, { key: bad, value: 'x\nDATABASE_URL=evil' }])]),
    )
    expect(report.skipped).toEqual([bad])
    expect(readFileSync(file, 'utf8')).not.toContain('evil')
    expect(JSON.stringify(report)).not.toContain('evil')
  })

  it('warns, by key name, when the shell environment would shadow the file', async () => {
    const { file } = setup(`${KEY}=${OLD_TOKEN}\n`)
    const report = await syncEnvFromRender(opts(file, [page], { env: { ...process.env, [KEY]: 'FAKE_SHELL_VALUE' } }))
    expect(report.shellOverrides).toEqual([KEY])
    expect(JSON.stringify(report)).not.toContain('FAKE_SHELL_VALUE')
  })

  it('rewrites the real file behind a symlink and keeps the link', async () => {
    const real = setup(`${KEY}=${OLD_TOKEN}\n`)
    const dir2 = mkdtempSync(join(tmpdir(), 'envlink-'))
    const link = join(dir2, '.env.local')
    symlinkSync(real.file, link)
    await syncEnvFromRender(opts(link, [page]))
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(readFileSync(real.file, 'utf8')).toBe(`${KEY}=${NEW_TOKEN}\n`)
    expect(readdirSync(real.dir).some((n) => n.includes('.bak-'))).toBe(true)
    expect(readdirSync(dir2)).toEqual(['.env.local'])
  })

  it('backup and temp file names are covered by .gitignore', () => {
    const ignore = readFileSync(join(process.cwd(), '.gitignore'), 'utf8').split('\n')
    expect(ignore).toContain('.env.local.*')
  })
})

describe('verification with Meta (read-only)', () => {
  it('classifies the answers and never leaks the token', async () => {
    const valid = router([], () => ({ data: { is_valid: true } }))
    expect(await debugMetaToken(NEW_TOKEN, valid)).toBe('valid')
    const dead = router([], () => ({ data: { is_valid: false, error: { code: 190, subcode: 460, message: `bad ${NEW_TOKEN}` } } }))
    expect(await debugMetaToken(NEW_TOKEN, dead)).toBe('invalid:190/460')
    const throttled = router([], () => ({ error: { code: 4, message: 'rate limit' } }))
    expect(await debugMetaToken(NEW_TOKEN, throttled)).toBe('unreadable')
    const broken = (async () => { throw new Error(`boom ${NEW_TOKEN}`) }) as unknown as typeof fetch
    expect(await debugMetaToken(NEW_TOKEN, broken)).toBe('unreadable')
  })

  it('syncEnvFromRender with verify=true attaches a verdict per key (still no values)', async () => {
    const { file } = setup(`${KEY}=${OLD_TOKEN}\n`)
    const fetchImpl = router([remote([{ key: KEY, value: NEW_TOKEN }])], (t) =>
      t === NEW_TOKEN ? { data: { is_valid: false, error: { code: 190, subcode: 460 } } } : { data: { is_valid: true } },
    )
    const report = await syncEnvFromRender(opts(file, [], { fetchImpl, verify: true }))
    expect(report.entries).toEqual([{ key: KEY, status: 'updated', verdict: 'invalid:190/460' }])
    expect(JSON.stringify(report)).not.toContain(NEW_TOKEN)
  })
})
