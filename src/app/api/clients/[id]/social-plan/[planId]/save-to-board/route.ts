import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import type { SocialPlanOutput } from '@/lib/social/social-plan-templates'

function postRoute(contentType: string): string {
  if (contentType === 'promotional') return 'route_a'
  if (contentType === 'storytelling') return 'route_b'
  return 'route_c'
}

// POST /api/clients/[id]/social-plan/[planId]/save-to-board
// Reads plan_data from social_plans, inserts posts[] + stories[] into content_posts as drafts.
// When an approved marketing plan exists, also creates execution_items so they appear in the
// execution board, and back-links content_posts.execution_item_id for the flywheel trigger.
// Simple insert — no dedup, caller may call multiple times; UI shows saved count.
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string; planId: string } }
) {
  // 鉴权闸（2026-08-05 狄仁杰复审）：这条路由原来**完全没有任何登录校验**，
  // 而中间件的 matcher 只覆盖 /dashboard 和 /portal，不管 /api。
  // 实测：匿名 curl 带一个 client_id 就能拿到该客户的内容流水线（CTS 返回 30KB）。
  const __access = await requireDashboardClientAccess(params.id)
  if (!__access.ok) {
    return NextResponse.json({ error: __access.error }, { status: __access.status })
  }

  const { id: clientId, planId } = params

  try {
    const { data: planRow, error: planErr } = await supabaseAdmin
      .from('social_plans')
      .select('id, campaign_id, plan_data')
      .eq('id', planId)
      .eq('client_id', clientId)
      .single()

    if (planErr || !planRow) {
      return NextResponse.json({ success: false, error: 'Plan not found' }, { status: 404 })
    }

    const planData = planRow.plan_data as SocialPlanOutput
    const posts = planData.posts ?? []
    const stories = planData.stories ?? []

    // Find the latest approved marketing plan to link execution_items.
    // Only 'approved' is a valid status for board-linkage; no execution_items
    // are created without it (to avoid violating the source_consistency CHECK constraint).
    const { data: mpRow } = await supabaseAdmin
      .from('marketing_plans')
      .select('id')
      .eq('client_id', clientId)
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string }>()
    const marketingPlanId = mpRow?.id ?? null

    // Compute next sort_order to append new items after existing ones
    let nextSortOrder = 200
    if (marketingPlanId) {
      const { data: maxRow } = await supabaseAdmin
        .from('execution_items')
        .select('sort_order')
        .eq('marketing_plan_id', marketingPlanId)
        .order('sort_order', { ascending: false })
        .limit(1)
        .maybeSingle<{ sort_order: number }>()
      nextSortOrder = (maxRow?.sort_order ?? 199) + 1
    }

    const postRows = posts.map((post) => ({
      client_id:         clientId,
      campaign_brief_id: planRow.campaign_id ?? null,
      title:             `${post.content_type} — ${post.copy.slice(0, 30)}`,
      route:             postRoute(post.content_type),
      platforms:         ['facebook'],
      status:            'draft',
      caption:           post.copy,
      hashtags:          post.hashtags,
      visual_brief:      post.image_prompt,
    }))

    const storyRows = stories.map((story, i) => ({
      client_id:         clientId,
      campaign_brief_id: planRow.campaign_id ?? null,
      title:             `Story ${i + 1} — ${story.copy.slice(0, 25)}`,
      route:             'story',
      platforms:         ['facebook'],
      status:            'draft',
      caption:           `${story.copy}\n\n→ ${story.cta}`,
      visual_brief:      story.visual_prompt,
    }))

    let savedPosts = 0
    let savedStories = 0
    let executionItemsCreated = 0

    // ── Posts ──────────────────────────────────────────────────────────────────
    if (postRows.length > 0) {
      const { data: insertedPosts, error } = await supabaseAdmin
        .from('content_posts')
        .insert(postRows)
        .select('id, title')
      if (error) throw error
      savedPosts = postRows.length

      if (marketingPlanId && insertedPosts && insertedPosts.length > 0) {
        const typed = insertedPosts as { id: string; title: string }[]
        const execRows = typed.map((cp, idx) => ({
          prescription_id:   null,
          marketing_plan_id: marketingPlanId,
          source:            'marketing_plan',
          client_id:         clientId,
          finding_id:        null,
          content_post_id:   cp.id,
          dimension:         'social',
          phase:             1,
          title:             cp.title,
          description:       posts[idx]?.copy?.slice(0, 120) ?? cp.title,
          fix_type:          'fde_manual',
          status:            'pending',
          steps_json: {
            source:          'social_plan',
            kind:            'social_post',
            estimated_hours: 1,
            required_skills: ['social copywriting'],
          },
          execution_target:  { mode: 'in_house', flywheel: 'social', module: 'social_matrix' },
          sort_order:        nextSortOrder + idx,
        }))

        const { data: createdExec, error: execErr } = await supabaseAdmin
          .from('execution_items')
          .insert(execRows)
          .select('id, content_post_id')
        if (execErr) {
          console.error('[save-to-board] execution_items insert (posts):', execErr)
        } else if (createdExec) {
          executionItemsCreated += createdExec.length
          // Back-link content_posts.execution_item_id so the flywheel trigger fires on publish
          const backLinks = (createdExec as { id: string; content_post_id: string }[])
          await Promise.all(backLinks.map(ei =>
            supabaseAdmin
              .from('content_posts')
              .update({ execution_item_id: ei.id })
              .eq('id', ei.content_post_id)
              .then(({ error: e }) => {
                if (e) console.error('[save-to-board] back-link (post):', e)
              })
          ))
        }
      }
    }

    // ── Stories ────────────────────────────────────────────────────────────────
    if (storyRows.length > 0) {
      const { data: insertedStories, error } = await supabaseAdmin
        .from('content_posts')
        .insert(storyRows)
        .select('id, title')
      if (error) throw error
      savedStories = storyRows.length

      if (marketingPlanId && insertedStories && insertedStories.length > 0) {
        const typed = insertedStories as { id: string; title: string }[]
        const storyOffset = nextSortOrder + postRows.length
        const execRows = typed.map((cp, idx) => ({
          prescription_id:   null,
          marketing_plan_id: marketingPlanId,
          source:            'marketing_plan',
          client_id:         clientId,
          finding_id:        null,
          content_post_id:   cp.id,
          dimension:         'social',
          phase:             1,
          title:             cp.title,
          description:       stories[idx]?.copy?.slice(0, 120) ?? cp.title,
          fix_type:          'fde_manual',
          status:            'pending',
          steps_json: {
            source:          'social_plan',
            kind:            'social_story',
            estimated_hours: 0.5,
            required_skills: ['social copywriting'],
          },
          execution_target:  { mode: 'in_house', flywheel: 'social', module: 'social_matrix' },
          sort_order:        storyOffset + idx,
        }))

        const { data: createdExec, error: execErr } = await supabaseAdmin
          .from('execution_items')
          .insert(execRows)
          .select('id, content_post_id')
        if (execErr) {
          console.error('[save-to-board] execution_items insert (stories):', execErr)
        } else if (createdExec) {
          executionItemsCreated += createdExec.length
          const backLinks = (createdExec as { id: string; content_post_id: string }[])
          await Promise.all(backLinks.map(ei =>
            supabaseAdmin
              .from('content_posts')
              .update({ execution_item_id: ei.id })
              .eq('id', ei.content_post_id)
              .then(({ error: e }) => {
                if (e) console.error('[save-to-board] back-link (story):', e)
              })
          ))
        }
      }
    }

    return NextResponse.json({
      success: true,
      saved_posts: savedPosts,
      saved_stories: savedStories,
      execution_items_created: executionItemsCreated,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[save-to-board]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
