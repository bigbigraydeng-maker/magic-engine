import { describe, expect, it } from 'vitest'
import { POST } from '../run/route'

describe('POST /api/clients/[id]/diagnostic/run', () => {
  it('returns 410 and does not start a diagnostic run', async () => {
    const res = POST()
    expect(res.status).toBe(410)
    const body = await res.json()
    expect(body).toMatchObject({ retired: true })
    expect(body.error).toContain('已废弃')
  })
})
