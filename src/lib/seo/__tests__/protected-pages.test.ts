import { afterEach, describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  HOME_PATH,
  MAX_PROTECTED_ENTRIES,
  GATE_JOB_NAME,
  normalizeSlug,
  normalizePagePath,
  identityFromUrl,
  identityFromSlug,
  mergeIdentities,
  unresolvedIdentity,
  parseProtectedSlugs,
  readProtectedRaw,
  matchProtected,
  loadProtectedPages,
  decide,
  SYSTEM_ACTOR,
  resolveActorFromEmail,
  writeGateReceipt,
  ProtectedPageError,
  createPageWriteGuard,
  type PageIdentity,
} from '../protected-pages'

// ---------------------------------------------------------------------------
// Fake supabase — table-based, not call-order-based.
// ---------------------------------------------------------------------------

interface FakeRow {
  id: string
  seo_config: unknown
}

interface FakeSupabase {
  clients: Map<string, FakeRow>
  cronRunLogs: Array<Record<string, unknown>>
  insertError: { message: string } | null
  lookupError: { message: string } | null
  from(table: string): unknown
}

function makeFakeSupabase(seed?: {
  clients?: Array<{ id: string; seo_config: unknown }>
  insertError?: { message: string } | null
  lookupError?: { message: string } | null
}): FakeSupabase {
  const clients = new Map<string, FakeRow>()
  for (const c of seed?.clients ?? []) clients.set(c.id, { id: c.id, seo_config: c.seo_config })

  const fake: FakeSupabase = {
    clients,
    cronRunLogs: [],
    insertError: seed?.insertError ?? null,
    lookupError: seed?.lookupError ?? null,
    from(table: string) {
      if (table === 'clients') {
        return {
          select: () => ({
            eq: (_col: string, id: string) => ({
              maybeSingle: async () => {
                if (fake.lookupError) return { data: null, error: fake.lookupError }
                const row = fake.clients.get(id)
                return { data: row ? { seo_config: row.seo_config } : null, error: null }
              },
            }),
          }),
        }
      }
      if (table === 'cron_run_logs') {
        return {
          insert: async (row: Record<string, unknown>) => {
            if (fake.insertError) return { error: fake.insertError }
            fake.cronRunLogs.push(row)
            return { error: null }
          },
        }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }
  return fake
}

const asClient = (fake: FakeSupabase): SupabaseClient => fake as never

// ---------------------------------------------------------------------------
// normalizeSlug (legacy)
// ---------------------------------------------------------------------------

describe('normalizeSlug (legacy)', () => {
  it('trims, lowercases and strips slashes', () => {
    expect(normalizeSlug('  /China-Tours/  ')).toBe('china-tours')
  })

  it('takes the pathname of a full URL', () => {
    expect(normalizeSlug('https://example.com/Blog/Post/')).toBe('blog/post')
  })
})

// ---------------------------------------------------------------------------
// normalizePagePath
// ---------------------------------------------------------------------------

describe('normalizePagePath', () => {
  it('lowercases and strips leading/trailing slashes', () => {
    expect(normalizePagePath('/China-Tours/')).toBe('china-tours')
  })

  it('takes the pathname of a full URL', () => {
    expect(normalizePagePath('https://example.com/China-Tours/')).toBe('china-tours')
  })

  it('drops query and hash', () => {
    expect(normalizePagePath('/tours?utm=1#top')).toBe('tours')
  })

  it('strips a trailing .html', () => {
    expect(normalizePagePath('/about.html')).toBe('about')
  })

  it('strips a trailing /index segment', () => {
    expect(normalizePagePath('/blog/index')).toBe('blog')
  })

  it('decodes percent-encoded characters', () => {
    expect(normalizePagePath('/a%2Db')).toBe('a-b')
  })

  it('returns null on a bad percent-encoding', () => {
    expect(normalizePagePath('/%E0%A4%A')).toBeNull()
  })

  it('maps home aliases to HOME_PATH', () => {
    expect(normalizePagePath('')).toBe(HOME_PATH)
    expect(normalizePagePath('/')).toBe(HOME_PATH)
    expect(normalizePagePath('index')).toBe(HOME_PATH)
    expect(normalizePagePath('home')).toBe(HOME_PATH)
    expect(normalizePagePath('/index')).toBe(HOME_PATH)
  })
})

// ---------------------------------------------------------------------------
// identity
// ---------------------------------------------------------------------------

describe('identityFromUrl / identityFromSlug', () => {
  it('builds a path + last-segment slug', () => {
    const id = identityFromUrl('/blog/china-visa')
    expect(id.paths).toEqual([{ value: 'blog/china-visa', kind: 'url' }])
    expect(id.slugs).toEqual(['china-visa'])
    expect(id.unresolved).toBeNull()
  })

  it('builds home identity with aliases', () => {
    const id = identityFromUrl('/')
    expect(id.paths).toEqual([{ value: HOME_PATH, kind: 'url' }])
    expect(id.slugs).toEqual(['', 'home', 'index'])
  })

  it('marks decode failures unresolved', () => {
    const id = identityFromUrl('/%E0%A4%A')
    expect(id.unresolved).toBe('decode_failed')
  })

  it('identityFromSlug behaves like identityFromUrl', () => {
    expect(identityFromSlug('china-visa')).toEqual(identityFromUrl('china-visa'))
  })
})

describe('mergeIdentities / unresolvedIdentity', () => {
  it('unions paths and slugs with dedupe', () => {
    const a = identityFromUrl('/blog/china-visa')
    const b = identityFromUrl('/blog/china-visa')
    const merged = mergeIdentities(a, b)
    expect(merged.paths).toHaveLength(1)
    expect(merged.slugs).toEqual(['china-visa'])
  })

  it('keeps the first non-null unresolved', () => {
    const merged = mergeIdentities(unresolvedIdentity('decode_failed'), identityFromUrl('/a'))
    expect(merged.unresolved).toBe('decode_failed')
  })
})

// ---------------------------------------------------------------------------
// parseProtectedSlugs
// ---------------------------------------------------------------------------

describe('parseProtectedSlugs', () => {
  it('treats null/undefined as empty and not malformed', () => {
    expect(parseProtectedSlugs(null)).toEqual({ entries: [], malformed: false, reason: null })
    expect(parseProtectedSlugs(undefined)).toEqual({ entries: [], malformed: false, reason: null })
  })

  it('flags a non-array as malformed', () => {
    const r = parseProtectedSlugs('nope')
    expect(r.malformed).toBe(true)
    expect(r.reason).toBe('not_array')
  })

  it('flags a non-string item as malformed', () => {
    const r = parseProtectedSlugs(['ok', 42])
    expect(r.malformed).toBe(true)
    expect(r.reason).toBe('non_string_item')
  })

  it('flags more than MAX_PROTECTED_ENTRIES as malformed (no truncation)', () => {
    const raw = Array.from({ length: MAX_PROTECTED_ENTRIES + 1 }, (_, i) => `p${i}`)
    const r = parseProtectedSlugs(raw)
    expect(r.malformed).toBe(true)
    expect(r.reason).toBe('too_many')
  })

  it('keeps "/" as the home entry', () => {
    expect(parseProtectedSlugs(['/']).entries).toEqual([HOME_PATH])
  })

  it('normalises a path entry', () => {
    expect(parseProtectedSlugs(['/China-Tours/']).entries).toEqual(['china-tours'])
  })

  it('dedupes entries', () => {
    expect(parseProtectedSlugs(['/a', 'a', '/A/']).entries).toEqual(['a'])
  })
})

// ---------------------------------------------------------------------------
// readProtectedRaw
// ---------------------------------------------------------------------------

describe('readProtectedRaw', () => {
  it('returns undefined raw for null config', () => {
    expect(readProtectedRaw(null)).toEqual({ raw: undefined, malformed: false })
  })

  it('flags a non-object config as malformed', () => {
    expect(readProtectedRaw('nope').malformed).toBe(true)
  })

  it('flags an array config as malformed', () => {
    expect(readProtectedRaw([]).malformed).toBe(true)
  })

  it('reads the key from a plain object', () => {
    expect(readProtectedRaw({ meta_cycle_protected_slugs: ['a'] })).toEqual({
      raw: ['a'],
      malformed: false,
    })
  })
})

// ---------------------------------------------------------------------------
// matchProtected
// ---------------------------------------------------------------------------

describe('matchProtected', () => {
  it('matches a slug entry against the last segment', () => {
    expect(matchProtected(['china-visa'], identityFromUrl('/blog/china-visa'))).toBe(true)
  })

  it('matches a path entry only on the full path', () => {
    expect(matchProtected(['tours/china'], identityFromUrl('/tours/china'))).toBe(true)
    expect(matchProtected(['tours/china'], identityFromUrl('/tours/china/beijing'))).toBe(false)
  })

  it('matches a file identity by suffix but not a url identity', () => {
    const fileId = identityFromUrl('public/en/china-tours', 'file')
    const urlId = identityFromUrl('public/en/china-tours', 'url')
    expect(matchProtected(['en/china-tours'], fileId)).toBe(true)
    expect(matchProtected(['en/china-tours'], urlId)).toBe(false)
  })

  it('matches the home identity with the "/" entry', () => {
    expect(matchProtected([HOME_PATH], identityFromUrl('/'))).toBe(true)
  })

  it('does not match a slug entry against a deeper path', () => {
    expect(matchProtected(['about'], identityFromUrl('/about/team'))).toBe(false)
  })

  it('does not match the home entry against another page', () => {
    expect(matchProtected([HOME_PATH], identityFromUrl('/about'))).toBe(false)
  })

  it('returns false for empty entries', () => {
    expect(matchProtected([], identityFromUrl('/about'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// loadProtectedPages / decide
// ---------------------------------------------------------------------------

describe('loadProtectedPages', () => {
  it('returns entries on success', async () => {
    const fake = makeFakeSupabase({
      clients: [{ id: 'c1', seo_config: { meta_cycle_protected_slugs: ['/a'] } }],
    })
    const loaded = await loadProtectedPages(asClient(fake), 'c1')
    expect(loaded).toEqual({ ok: true, entries: ['a'] })
  })

  it('returns lookup_failed on error', async () => {
    const fake = makeFakeSupabase({ lookupError: { message: 'boom' } })
    const loaded = await loadProtectedPages(asClient(fake), 'c1')
    expect(loaded).toEqual({ ok: false, reason: 'lookup_failed' })
  })

  it('returns lookup_failed on a missing row', async () => {
    const fake = makeFakeSupabase()
    const loaded = await loadProtectedPages(asClient(fake), 'missing')
    expect(loaded).toEqual({ ok: false, reason: 'lookup_failed' })
  })

  it('returns malformed when the config key is not an array', async () => {
    const fake = makeFakeSupabase({
      clients: [{ id: 'c1', seo_config: { meta_cycle_protected_slugs: 'nope' } }],
    })
    const loaded = await loadProtectedPages(asClient(fake), 'c1')
    expect(loaded).toEqual({ ok: false, reason: 'malformed' })
  })
})

describe('decide', () => {
  it('is unknown when the load failed', () => {
    expect(decide({ ok: false, reason: 'malformed' }, identityFromUrl('/a'))).toBe('unknown')
    expect(decide({ ok: false, reason: 'lookup_failed' }, identityFromUrl('/a'))).toBe('unknown')
  })

  it('is unknown when the identity is unresolved', () => {
    expect(decide({ ok: true, entries: [] }, unresolvedIdentity('decode_failed'))).toBe('unknown')
  })

  it('is protected when matched', () => {
    expect(decide({ ok: true, entries: ['a'] }, identityFromUrl('/a'))).toBe('protected')
  })

  it('is open otherwise', () => {
    expect(decide({ ok: true, entries: ['a'] }, identityFromUrl('/b'))).toBe('open')
  })
})

// ---------------------------------------------------------------------------
// resolveActorFromEmail
// ---------------------------------------------------------------------------

describe('resolveActorFromEmail', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('is not PM when the env var is unset', () => {
    vi.stubEnv('PROTECTED_PAGE_OVERRIDE_EMAILS', '')
    const actor = resolveActorFromEmail('pm@example.com', true)
    expect(actor.isPm).toBe(false)
    expect(actor.kind).toBe('human')
  })

  it('trims and lowercases before matching', () => {
    vi.stubEnv('PROTECTED_PAGE_OVERRIDE_EMAILS', ' pm@example.com , other@example.com ')
    expect(resolveActorFromEmail('  PM@Example.com ', true).isPm).toBe(true)
  })

  it('is not PM when the email is unverified', () => {
    vi.stubEnv('PROTECTED_PAGE_OVERRIDE_EMAILS', 'pm@example.com')
    expect(resolveActorFromEmail('pm@example.com', false).isPm).toBe(false)
  })

  it('🔴 there is no way to pass an allow-list in: a third argument is not part of the API', () => {
    expect(resolveActorFromEmail.length).toBe(2)
  })

  it('hashes the email and falls back to anonymous', () => {
    vi.stubEnv('PROTECTED_PAGE_OVERRIDE_EMAILS', '')
    expect(resolveActorFromEmail('pm@example.com', true).callerHash).toHaveLength(12)
    expect(resolveActorFromEmail(null, false).callerHash).toBe('anonymous')
  })
})

// ---------------------------------------------------------------------------
// writeGateReceipt
// ---------------------------------------------------------------------------

describe('writeGateReceipt', () => {
  it('inserts one terminal row', async () => {
    const fake = makeFakeSupabase()
    const ok = await writeGateReceipt(asClient(fake), {
      clientId: 'c1',
      route: '/a',
      outcome: 'denied_protected',
      identity: identityFromUrl('/a'),
      callerHash: 'abc',
      targetType: 'page',
    })
    expect(ok).toBe(true)
    expect(fake.cronRunLogs).toHaveLength(1)
    const row = fake.cronRunLogs[0]
    expect(row.job_name).toBe(GATE_JOB_NAME)
    expect(row.status).toBe('completed')
    expect(row.failed_count).toBe(0)
    expect(row.processed).toBe(1)
    expect((row.summary as Record<string, unknown>).decision).toBe('denied_protected')
  })

  it('returns false on error and never throws', async () => {
    const fake = makeFakeSupabase({ insertError: { message: 'boom' } })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const ok = await writeGateReceipt(asClient(fake), {
      clientId: 'c1',
      route: '/a',
      outcome: 'denied_protected',
      identity: identityFromUrl('/a'),
      callerHash: 'abc',
      targetType: null,
    })
    expect(ok).toBe(false)
    spy.mockRestore()
  })
})

// ---------------------------------------------------------------------------
// createPageWriteGuard
// ---------------------------------------------------------------------------

function guardFor(fake: FakeSupabase, actor = SYSTEM_ACTOR) {
  return createPageWriteGuard({
    supabase: asClient(fake),
    clientId: 'c1',
    actor,
    route: '/a',
  })
}

describe('createPageWriteGuard', () => {
  it('passes an open page without writing a receipt', async () => {
    const fake = makeFakeSupabase({
      clients: [{ id: 'c1', seo_config: { meta_cycle_protected_slugs: ['other'] } }],
    })
    await guardFor(fake).assert(identityFromUrl('/a'))
    expect(fake.cronRunLogs).toHaveLength(0)
  })

  it('throws 403 and writes denied_not_pm for a non-PM human', async () => {
    const fake = makeFakeSupabase({
      clients: [{ id: 'c1', seo_config: { meta_cycle_protected_slugs: ['a'] } }],
    })
    const actor = resolveActorFromEmail('user@example.com', true)
    const guard = guardFor(fake, actor)
    await expect(guard.assert(identityFromUrl('/a'))).rejects.toBeInstanceOf(ProtectedPageError)
    expect(fake.cronRunLogs).toHaveLength(1)
    expect((fake.cronRunLogs[0].summary as Record<string, unknown>).decision).toBe('denied_not_pm')
  })

  it('throws and writes denied_protected for a system actor', async () => {
    const fake = makeFakeSupabase({
      clients: [{ id: 'c1', seo_config: { meta_cycle_protected_slugs: ['a'] } }],
    })
    await expect(guardFor(fake).assert(identityFromUrl('/a'))).rejects.toBeInstanceOf(
      ProtectedPageError,
    )
    expect((fake.cronRunLogs[0].summary as Record<string, unknown>).decision).toBe(
      'denied_protected',
    )
  })

  it('lets a PM through only after the receipt is written', async () => {
    const fake = makeFakeSupabase({
      clients: [{ id: 'c1', seo_config: { meta_cycle_protected_slugs: ['a'] } }],
    })
    vi.stubEnv('PROTECTED_PAGE_OVERRIDE_EMAILS', 'pm@example.com')
    const actor = resolveActorFromEmail('pm@example.com', true)
    await guardFor(fake, actor).assert(identityFromUrl('/a'))
    expect(fake.cronRunLogs).toHaveLength(1)
    expect((fake.cronRunLogs[0].summary as Record<string, unknown>).decision).toBe(
      'allowed_pm_override',
    )
    // the receipt says WHAT was overridden (a protected page, vs. an unreadable list)
    expect((fake.cronRunLogs[0].summary as Record<string, unknown>).overridden_decision).toBe('protected')
  })

  it('refuses a PM override when the receipt cannot be written', async () => {
    const fake = makeFakeSupabase({
      clients: [{ id: 'c1', seo_config: { meta_cycle_protected_slugs: ['a'] } }],
      insertError: { message: 'boom' },
    })
    vi.stubEnv('PROTECTED_PAGE_OVERRIDE_EMAILS', 'pm@example.com')
    const actor = resolveActorFromEmail('pm@example.com', true)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(guardFor(fake, actor).assert(identityFromUrl('/a'))).rejects.toBeInstanceOf(
      ProtectedPageError,
    )
    spy.mockRestore()
  })

  it('throws unknown when the load fails', async () => {
    const fake = makeFakeSupabase({ lookupError: { message: 'boom' } })
    await expect(guardFor(fake).assert(identityFromUrl('/a'))).rejects.toBeInstanceOf(
      ProtectedPageError,
    )
    expect((fake.cronRunLogs[0].summary as Record<string, unknown>).decision).toBe('denied_unknown')
  })

  it('re-reads the protected list from the DB on every call', async () => {
    const fake = makeFakeSupabase({
      clients: [{ id: 'c1', seo_config: { meta_cycle_protected_slugs: ['a'] } }],
    })
    const guard = guardFor(fake)
    await expect(guard.assert(identityFromUrl('/a'))).rejects.toBeInstanceOf(ProtectedPageError)

    fake.clients.set('c1', { id: 'c1', seo_config: { meta_cycle_protected_slugs: ['b'] } })
    await guard.assert(identityFromUrl('/a'))
    expect(fake.cronRunLogs).toHaveLength(1)
  })
})

describe('canonical form is shared by pages and list entries (.html / .htm / index / slashes)', () => {
  it.each([
    ['china-tours.html', 'china-tours'],
    ['china-tours.htm', 'china-tours'],
    ['https://x.com/China-Tours/index.html', 'china-tours'],
    ['foo/index/', 'foo'],
    ['foo/index.html/', 'foo'],
    ['public/en/china-tours.htm', 'public/en/china-tours'],
  ])('page %s => %s', (input, want) => {
    expect(normalizePagePath(input)).toBe(want)
  })

  it.each([
    ['china-tours.html', 'china-tours'],
    ['https://x.com/china-tours/index.html', 'china-tours'],
    ['/en/china-tours.htm', 'en/china-tours'],
    ['index', '/'],
    ['home', 'home'], // list entries get no home alias: `home` stays a slug entry
  ])('list entry %s => %s', (input, want) => {
    expect(parseProtectedSlugs([input]).entries).toEqual([want])
  })

  it('🔴 an entry written as a file name still protects the page it names', () => {
    const entries = parseProtectedSlugs(['china-tours.html', '/en/about.htm']).entries
    expect(matchProtected(entries, identityFromUrl('https://x.com/china-tours'))).toBe(true)
    expect(matchProtected(entries, identityFromUrl('public/en/about.htm', 'file'))).toBe(true)
  })
})
