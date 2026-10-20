import { describe, expect, it, vi } from 'vitest'
import { buildSocialConnections, type SocialClientFacts, type SocialConnectionFact } from '../social-onboarding'
import { YOUTUBE_PUBLISH_SCOPES } from '@/lib/youtube-publish/client'

const now = new Date('2026-10-19T00:00:00Z')
const channelId = `UC${'a'.repeat(22)}`
const client: SocialClientFacts = { instagram_handle: 'example', facebook_page_url: 'https://facebook.com/example',
  tiktok_handle: 'example', facebookPublishPageId: '12345', youtubeChannelId: channelId }
const connection: SocialConnectionFact = { id: 'grant-a', provider: 'meta', purpose: 'legacy', account_id: '12345', display_name: 'Example Page',
  status: 'active', scopes: ['pages_manage_posts'], token_expiry: '2026-11-01T00:00:00Z', last_synced_at: null }
const status = (rows: SocialConnectionFact[], platform = 'facebook', config = client) =>
  buildSocialConnections(config, rows, now).find(channel => channel.platform === platform)!

describe('social authorisation facts', () => {
  it('keeps all six platforms visible without promoting registered handles to grants', () => {
    const all = buildSocialConnections(client, [], now)
    expect(all).toHaveLength(6)
    expect(status([]).authorization).toBe('not_connected')
    expect(status([], 'tiktok').authorization).toBe('not_connected')
    for (const platform of ['instagram', 'threads', 'x']) expect(status([], platform).authorization).toBe('not_available')
  })
  it('requires the configured publishing Page, not any Page/inbox authorisation', () => {
    expect(status([{ ...connection, account_id: '67890' }]).authorization).toBe('account_mismatch')
    expect(status([connection], 'facebook', { ...client, facebookPublishPageId: null }).authorization).toBe('target_missing')
    expect(status([connection]).authorization).toBe('saved')
    expect(status([connection]).publishing).toContain('不代表已可发布')
  })
  it('excludes the principal-scoped ads-only pilot including its identity', () => {
    const result = status([{ ...connection, purpose: 'meta_ads_read', display_name: 'private pilot name' }])
    expect(result.authorization).toBe('not_connected')
    expect(JSON.stringify(result)).not.toContain('private pilot name')
  })
  it.each(['revoked', 'expired', 'error', 'future_status'])('never presents %s as a saved healthy grant', state => {
    expect(status([{ ...connection, status: state }]).authorization).not.toBe('saved')
  })
  it.each([null, ['pages_read_engagement'], ['pages_manage_posts', null]])('does not infer required grant from malformed/partial scopes %j', scopes => {
    expect(status([{ ...connection, scopes }]).authorization).not.toBe('saved')
  })
  it.each([null, 'not-a-date'])('treats invalid expiry %s as unknown', token_expiry => {
    expect(status([{ ...connection, token_expiry }]).authorization).toBe('unknown')
  })
  it('expired Meta requires reauthorisation but refreshable platforms (TikTok, YouTube) remain pending refresh', () => {
    const past = { ...connection, token_expiry: '2026-10-18T00:00:00Z' }
    expect(status([past]).authorization).toBe('needs_attention')
    expect(status([{ ...past, provider: 'tiktok', scopes: ['user.info.basic', 'video.publish'] }], 'tiktok').authorization).toBe('refresh_pending')
    expect(status([{ ...past, provider: 'google_youtube', account_id: channelId, scopes: YOUTUBE_PUBLISH_SCOPES }], 'youtube').authorization).toBe('refresh_pending')
  })
  it('does not claim a TikTok handle matches an openId and keeps public review unverified', () => {
    const row = { ...connection, provider: 'tiktok', account_id: 'actual-open-id', scopes: ['user.info.basic', 'video.publish'] }
    const result = status([row], 'tiktok')
    expect(result.profile).toBe('example')
    expect(result.identity?.accountId).toBe('actual-open-id')
    expect(result.publishing).toContain('尚未实时核实')
    expect(status([row, { ...row, account_id: 'another-open-id' }], 'tiktok').authorization).toBe('ambiguous')
  })
  it('lists live TikTok grants (including expired) for admin disconnect, never revoked ones', () => {
    const row = { ...connection, provider: 'tiktok', account_id: 'open-1', display_name: 'Creator', scopes: ['user.info.basic', 'video.publish'] }
    expect(status([row], 'tiktok').managedAccounts).toEqual([{ connectionId: 'grant-a', accountId: 'open-1', displayName: 'Creator' }])
    expect(status([{ ...row, status: 'expired' }], 'tiktok').managedAccounts).toHaveLength(1)
    expect(status([{ ...row, status: 'revoked' }], 'tiktok').managedAccounts).toEqual([])
  })
  it('matches the YouTube channel, preserves private staging, and refuses ambiguous active rows', () => {
    const row = { ...connection, provider: 'google_youtube', account_id: channelId, scopes: YOUTUBE_PUBLISH_SCOPES }
    expect(status([row], 'youtube').authorization).toBe('saved')
    expect(status([row], 'youtube').publishing).toContain('私享上传')
    expect(status([{ ...row, account_id: 'other-channel' }], 'youtube').authorization).toBe('account_mismatch')
    expect(status([row, { ...row, account_id: 'other-channel' }], 'youtube').authorization).toBe('ambiguous')
    expect(status([{ ...row, scopes: [YOUTUBE_PUBLISH_SCOPES[0]] }], 'youtube').authorization).toBe('needs_attention')
  })
  it('never returns extra credential or provider-error fields, or executable profile links', () => {
    const row = { ...connection, access_token_enc: 'secret-access', error_message: 'secret-provider-error' }
    const result = status([row], 'facebook', { ...client, facebook_page_url: 'javascript:alert(1)' })
    expect(JSON.stringify(result)).not.toContain('secret-')
    expect(result).not.toHaveProperty('href')
  })
})


describe('Instagram saved facts remain identity-only', () => {
  const ig = { ...connection, provider: 'instagram', account_id: '987654321098765432', location_name: 'Example', scopes: ['instagram_business_basic'] }
  const inspect = (rows: SocialConnectionFact[], available = true, handle: string | null = '@example') => buildSocialConnections({ ...client, instagram_handle: handle }, rows, now, available)[1]
  it('requires professional ID and exact canonical username, not profile registration alone', () => {
    expect(inspect([]).authorization).toBe('not_connected')
    expect(inspect([ig]).authorization).toBe('saved')
    expect(inspect([ig]).publishing).toContain('尚不支持发布')
    expect(inspect([ig], true, 'different').authorization).toBe('account_mismatch')
    expect(inspect([{ ...ig, location_name: null }]).authorization).toBe('unknown')
    expect(inspect([{ ...ig, account_id: 'not-professional-id' }]).authorization).toBe('unknown')
    expect(inspect([ig], true, 'invalid-handle').authorization).toBe('target_missing')
  })
  it('🔴 switch on: an old read-only grant must be re-authorised; a publish-capable one is saved', () => {
    vi.stubEnv('INSTAGRAM_PUBLISH_ENABLED', 'true')
    try {
      expect(inspect([ig]).authorization).toBe('needs_attention')
      expect(inspect([{ ...ig, scopes: ['instagram_business_basic', 'instagram_business_content_publish'] }]).authorization).toBe('saved')
    } finally { vi.unstubAllEnvs() }
  })
  it('expires to needs-attention, never automatic refresh', () => {
    expect(inspect([{ ...ig, token_expiry: now.toISOString() }]).authorization).toBe('needs_attention')
    expect(inspect([{ ...ig, scopes: [] }]).authorization).toBe('needs_attention')
    expect(inspect([{ ...ig, status: 'revoked' }]).identity).toBeNull()
  })
  it('does not select among multiple rows or inherit other purposes', () => {
    expect(inspect([ig, { ...ig, id: 'other', account_id: '123456' }]).authorization).toBe('ambiguous')
    expect(inspect([{ ...ig, purpose: 'meta_ads_read' }]).authorization).toBe('not_connected')
  })
  it('disables consent without hiding an existing saved or expired identity', () => {
    expect(inspect([], false).authorization).toBe('not_available')
    expect(inspect([ig], false).authorization).toBe('saved')
    expect(inspect([ig], false).connectAvailable).toBe(false)
  })
})
