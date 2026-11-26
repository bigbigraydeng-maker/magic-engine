import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_EXTERNAL_DATA_PULL_CLIENT_ID,
  filterClientIdsForExternalDataPull,
  filterRowsWithClientIdCamel,
  filterRowsWithId,
  isClientAllowedForExternalDataPull,
  isExternalDataPullUnrestricted,
  partitionExternalDataPull,
} from '@/lib/clients/external-data-pull-allowlist'

const CTS = DEFAULT_EXTERNAL_DATA_PULL_CLIENT_ID
const OTHER = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('external-data-pull allowlist', () => {
  it('defaults to CTS only when env is unset', () => {
    vi.stubEnv('EXTERNAL_DATA_PULL_CLIENT_IDS', '')
    delete process.env.EXTERNAL_DATA_PULL_CLIENT_IDS
    expect(isExternalDataPullUnrestricted()).toBe(false)
    expect(isClientAllowedForExternalDataPull(CTS)).toBe(true)
    expect(isClientAllowedForExternalDataPull(OTHER)).toBe(false)
    expect(filterClientIdsForExternalDataPull([CTS, OTHER])).toEqual([CTS])
  })

  it('treats * and all as unrestricted', () => {
    vi.stubEnv('EXTERNAL_DATA_PULL_CLIENT_IDS', '*')
    expect(isExternalDataPullUnrestricted()).toBe(true)
    expect(isClientAllowedForExternalDataPull(OTHER)).toBe(true)
    vi.stubEnv('EXTERNAL_DATA_PULL_CLIENT_IDS', 'ALL')
    expect(isExternalDataPullUnrestricted()).toBe(true)
  })

  it('parses an explicit comma-separated allowlist', () => {
    vi.stubEnv('EXTERNAL_DATA_PULL_CLIENT_IDS', `${CTS}, ${OTHER}`)
    expect(filterRowsWithId([{ id: CTS }, { id: OTHER }, { id: '00000000-0000-0000-0000-000000000001' }])).toEqual([
      { id: CTS },
      { id: OTHER },
    ])
    expect(filterRowsWithClientIdCamel([{ clientId: OTHER }])).toEqual([{ clientId: OTHER }])
  })

  it('fail-closed to CTS when env is only invalid tokens', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubEnv('EXTERNAL_DATA_PULL_CLIENT_IDS', 'not-a-uuid, also-bad')
    expect(isClientAllowedForExternalDataPull(CTS)).toBe(true)
    expect(isClientAllowedForExternalDataPull(OTHER)).toBe(false)
    expect(isClientAllowedForExternalDataPull(CTS)).toBe(true)
    expect(warn).toHaveBeenCalledTimes(1)
    const message = String(warn.mock.calls[0]?.[0])
    expect(message).toContain('dropped 2 non-UUID')
    expect(message).not.toContain('not-a-uuid')
    expect(message).not.toContain('also-bad')
    warn.mockRestore()
  })

  it('keeps valid ids and warns once when a non-UUID token is mixed in', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubEnv('EXTERNAL_DATA_PULL_CLIENT_IDS', `${CTS}, dropped-token`)
    expect(filterClientIdsForExternalDataPull([CTS, OTHER])).toEqual([CTS])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).not.toContain('dropped-token')
    warn.mockRestore()
  })

  it('partitionExternalDataPull returns kept rows and a skip count', () => {
    vi.stubEnv('EXTERNAL_DATA_PULL_CLIENT_IDS', '')
    delete process.env.EXTERNAL_DATA_PULL_CLIENT_IDS
    const rows = [{ id: CTS }, { id: OTHER }]
    expect(partitionExternalDataPull(rows, (row) => row.id)).toEqual({
      kept: [{ id: CTS }],
      skippedCount: 1,
    })
    vi.stubEnv('EXTERNAL_DATA_PULL_CLIENT_IDS', '*')
    expect(partitionExternalDataPull(rows, (row) => row.id)).toEqual({
      kept: rows,
      skippedCount: 0,
    })
  })

  it('matches client ids case-insensitively', () => {
    vi.stubEnv('EXTERNAL_DATA_PULL_CLIENT_IDS', CTS.toUpperCase())
    expect(isClientAllowedForExternalDataPull(CTS)).toBe(true)
  })
})