import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ from: vi.fn(), select: vi.fn(), update: vi.fn(), eq: vi.fn(),
  is: vi.fn(), maybeSingle: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: db.from } }))
import { claimClientChannelTarget, readClientChannelTarget } from '../store'

const CLIENT = '11111111-1111-4111-8111-111111111111'
const CHANNEL = 'UCmJJDRx88y0IuZXJJQuGNFw'

beforeEach(() => {
  vi.clearAllMocks()
  db.from.mockReturnValue(db)
  db.select.mockReturnValue(db)
  db.update.mockReturnValue(db)
  db.eq.mockReturnValue(db)
  db.is.mockReturnValue(db)
})

describe('YouTube first-time target binding', () => {
  it('distinguishes genuine SQL NULL from missing and malformed client config', async () => {
    db.maybeSingle.mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { youtube_channel_id: null }, error: null })
      .mockResolvedValueOnce({ data: { youtube_channel_id: 'bad' }, error: null })
      .mockResolvedValueOnce({ data: { youtube_channel_id: CHANNEL }, error: null })
    expect(await readClientChannelTarget(CLIENT)).toEqual({ kind: 'missing' })
    expect(await readClientChannelTarget(CLIENT)).toEqual({ kind: 'empty' })
    expect(await readClientChannelTarget(CLIENT)).toEqual({ kind: 'invalid' })
    expect(await readClientChannelTarget(CLIENT)).toEqual({ kind: 'configured', channelId: CHANNEL })
  })

  it('claims only an unconfigured row of this client, confirming exactly one match', async () => {
    db.select.mockResolvedValueOnce({ data: [{ id: CLIENT }], error: null })
    expect(await claimClientChannelTarget(CLIENT, CHANNEL)).toBe(true)
    expect(db.update).toHaveBeenCalledWith({ youtube_channel_id: CHANNEL })
    expect(db.eq).toHaveBeenCalledWith('id', CLIENT)
    expect(db.is).toHaveBeenCalledWith('youtube_channel_id', null)
    db.select.mockResolvedValueOnce({ data: [], error: null })
    expect(await claimClientChannelTarget(CLIENT, CHANNEL)).toBe(false)
  })

  it('never writes an invalid channel id', async () => {
    expect(await claimClientChannelTarget(CLIENT, 'bad')).toBe(false)
    expect(db.update).not.toHaveBeenCalled()
  })
})
