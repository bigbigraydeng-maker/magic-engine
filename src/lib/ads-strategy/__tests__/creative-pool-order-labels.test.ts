import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: () => {
      let cols = ''
      const builder: Record<string, unknown> = {
        select(value: string) { cols = value; return builder },
        eq() { return builder },
        in() { return builder },
        not() { return builder },
        then(resolve: (value: unknown) => unknown) {
          if (cols === 'id, angle') {
            return resolve({ data: [{ id: 'wo-1', angle: 'Harbour: 15-second reel' }], error: null })
          }
          return resolve({
            data: [{ angle: 'Published: reel', published_ref: { video_id: '555', published_at: '2026-10-11T00:00:00.000Z' } }],
            error: null,
          })
        },
      }
      return builder
    },
  },
}))

import { loadCreativeLabels } from '../creative-pool-labels'

describe('loadCreativeLabels', () => {
  it('names a work-order entry from its angle and a video id from the published receipt', async () => {
    const labels = await loadCreativeLabels('c-1', ['555', 'wo-1'])
    expect(labels['555']).toMatchObject({ title: 'Published', url: 'https://www.facebook.com/reel/555' })
    expect(labels['wo-1']).toMatchObject({ title: 'Harbour', subtitle: '15-second reel', url: null })
  })
})
