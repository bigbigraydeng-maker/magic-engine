/**
 * Action classifier tests.
 *
 * The centrepiece is REAL_PRODUCTION_ACTION_TYPES: every distinct SEO
 * action_type that existed in flywheel_actions when the scoreboard was rebuilt.
 * Locking the whole list means a future rule edit that quietly starts scoring
 * developer chores again fails here instead of on a client report.
 */

import { describe, it, expect } from 'vitest'
import { classifyAction, isSiteChangeAction } from '../action-classifier'

/** The payload shape written by the 华佗 → 诸葛亮 recommendation engine. */
const RECOMMENDATION_PAYLOAD = {
  diagnostic_run_id: 'run-1',
  discovery_id:      'disc-1',
  effort:            'low',
  evidence_refs:     [],
  executable_by:     'fde',
  expected_impact:   'high',
  rank:              3,
  why_now:           '关键词未配置',
  zhuge_session_key: 'sess-1',
}

/** The payload shape written when something actually shipped to the site. */
const LIVE_PAYLOAD = {
  url:         'https://oztopbuildingsupplies.com.au/hybrid-flooring-brisbane/',
  wp_post_id:  1234,
  word_count:  2100,
  session_date: '2026-07-02',
}

describe('classifyAction — provenance layer', () => {
  it('treats a recommendation card as advice, not a website change', () => {
    const r = classifyAction({
      action_type: 'seo.refresh_blog',
      payload:     RECOMMENDATION_PAYLOAD,
    })
    expect(r.category).toBe('recommendation')
    expect(r.eligible).toBe(false)
    expect(r.rule).toBe('payload/recommendation-card')
  })

  it('excludes a recommendation card even when its name says "publish"', () => {
    // The exact case that let AI suggestions onto the scoreboard: the name is
    // indistinguishable from a real publish, only the payload gives it away.
    const r = classifyAction({
      action_type: 'publish_seo_geo_blog_post',
      payload:     RECOMMENDATION_PAYLOAD,
    })
    expect(r.eligible).toBe(false)
    expect(r.category).toBe('recommendation')
  })

  it('splits one action_type correctly by payload', () => {
    // seo.publish_blog is logged BOTH ways in production.
    expect(isSiteChangeAction({ action_type: 'seo.publish_blog', payload: RECOMMENDATION_PAYLOAD })).toBe(false)
    expect(isSiteChangeAction({ action_type: 'seo.publish_blog', payload: { blog_post_id: 'b1', mode: 'unified' } })).toBe(true)
  })

  it('accepts a live artifact under any naming convention', () => {
    for (const payload of [
      { url: 'https://x.test/a' },
      { wp_post_id: 9 },
      { blogPostId: 'b' },
      { prUrl: 'https://github.com/x/y/pull/1' },
      { slug: 'hybrid-flooring' },
    ]) {
      expect(isSiteChangeAction({ action_type: 'totally_novel_action_2027', payload })).toBe(true)
    }
  })

  it('keeps off-site work out even when it carries a URL', () => {
    // A GBP update is real work, but GSC cannot measure it — naming exclusions
    // must beat the live-artifact signal.
    const r = classifyAction({
      action_type: 'gbp_description_onestop_update',
      payload:     { url: 'https://maps.google.com/x', status: 'done' },
    })
    expect(r.category).toBe('off_site')
    expect(r.eligible).toBe(false)
  })
})

describe('classifyAction — the reported bug', () => {
  it('no longer scores the git branch cleanup as SEO work', () => {
    const r = classifyAction({
      action_type: 'codex_worktree_cleanup_wave2',
      payload: {
        branches_deleted: 5,
        note: 'global housekeeping (used CTS client_id due to NOT NULL constraint)',
        worktrees_removed: 5,
      },
    })
    expect(r.eligible).toBe(false)
    expect(r.category).toBe('dev_chore')
  })
})

// ── Full production inventory lock ────────────────────────────────────────────

const REAL_PRODUCTION_ACTION_TYPES: Array<[string, boolean]> = [
  // — real website changes —
  ['seo.publish_blog', true],
  ['cms_content_insert', true],
  ['depth_blog_launch', true],
  ['depth_blog_launch_with_images', true],
  ['depth_blog_expand_with_images', true],
  ['comparison_blog_launch_with_images', true],
  ['cts_blog_p0_unified_mode_published', true],
  ['blog_published', true],
  ['blog_generated', true],
  ['blog_yoast_metadata_rewrite', true],
  ['mass_yoast_sweep', true],
  ['page_rewrite_deployed', true],
  ['homepage_rescue', true],
  ['hub_page_published', true],
  ['hub_pages_geo_expansion', true],
  ['brisbane_hub_pages_launch', true],
  ['brand_url_consolidation', true],
  ['brand_stockist_sweep', true],
  ['da_uplift_content_launch', true],
  ['onestop_crosssell_module', true],
  ['noindex_fix', true],
  ['gsc_request_indexing', true],
  ['gsc_request_indexing_batch', true],
  ['internal_link_indexing_boost', true],
  ['visual_media_pipeline_launch', true],
  ['client_feedback_content_fix', true],

  // — not website changes —
  ['codex_worktree_cleanup_wave2', false],       // dev chore
  ['competitor_keywords_snapshot', false],       // data pull
  ['six_city_audit_and_tailor_made_strategy', false], // audit + strategy doc
  ['onsite_seo_audit_published', false],         // audit
  ['oztop_master_strategy_brief_2026_06_12', false], // strategy brief
  ['blog_brief_published', false],               // brief, not a live post
  ['page_rewrite_drafted', false],               // drafted, never deployed
  ['initiate_google_review_acquisition', false], // reputation channel
  ['gbp_description_onestop_update', false],     // GBP channel
  ['configure_target_keywords', false],          // config, no site change
  ['contact_form_cro_and_tracking', false],      // form/tracking, not search visibility
]

describe('classifyAction — production inventory', () => {
  it.each(REAL_PRODUCTION_ACTION_TYPES)(
    '%s → eligible=%s',
    (actionType, expected) => {
      // Judged on name alone: payload-free rows must still land correctly.
      expect(isSiteChangeAction({ action_type: actionType, payload: null })).toBe(expected)
    },
  )

  it('never silently swallows an unknown action type', () => {
    const r = classifyAction({ action_type: 'some_future_thing_2030', payload: null })
    expect(r.eligible).toBe(false)
    expect(r.category).toBe('unclassified') // caller reports these
  })
})
