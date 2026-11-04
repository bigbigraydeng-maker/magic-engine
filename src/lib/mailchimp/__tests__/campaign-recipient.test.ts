import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getCampaignRecipientStatus, MailchimpError } from '../client'

const KEY = 'abc123-us14'

function reply(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getCampaignRecipientStatus', () => {
  it('asks for the MD5 of the lower-cased, trimmed address', async () => {
    const fetchMock = vi.fn(async () => reply(200, { status: 'sent' }))
    vi.stubGlobal('fetch', fetchMock)
    await getCampaignRecipientStatus(KEY, 'camp1', '  Amy@Gmail.COM ')
    const url = String((fetchMock.mock.calls[0] as unknown[])[0])
    const hash = createHash('md5').update('amy@gmail.com').digest('hex')
    expect(url).toContain(`/reports/camp1/sent-to/${hash}`)
    expect(url).toContain('us14.api.mailchimp.com')
  })

  it.each([
    ['sent', 'sent'],
    ['soft', 'soft'],
    ['hard', 'hard'],
    ['something-new', 'sent'], // unknown status: count it (over-counting is the safe direction)
  ])('status %s -> %s', async (raw, expected) => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(200, { status: raw })))
    expect(await getCampaignRecipientStatus(KEY, 'camp1', 'a@b.com')).toBe(expected)
  })

  it('a body without a status still counts as sent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(200, {})))
    expect(await getCampaignRecipientStatus(KEY, 'camp1', 'a@b.com')).toBe('sent')
  })

  it('404 means the address was not a recipient', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(404, 'not found')))
    expect(await getCampaignRecipientStatus(KEY, 'camp1', 'a@b.com')).toBe('not_recipient')
  })

  it('any other failure is thrown, never read as "not a recipient"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(500, 'boom')))
    await expect(getCampaignRecipientStatus(KEY, 'camp1', 'a@b.com')).rejects.toBeInstanceOf(MailchimpError)
    vi.stubGlobal('fetch', vi.fn(async () => reply(401, 'nope')))
    await expect(getCampaignRecipientStatus(KEY, 'camp1', 'a@b.com')).rejects.toBeInstanceOf(MailchimpError)
  })

  it('a network failure is thrown too', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await expect(getCampaignRecipientStatus(KEY, 'camp1', 'a@b.com')).rejects.toBeInstanceOf(MailchimpError)
  })
})
