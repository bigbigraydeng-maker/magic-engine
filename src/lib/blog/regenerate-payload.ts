/**
 * P12.R.A1 — pure helper used by the Blog Detail "Regenerate" button.
 *
 * Carries forward the SEO / GEO intent fields from an existing draft when
 * spawning a fresh draft, so the regenerated post inherits the same targeting
 * (topic, mode, source_query, primary_keyword, …) without making the FDE
 * re-type everything.
 *
 * Why a separate module: the action handler in `page.tsx` is hard to unit-test
 * in isolation. Extracting the payload shape gives us a defensible regression
 * net for the most error-prone bit — "did we forget to forward a field?"
 *
 * @param post  Blog post the FDE is regenerating
 * @returns     Request body for POST /api/clients/[id]/blog
 */
import type { BlogPost } from '@/types/magic-engine'

export type RegenerableBlogPost = Pick<
  BlogPost,
  | 'topic'
  | 'mode'
  | 'source_query_id'
  | 'source_query_text'
  | 'primary_keyword'
  | 'keyword_volume'
  | 'keyword_kd'
  | 'keyword_intent'
>

export interface BlogRegeneratePayload {
  topic:              string
  mode:               BlogPost['mode']
  source_query_id?:   string
  source_query_text?: string
  primary_keyword?:   string
  keyword_volume?:    number
  keyword_kd?:        number
  keyword_intent?:    string
  /**
   * Always `true` here — the FDE clicked Regenerate explicitly because the
   * existing draft was unsuitable. We don't want the audit's "upgrade" branch
   * to second-guess that decision and short-circuit the regeneration.
   */
  skip_audit:         true
}

export function buildBlogRegeneratePayload(post: RegenerableBlogPost): BlogRegeneratePayload {
  return {
    topic:              post.topic,
    mode:               post.mode,
    // `?? undefined` so JSON.stringify drops null fields from the wire payload
    // rather than sending `null`, which the POST route treats as truthy.
    source_query_id:    post.source_query_id   ?? undefined,
    source_query_text:  post.source_query_text ?? undefined,
    primary_keyword:    post.primary_keyword   ?? undefined,
    keyword_volume:     post.keyword_volume    ?? undefined,
    keyword_kd:         post.keyword_kd        ?? undefined,
    keyword_intent:     post.keyword_intent    ?? undefined,
    skip_audit:         true,
  }
}
