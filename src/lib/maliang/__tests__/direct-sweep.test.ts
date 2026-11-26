import { describe, expect, it, vi } from 'vitest'
import { contentFactoryPublicUrl, MALIANG_DIRECT_BATCH, runMaliangDirectSweep } from '../direct-sweep'

const order = (n: number) => ({ client_id: 'c1', work_order_id: `wo-${n}`, output_url: `https://x/${n}.mp4` })

describe('runMaliangDirectSweep', () => {
  it('reviews pending orders one by one and reports each outcome', async () => {
    const review = vi.fn(async (o: ReturnType<typeof order>) =>
      o.work_order_id === 'wo-2' ? { kind: 'unread' as const, reason: 'video_url_mismatch' } : { kind: 'checked' as const, status: 'pass', reasons: [] })
    const receipt = await runMaliangDirectSweep({ listPending: async () => [order(1), order(2)], review, batch: 2 })
    expect(receipt.status).toBe('done')
    expect(receipt.results.map((r) => r.outcome.kind)).toEqual(['checked', 'unread'])
    expect(review).toHaveBeenCalledTimes(2)
  })

  it('never reviews more than one batch per run, even if the list returns more', async () => {
    const review = vi.fn(async () => ({ kind: 'checked' as const, status: 'pass', reasons: [] }))
    const listPending = vi.fn(async () => [1, 2, 3, 4, 5].map(order))
    const receipt = await runMaliangDirectSweep({ listPending, review })
    expect(listPending).toHaveBeenCalledWith(MALIANG_DIRECT_BATCH)
    expect(review).toHaveBeenCalledTimes(MALIANG_DIRECT_BATCH)
    expect(receipt.picked).toBe(MALIANG_DIRECT_BATCH)
  })

  it('keeps going after one review throws, and reports a list failure without reviewing', async () => {
    const review = vi.fn(async (o: ReturnType<typeof order>) => {
      if (o.work_order_id === 'wo-1') throw new Error('model down')
      return { kind: 'checked' as const, status: 'pass', reasons: [] }
    })
    const receipt = await runMaliangDirectSweep({ listPending: async () => [order(1), order(2)], review, batch: 2 })
    expect(receipt.results[0].outcome).toEqual({ kind: 'unread', reason: 'model down' })
    expect(receipt.results[1].outcome.kind).toBe('checked')

    const failed = await runMaliangDirectSweep({ listPending: async () => { throw new Error('db') }, review })
    expect(failed).toMatchObject({ status: 'list_failed', picked: 0, error: 'db' })
  })

  it('refuses to start a second run while one is still going', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => { release = r })
    const first = runMaliangDirectSweep({
      listPending: async () => [order(1)],
      review: async () => { await gate; return { kind: 'checked', status: 'pass', reasons: [] } },
    })
    const second = await runMaliangDirectSweep({ listPending: async () => [order(2)], review: vi.fn() })
    expect(second.status).toBe('busy')
    release()
    expect((await first).status).toBe('done')
  })

  it('builds the same public file URL the admit step sends', () => {
    expect(contentFactoryPublicUrl('https://p.supabase.co/', 'c1/external/a.mp4'))
      .toBe('https://p.supabase.co/storage/v1/object/public/content-factory/c1/external/a.mp4')
  })
})
