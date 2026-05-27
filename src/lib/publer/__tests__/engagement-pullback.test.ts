/**
 * Tests for engagement-pullback.ts — P12.C.3
 *
 * All Publer HTTP calls and Supabase calls are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  buildEngagementMetricRows,
  type PostEngagementData,
  type ContentPostRow,
} from '../engagement-pullback'

// ── buildEngagementMetricRows ─────────────────────────────────────────────────

describe('buildEngagementMetricRows', () => {
  const post: ContentPostRow = {
    id: 'post-1',
    client_id: 'client-1',
    flywheel_action_id: 'action-1',
    publer_post_id: 'publer-abc',
  }

  const engagement: PostEngagementData = {
    likes: 42,
    comments: 7,
    shares: 3,
  }

  it('produces three metric rows for likes/comments/shares', () => {
    const rows = buildEngagementMetricRows(post, engagement)
    expect(rows).toHaveLength(3)
  })

  it('sets correct metric_key values', () => {
    const rows = buildEngagementMetricRows(post, engagement)
    const keys = rows.map(r => r.metric_key)
    expect(keys).toContain('social.post.likes')
    expect(keys).toContain('social.post.comments')
    expect(keys).toContain('social.post.shares')
  })

  it('sets correct metric_value for each key', () => {
    const rows = buildEngagementMetricRows(post, engagement)
    const byKey = Object.fromEntries(rows.map(r => [r.metric_key, r.metric_value]))
    expect(byKey['social.post.likes']).toBe(42)
    expect(byKey['social.post.comments']).toBe(7)
    expect(byKey['social.post.shares']).toBe(3)
  })

  it('links rows to client_id', () => {
    const rows = buildEngagementMetricRows(post, engagement)
    expect(rows.every(r => r.client_id === 'client-1')).toBe(true)
  })

  it('links rows to flywheel_action_id when present', () => {
    const rows = buildEngagementMetricRows(post, engagement)
    expect(rows.every(r => r.source_ref?.flywheel_action_id === 'action-1')).toBe(true)
  })

  it('omits action_id link when flywheel_action_id is null', () => {
    const postNoAction: ContentPostRow = { ...post, flywheel_action_id: null }
    const rows = buildEngagementMetricRows(postNoAction, engagement)
    expect(rows.every(r => r.source_ref?.flywheel_action_id === undefined)).toBe(true)
  })

  it('handles zero engagement gracefully', () => {
    const zero: PostEngagementData = { likes: 0, comments: 0, shares: 0 }
    const rows = buildEngagementMetricRows(post, zero)
    expect(rows.every(r => r.metric_value === 0)).toBe(true)
  })
})
