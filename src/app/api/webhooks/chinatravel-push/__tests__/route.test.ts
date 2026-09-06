import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'crypto'

const inngestSendMock = vi.fn(async () => ({ ids: ['evt_1'] }))

vi.mock('@/lib/inngest/client', () => ({
  INNGEST_APP_ID: 'magic-engine-web',
  CLOUD_FN_PREFIX: 'cloud-',
  inngest: {
    send: (...args: unknown[]) => inngestSendMock(...args),
    createFunction: () => ({ id: () => 'cloud-mock' }),
  },
}))

// Import after mocking
import { POST } from '../route'

function signedRequest(body: unknown, secret: string, event = 'push') {
  const raw = JSON.stringify(body)
  const sig = 'sha256=' + createHmac('sha256', secret).update(raw, 'utf8').digest('hex')
  return new Request('https://app.magicengine.com.au/api/webhooks/chinatravel-push', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': sig,
      'x-github-event': event,
    },
    body: raw,
  })
}

const SECRET = 'test-secret-abcxyz'

beforeEach(() => {
  inngestSendMock.mockClear()
  process.env.GITHUB_WEBHOOK_SECRET = SECRET
})
afterEach(() => {
  delete process.env.GITHUB_WEBHOOK_SECRET
})

describe('POST /api/webhooks/chinatravel-push', () => {
  it('rejects an unsigned or wrong-secret request with 401', async () => {
    const raw = JSON.stringify({ ref: 'refs/heads/main' })
    const badSig =
      'sha256=' + createHmac('sha256', 'wrong-secret').update(raw, 'utf8').digest('hex')
    const req = new Request('https://x', {
      method: 'POST',
      headers: { 'x-hub-signature-256': badSig, 'x-github-event': 'push' },
      body: raw,
    })
    const res = await POST(req as unknown as Parameters<typeof POST>[0])
    expect(res.status).toBe(401)
    expect(inngestSendMock).not.toHaveBeenCalled()
  })

  it('accepts ping and does not dispatch', async () => {
    const req = signedRequest({ zen: 'be calm' }, SECRET, 'ping')
    const res = await POST(req as unknown as Parameters<typeof POST>[0])
    expect(res.status).toBe(200)
    const json = (await res.json()) as { pong?: boolean }
    expect(json.pong).toBe(true)
    expect(inngestSendMock).not.toHaveBeenCalled()
  })

  it('ignores pushes from other repos', async () => {
    const req = signedRequest(
      {
        ref: 'refs/heads/main',
        after: 'abc',
        repository: { full_name: 'someone-else/other-repo' },
        head_commit: { modified: ['src/lib/data/tours.ts'] },
      },
      SECRET,
    )
    const res = await POST(req as unknown as Parameters<typeof POST>[0])
    expect(res.status).toBe(200)
    const json = (await res.json()) as { ignored?: string }
    expect(json.ignored).toContain('repo:')
    expect(inngestSendMock).not.toHaveBeenCalled()
  })

  it('ignores non-main branch pushes', async () => {
    const req = signedRequest(
      {
        ref: 'refs/heads/some-feature',
        after: 'abc',
        repository: { full_name: 'bigbigraydeng-maker/chinatravel' },
        head_commit: { modified: ['src/lib/data/tours.ts'] },
      },
      SECRET,
    )
    const res = await POST(req as unknown as Parameters<typeof POST>[0])
    expect(res.status).toBe(200)
    const json = (await res.json()) as { ignored?: string }
    expect(json.ignored).toContain('ref:')
    expect(inngestSendMock).not.toHaveBeenCalled()
  })

  it('short-circuits when the push does not touch site data', async () => {
    const req = signedRequest(
      {
        ref: 'refs/heads/main',
        after: 'abc',
        repository: { full_name: 'bigbigraydeng-maker/chinatravel' },
        head_commit: { modified: ['README.md', 'package-lock.json'] },
      },
      SECRET,
    )
    const res = await POST(req as unknown as Parameters<typeof POST>[0])
    expect(res.status).toBe(200)
    const json = (await res.json()) as { dispatched?: boolean; reason?: string }
    expect(json.dispatched).toBe(false)
    expect(json.reason).toBe('no_site_change')
    expect(inngestSendMock).not.toHaveBeenCalled()
  })

  it('dispatches cts_site.data.updated when tours.ts is touched on main', async () => {
    const req = signedRequest(
      {
        ref: 'refs/heads/main',
        after: 'commit_sha_xyz',
        repository: { full_name: 'bigbigraydeng-maker/chinatravel' },
        head_commit: { modified: ['src/lib/data/tours.ts'] },
        commits: [
          { added: ['src/lib/data/blogs-longtail-batch1.ts'], modified: [], removed: [] },
        ],
      },
      SECRET,
    )
    const res = await POST(req as unknown as Parameters<typeof POST>[0])
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      dispatched?: boolean
      event?: string
      commit_sha?: string
    }
    expect(json.dispatched).toBe(true)
    expect(json.event).toBe('cts_site.data.updated')
    expect(json.commit_sha).toBe('commit_sha_xyz')

    expect(inngestSendMock).toHaveBeenCalledTimes(1)
    const arg = inngestSendMock.mock.calls[0][0] as {
      name: string
      data: { commit_sha: string; changed_files: string[] }
    }
    expect(arg.name).toBe('cts_site.data.updated')
    expect(arg.data.changed_files).toContain('src/lib/data/tours.ts')
    expect(arg.data.changed_files).toContain('src/lib/data/blogs-longtail-batch1.ts')
  })
})
