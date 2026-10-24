/**
 * analyzeViralReference must never run a shell and never touch yt-dlp with an unsafe url.
 * child_process is mocked: we assert the argv array, nothing real is executed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  execFile: vi.fn(),
  exec: vi.fn(),
  from: vi.fn(),
  resolve: vi.fn(),
}))
vi.mock('child_process', () => ({
  default: { execFile: m.execFile, exec: m.exec },
  execFile: m.execFile,
  exec: m.exec,
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: m.from } }))
vi.mock('@/lib/net/safe-fetch', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/net/safe-fetch')>()
  return { ...actual, resolveValidatedAddress: m.resolve }
})
vi.mock('../youtube-metadata', () => ({ fetchYouTubeMetadata: vi.fn().mockResolvedValue({}) }))

import { analyzeViralReference } from '../viral-analyzer'

const rowUpdates: Array<Record<string, unknown>> = []

beforeEach(() => {
  vi.resetAllMocks()
  rowUpdates.length = 0
  process.env.GEMINI_API_KEY = 'test-key'
  m.resolve.mockResolvedValue({ address: '93.184.216.34', family: 4, hostname: 'example.com' })
  m.from.mockImplementation((table: string) => {
    if (table !== 'viral_reference_library') throw new Error(`unexpected table ${table}`)
    return {
      update: (payload: Record<string, unknown>) => {
        rowUpdates.push(payload)
        return { eq: () => Promise.resolve({ error: null }) }
      },
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { analysis_attempts: 2 }, error: null }),
        }),
      }),
    }
  })
  // promisify(execFile) uses the node-style callback as last arg
  m.execFile.mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1] as (e: Error | null, r?: unknown) => void
    cb(new Error('stop-after-exec'))
  })
})

const PAYLOADS = [
  'https://example.com/v"; touch /tmp/x #',
  'https://example.com/$(touch${IFS}/tmp/x)',
  'https://example.com/`touch /tmp/x`',
  'https://example.com/v\ntouch /tmp/x',
  'file:///etc/passwd',
  'http://169.254.169.254/latest/meta-data/',
  'http://127.0.0.1:8080/x',
]

describe('analyzeViralReference command-injection hardening', () => {
  it.each(PAYLOADS)('never executes anything for %j and records an error', async url => {
    await expect(analyzeViralReference('ref-1', url)).rejects.toThrow(/Unsafe viral source url/)
    expect(m.execFile).not.toHaveBeenCalled()
    expect(m.exec).not.toHaveBeenCalled()
    expect(rowUpdates.some(u => u.analysis_status === 'error' && u.analysis_attempts === 3)).toBe(true)
  })

  it('upload:// rows get a clear error and never reach yt-dlp or DNS', async () => {
    await expect(analyzeViralReference('ref-4', 'upload://clip.mp4')).rejects.toThrow(/not stored/)
    expect(m.execFile).not.toHaveBeenCalled()
    expect(m.resolve).not.toHaveBeenCalled()
    expect(rowUpdates.some(u => String(u.analysis_error).includes('not stored'))).toBe(true)
  })

  it('a hostname that resolves to a private address is rejected before yt-dlp runs', async () => {
    m.resolve.mockImplementation(async () => { throw new Error('blocked') })
    await expect(analyzeViralReference('ref-2', 'https://rebind.example.com/v')).rejects.toThrow(/Unsafe viral source url/)
    expect(m.execFile).not.toHaveBeenCalled()
  })

  it('XiaoHongShu links are terminal and never reach yt-dlp', async () => {
    await expect(analyzeViralReference('ref-xhs', 'https://www.xiaohongshu.com/explore/abc')).rejects.toThrow(/No video formats found/)
    expect(m.execFile).not.toHaveBeenCalled()
    expect(m.resolve).not.toHaveBeenCalled()
    expect(rowUpdates.some(u => u.analysis_status === 'terminal' && u.next_retry_at === null)).toBe(true)
  })

  it('a legitimate url reaches yt-dlp as an argv element, after `--`, with no shell', async () => {
    await expect(analyzeViralReference('ref-3', 'https://www.facebook.com/reel/123')).rejects.toThrow(/stop-after-exec/)
    expect(m.exec).not.toHaveBeenCalled()
    expect(m.execFile).toHaveBeenCalledTimes(1)
    const [cmd, args, opts] = m.execFile.mock.calls[0]
    expect(typeof cmd).toBe('string')
    expect(cmd).not.toMatch(/["\s]/)
    expect(Array.isArray(args)).toBe(true)
    expect(args[args.length - 2]).toBe('--')
    expect(args[args.length - 1]).toBe('https://www.facebook.com/reel/123')
    const out = args[args.indexOf('-o') + 1] as string
    expect(out).toMatch(/viral_ref_[0-9a-f-]{36}\.mp4$/)
    expect((opts as { shell?: unknown }).shell).toBeUndefined()
  })
})
