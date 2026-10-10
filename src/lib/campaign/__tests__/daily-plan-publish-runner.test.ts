import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/workflows/inngest-event', () => ({ sendInngestEvent: vi.fn() }))
vi.mock('@/lib/meta/token-manager', () => ({ getMetaTokenForClient: vi.fn(), getStoredPageToken: vi.fn() }))
vi.mock('@/lib/meta/page-posts', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/meta/page-posts')>()),
  getPageAccessToken: vi.fn(),
  publishPagePhotoPost: vi.fn(),
}))

import { runDailyPlanPublish } from '../daily-plan-publish-runner'
import { supabaseAdmin } from '@/lib/supabase'
import type { CampaignDailyPublishCommand } from '../daily-plan-publish'

const ID = 'c0000000-0000-0000-0000-000000000000'
const command = {
  client_id: ID,
  campaign_id: 'a0000000-0000-0000-0000-000000000001',
  plan_id: 'b0000000-0000-0000-0000-000000000001',
  plan_revision: '2026-09-01T15:00:04.513Z',
  review_revision: '10000000-0000-0000-0000-000000000001',
  page_id: '227633594573276',
  approved: true,
  publish_authorization: true,
  no_publish: true,
  date_offset_days: 0,
} as CampaignDailyPublishCommand

describe('runDailyPlanPublish — re-checks authorisation itself (defence in depth)', () => {
  it('🔴 refuses a command whose authorisation flags are not literal true, before any database read', async () => {
    const forged = { ...command, approved: false } as unknown as CampaignDailyPublishCommand
    await expect(runDailyPlanPublish({ clientId: ID, command: forged, approvedByUserId: ID })).rejects.toThrow('INVALID_PUBLISH_COMMAND')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('🔴 refuses a missing publish_authorization flag', async () => {
    const forged = { ...command, publish_authorization: undefined } as unknown as CampaignDailyPublishCommand
    await expect(runDailyPlanPublish({ clientId: ID, command: forged, approvedByUserId: ID })).rejects.toThrow('INVALID_PUBLISH_COMMAND')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('🔴 refuses an approver that is not a uuid-shaped user id', async () => {
    await expect(runDailyPlanPublish({ clientId: ID, command, approvedByUserId: 'system' })).rejects.toThrow('INVALID_APPROVER')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })
})
