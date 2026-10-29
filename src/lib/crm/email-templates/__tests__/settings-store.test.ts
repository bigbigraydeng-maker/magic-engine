import { describe, it, expect, vi } from 'vitest'
import {
  loadEmailSettings,
  appendEmailSettings,
  listSettingsHistory,
} from '@/lib/crm/email-templates/settings-store'
import { serialiseEmailSettings } from '@/lib/crm/email-templates/settings'
import type { EmailSettings } from '@/lib/crm/email-templates/types'
import { createFakeDb } from '@/lib/crm/email-templates/__tests__/fake-db'

function validSettings(): EmailSettings {
  return {
    enabled: true,
    sendMailbox: 'info@example.com',
    allowUnsolicited: false,
    footer: null,
    limits: { perUserPerHour: 30, perUserPerDay: 100, perMailboxPerDay: 200 },
    frequencyCap: { max: 2, windowDays: 7 },
    recipientAllowlist: ['test@example.com'],
    sameTemplateCooldownHours: 24,
    callPromptHours: 24,
    guardrails: { allowedLinkHosts: ['example.com'], rules: [] },
    providers: {},
  }
}

function makeDb() {
  return createFakeDb({ unique: { crm_email_settings: [['client_id', 'version']] } })
}

function seedRow(clientId: string, version: number, settings: unknown) {
  return {
    client_id: clientId,
    version,
    settings,
    change_note: null,
    created_by: 'admin@example.com',
    created_at: new Date(2024, 0, version).toISOString(),
  }
}

describe('loadEmailSettings', () => {
  it('returns none when there are no rows', async () => {
    const { db } = makeDb()
    const result = await loadEmailSettings(db, 'client-a')
    expect(result).toEqual({ kind: 'none' })
  })

  it('returns ok for a valid row', async () => {
    const settings = validSettings()
    const { db } = makeDb()
    const fake = createFakeDb({
      unique: { crm_email_settings: [['client_id', 'version']] },
      seed: { crm_email_settings: [seedRow('client-a', 1, serialiseEmailSettings(settings))] },
    })
    void db
    const result = await loadEmailSettings(fake.db, 'client-a')
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      expect(result.version).toBe(1)
      expect(result.settings).toEqual(settings)
    }
  })

  it('returns the latest version', async () => {
    const v1 = validSettings()
    const v2 = { ...validSettings(), footer: 'bye' }
    const fake = createFakeDb({
      unique: { crm_email_settings: [['client_id', 'version']] },
      seed: {
        crm_email_settings: [
          seedRow('client-a', 1, serialiseEmailSettings(v1)),
          seedRow('client-a', 2, serialiseEmailSettings(v2)),
        ],
      },
    })
    const result = await loadEmailSettings(fake.db, 'client-a')
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      expect(result.version).toBe(2)
      expect(result.settings.footer).toBe('bye')
    }
  })

  it('returns invalid when recipient_allowlist is a string', async () => {
    const settings = { ...serialiseEmailSettings(validSettings()), recipient_allowlist: 'a@b.com' }
    const fake = createFakeDb({
      unique: { crm_email_settings: [['client_id', 'version']] },
      seed: { crm_email_settings: [seedRow('client-a', 1, settings)] },
    })
    const result = await loadEmailSettings(fake.db, 'client-a')
    expect(result.kind).toBe('invalid')
  })

  it('returns invalid when frequency_cap is missing', async () => {
    const base = serialiseEmailSettings(validSettings())
    const settings: Record<string, unknown> = { ...base }
    delete settings.frequency_cap
    const fake = createFakeDb({
      unique: { crm_email_settings: [['client_id', 'version']] },
      seed: { crm_email_settings: [seedRow('client-a', 1, settings)] },
    })
    const result = await loadEmailSettings(fake.db, 'client-a')
    expect(result.kind).toBe('invalid')
  })
})

describe('appendEmailSettings', () => {
  it('appends the first version and round-trips', async () => {
    const { db } = makeDb()
    const settings = validSettings()
    const result = await appendEmailSettings(db, {
      clientId: 'client-a',
      baseVersion: null,
      settings,
      createdBy: 'admin@example.com',
    })
    expect(result).toEqual({ ok: true, value: { version: 1 } })
    const loaded = await loadEmailSettings(db, 'client-a')
    expect(loaded.kind).toBe('ok')
    if (loaded.kind === 'ok') {
      expect(loaded.settings).toEqual(settings)
    }
  })

  it('appends an edit and detects conflicts', async () => {
    const { db } = makeDb()
    const settings = validSettings()
    const first = await appendEmailSettings(db, {
      clientId: 'client-a',
      baseVersion: null,
      settings,
      createdBy: 'admin@example.com',
    })
    expect(first.ok).toBe(true)

    const second = await appendEmailSettings(db, {
      clientId: 'client-a',
      baseVersion: 1,
      settings: { ...settings, footer: 'v2' },
      createdBy: 'admin@example.com',
    })
    expect(second).toEqual({ ok: true, value: { version: 2 } })

    const stale = await appendEmailSettings(db, {
      clientId: 'client-a',
      baseVersion: 1,
      settings,
      createdBy: 'admin@example.com',
    })
    expect(stale.ok).toBe(false)
    if (!stale.ok) expect(stale.reason).toBe('conflict')

    const nullBase = await appendEmailSettings(db, {
      clientId: 'client-a',
      baseVersion: null,
      settings,
      createdBy: 'admin@example.com',
    })
    expect(nullBase.ok).toBe(false)
    if (!nullBase.ok) expect(nullBase.reason).toBe('conflict')
  })

  it('rejects invalid settings and stores nothing', async () => {
    const { db, tables } = makeDb()
    const bad = { ...validSettings(), frequencyCap: { max: 0, windowDays: 7 } }
    const result = await appendEmailSettings(db, {
      clientId: 'client-a',
      baseVersion: null,
      settings: bad,
      createdBy: 'admin@example.com',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid')
    expect(tables.crm_email_settings ?? []).toHaveLength(0)
  })

  it('rejects an invalid createdBy', async () => {
    const { db } = makeDb()
    const result = await appendEmailSettings(db, {
      clientId: 'client-a',
      baseVersion: null,
      settings: validSettings(),
      createdBy: 'nobody',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid')
  })
})

describe('cross-client isolation', () => {
  it('isolates clients and always filters by client_id', async () => {
    const { db, calls } = makeDb()
    await appendEmailSettings(db, {
      clientId: 'client-a',
      baseVersion: null,
      settings: validSettings(),
      createdBy: 'admin@example.com',
    })
    const b = await loadEmailSettings(db, 'client-b')
    expect(b).toEqual({ kind: 'none' })
    const a = await loadEmailSettings(db, 'client-a')
    expect(a.kind).toBe('ok')

    const selects = calls.filter((c) => c.op === 'select')
    expect(selects.length).toBeGreaterThan(0)
    for (const call of selects) {
      const hasClientFilter = call.filters.some((f) => f.kind === 'eq' && f.col === 'client_id')
      expect(hasClientFilter).toBe(true)
    }
  })
})

describe('database failure', () => {
  it('rejects on load and returns error on append', async () => {
    const fake = createFakeDb({
      unique: { crm_email_settings: [['client_id', 'version']] },
      failTable: 'crm_email_settings',
    })
    await expect(loadEmailSettings(fake.db, 'client-a')).rejects.toThrow()
    const result = await appendEmailSettings(fake.db, {
      clientId: 'client-a',
      baseVersion: null,
      settings: validSettings(),
      createdBy: 'admin@example.com',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('error')
  })
})

describe('before the migration is applied', () => {
  it.each(['42P01', 'PGRST205'])('a missing table (%s) reads as "no settings yet", so legacy sends carry on', async (code) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const fake = createFakeDb({ failTable: 'crm_email_settings', failCode: code })
    expect(await loadEmailSettings(fake.db, 'client-a')).toEqual({ kind: 'none' })
    expect(console.error).toHaveBeenCalled()
  })

  it('any other read failure is still an error (the send is refused)', async () => {
    const fake = createFakeDb({ failTable: 'crm_email_settings', failCode: '57014' })
    await expect(loadEmailSettings(fake.db, 'client-a')).rejects.toThrow()
  })

  it('WRITING settings never treats a missing table as "first save"', async () => {
    const fake = createFakeDb({ failTable: 'crm_email_settings', failCode: '42P01' })
    const result = await appendEmailSettings(fake.db, {
      clientId: 'client-a',
      baseVersion: null,
      settings: validSettings(),
      createdBy: 'admin@example.com',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('error')
  })
})

describe('listSettingsHistory', () => {
  it('returns newest first, respects limit, and omits settings', async () => {
    const { db } = makeDb()
    const settings = validSettings()
    for (let i = 0; i < 3; i += 1) {
      const base = i === 0 ? null : i
      await appendEmailSettings(db, {
        clientId: 'client-a',
        baseVersion: base,
        settings: { ...settings, footer: `v${i + 1}` },
        createdBy: 'admin@example.com',
        changeNote: `note ${i + 1}`,
      })
    }
    const all = await listSettingsHistory(db, 'client-a')
    expect(all.map((e) => e.version)).toEqual([3, 2, 1])
    for (const entry of all) {
      expect(Object.keys(entry).sort()).toEqual(['changeNote', 'createdAt', 'createdBy', 'version'])
    }
    const limited = await listSettingsHistory(db, 'client-a', 2)
    expect(limited.map((e) => e.version)).toEqual([3, 2])
  })
})
