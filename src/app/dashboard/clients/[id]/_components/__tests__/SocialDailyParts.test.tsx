// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { OverviewReel } from '@/lib/social/week-overview/build'
import { groupReelWorks } from '@/lib/social/week-overview/reel-works'

import { ReelWorkGroups } from '../SocialDailyParts'
import { restoreCoverStubs, stubCoverMedia } from './cover-stubs'

const OLD_VIDEO = 'https://x.supabase.co/storage/v1/object/public/content-factory/renders/c1/old/final.mp4'
const NEW_VIDEO = 'https://x.supabase.co/storage/v1/object/public/content-factory/renders/c1/new/final.mp4'

function reel(overrides: Partial<OverviewReel> & { id: string; angle: string }): OverviewReel {
  return { status: 'in_review', created_at: '2026-10-12T00:00:00Z', published_at: null, permalink: null, video_state: null, music_file: null, template: null, ...overrides }
}

afterEach(() => {
  cleanup()
  restoreCoverStubs()
})

describe('ReelWorkGroups — a row that gets a newer version', () => {
  it('drops the still of the old version and asks for the video of the new one', async () => {
    const media = stubCoverMedia()
    const old = reel({ id: 'a1', angle: 'Harbour Tour v1: a', video_url: OLD_VIDEO })
    const { container, rerender } = render(<ReelWorkGroups works={groupReelWorks([old])} clientId="c1" />)
    const states = () => Array.from(container.querySelectorAll('[data-cover]')).map((tile) => tile.getAttribute('data-cover'))
    await media.showFrame()
    expect(states()).toEqual(['kept'])

    const newer = reel({ id: 'a2', angle: 'Harbour Tour v2: a', created_at: '2026-10-13T00:00:00Z', video_url: NEW_VIDEO })
    rerender(<ReelWorkGroups works={groupReelWorks([newer, old])} clientId="c1" />)

    expect(states()).toEqual(['waiting']) // the old picture is not shown for the new version
    expect(media.videos.map((video) => video.getAttribute('src'))).toEqual([null, NEW_VIDEO])
  })
})
