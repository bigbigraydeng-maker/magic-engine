/**
 * SP-VI.1 — Regenerate Posts + Stories with brand-compliant image prompts
 *
 * Background: before SP-VI.1, generatePosts() and generateStories() used a
 * 12-line system prompt that produced generic, off-brand image_prompt strings
 * (e.g. "A picturesque market scene along the Silk Road, showcasing vibrant
 * stalls..."). After SP-VI.1, both functions output structured creative fields
 * (image_subject / composition / lighting / mood_words / format) which are
 * deterministically assembled into a brand-compliant image_prompt using the
 * client's vi_* fields from Master Brief + Campaign Brief.
 *
 * This script re-runs the new generators against historical social_plans rows.
 * The plan_data.strategy and plan_data.reels are preserved as-is — only posts
 * and stories are regenerated. Original copy/cta/hashtags will change too,
 * because the generators produce them atomically with the visual fields.
 *
 * Usage:
 *   # Dry-run (default — no writes, prints summary):
 *   npx tsx --env-file=.env.local scripts/regenerate-social-plan-images.ts
 *
 *   # Single plan:
 *   PLAN_ID=<uuid> npx tsx --env-file=.env.local scripts/regenerate-social-plan-images.ts
 *
 *   # All plans for one client:
 *   CLIENT_ID=<uuid> npx tsx --env-file=.env.local scripts/regenerate-social-plan-images.ts
 *
 *   # Filter by date (plans created on/after this date):
 *   SINCE=2026-05-01 npx tsx --env-file=.env.local scripts/regenerate-social-plan-images.ts
 *
 *   # Actually write to DB (must be combined with one of the above filters):
 *   WRITE=1 PLAN_ID=<uuid> npx tsx --env-file=.env.local scripts/regenerate-social-plan-images.ts
 */

import { createClient } from '@supabase/supabase-js'
import { formatBriefForPrompt } from '../src/lib/content/brief-injector'
import { formatCampaignForPrompt, getCampaignById } from '../src/lib/content/campaign-injector'
import {
  extractBrandVisualDNA,
  extractCampaignVisualDirection,
  generateChannelStrategy,
  generatePosts,
  generateStories,
  DEFAULT_CONFIG,
} from '../src/lib/social/social-plan-templates'
import type { GenerationConfig } from '../src/lib/social/social-plan-templates'
import type { MasterBrief } from '../src/types/magic-engine'

// ── Setup ────────────────────────────────────────────────────────────────────

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const WRITE     = process.env.WRITE === '1'
const PLAN_ID   = process.env.PLAN_ID   ?? null
const CLIENT_ID = process.env.CLIENT_ID ?? null
const SINCE     = process.env.SINCE     ?? null

// ── Types ────────────────────────────────────────────────────────────────────

interface SocialPlanRow {
  id:          string
  client_id:   string
  campaign_id: string
  platform:    string
  wave_number: number
  created_at:  string
  plan_data:   {
    strategy: unknown
    reels:    unknown[]
    posts:    unknown[]
    stories:  unknown[]
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Safety: refuse to write without a filter — protects against an empty-arg
  // full table rewrite.
  if (WRITE && !PLAN_ID && !CLIENT_ID && !SINCE) {
    console.error(
      'Refusing to WRITE without a filter. Set PLAN_ID, CLIENT_ID, or SINCE.\n' +
      'Run without WRITE=1 to dry-run across the whole table.'
    )
    process.exit(1)
  }

  console.log('Mode    :', WRITE ? 'WRITE (will update DB)' : 'DRY-RUN (no DB writes)')
  console.log('PLAN_ID :', PLAN_ID   ?? '(all)')
  console.log('CLIENT_ID:', CLIENT_ID ?? '(all)')
  console.log('SINCE   :', SINCE     ?? '(all time)')
  console.log()

  // 1. Fetch plans
  let query = supabase
    .from('social_plans')
    .select('id, client_id, campaign_id, platform, wave_number, created_at, plan_data')
    .order('created_at', { ascending: false })

  if (PLAN_ID)   query = query.eq('id', PLAN_ID)
  if (CLIENT_ID) query = query.eq('client_id', CLIENT_ID)
  if (SINCE)     query = query.gte('created_at', SINCE)

  const { data: plans, error } = await query
  if (error) throw error
  if (!plans || plans.length === 0) {
    console.log('No plans matched the filter. Nothing to do.')
    return
  }

  console.log(`Found ${plans.length} plan(s).\n`)

  let ok = 0
  let skipped = 0
  let failed = 0

  // 2. Process each plan
  for (const plan of plans as SocialPlanRow[]) {
    const tag = `[${plan.id.slice(0, 8)}] client=${plan.client_id.slice(0, 8)}`
    try {
      // 2a. Fetch active master brief for the client
      const { data: brief } = await supabase
        .from('master_briefs')
        .select('*')
        .eq('client_id', plan.client_id)
        .or('status.eq.active,is_active.eq.true')
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!brief) {
        console.warn(`${tag} SKIP — no active master brief.`)
        skipped++
        continue
      }

      // 2b. Fetch the campaign this plan was tied to
      const campaign = await getCampaignById(plan.client_id, plan.campaign_id)
      if (!campaign) {
        console.warn(`${tag} SKIP — campaign ${plan.campaign_id} not found.`)
        skipped++
        continue
      }

      // 2c. Build context strings (same shape as live route)
      const briefText    = formatBriefForPrompt(brief as unknown as MasterBrief)
      const campaignText = formatCampaignForPrompt(campaign)

      // 2d. Extract structured visual DNA for the new builders
      const brandDNA          = extractBrandVisualDNA(brief as unknown as MasterBrief)
      const campaignDirection = extractCampaignVisualDirection(campaign)

      // 2e. Use same counts as the original plan so we regenerate "like for like"
      const config: GenerationConfig = {
        ...DEFAULT_CONFIG,
        platform:      (plan.platform === 'instagram' || plan.platform === 'tiktok')
                         ? plan.platform : 'facebook',
        posts_count:   Array.isArray(plan.plan_data?.posts)   ? plan.plan_data.posts.length   : DEFAULT_CONFIG.posts_count,
        stories_count: Array.isArray(plan.plan_data?.stories) ? plan.plan_data.stories.length : DEFAULT_CONFIG.stories_count,
        reels_count:   DEFAULT_CONFIG.reels_count, // reels untouched, kept for type completeness
      }

      // 2f. Regenerate strategy + posts + stories (reels stay as-is)
      const strategy = await generateChannelStrategy(briefText, campaignText, config)
      const [newPosts, newStories] = await Promise.all([
        generatePosts(strategy, brandDNA, campaignDirection, briefText, campaignText, config),
        generateStories(strategy, brandDNA, campaignDirection, briefText, campaignText, config),
      ])

      const updatedPlan = {
        ...plan.plan_data,
        strategy,
        posts:   newPosts,
        stories: newStories,
      }

      // 2g. Write or preview
      if (WRITE) {
        const { error: updateErr } = await supabase
          .from('social_plans')
          .update({ plan_data: updatedPlan })
          .eq('id', plan.id)
        if (updateErr) throw updateErr
        console.log(`${tag} OK — wrote ${newPosts.length} posts + ${newStories.length} stories.`)
      } else {
        console.log(`${tag} DRY — would write ${newPosts.length} posts + ${newStories.length} stories.`)
        if (newPosts[0]) {
          console.log(`         sample post image_prompt: ${newPosts[0].image_prompt.slice(0, 160)}…`)
        }
      }
      ok++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`${tag} FAIL — ${msg}`)
      failed++
    }
  }

  console.log()
  console.log(`Summary: ${ok} succeeded · ${skipped} skipped · ${failed} failed.`)
  if (!WRITE && ok > 0) {
    console.log('Re-run with WRITE=1 (combined with PLAN_ID / CLIENT_ID / SINCE) to persist.')
  }
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
