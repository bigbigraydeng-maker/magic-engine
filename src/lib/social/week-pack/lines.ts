/**
 * One approval step. A failure is a line on the receipt. Nothing here rolls other lines back.
 */

import type { WeekPackLine, WeekPackManifest } from './types'

export interface StoryAuthResult {
  ok: boolean
  code: 'story_authorized' | 'story_already_authorized' | 'story_forbidden' | 'story_failed'
}

export interface ReelPromoteResult {
  ok: boolean
  code: 'reel_promoted' | 'reel_failed' | 'reel_forbidden' | 'skipped_switch_off' | 'preview_required' | 'first_comment_failed'
  text: string
}

/** The video is already public. A failed first comment is its own failure, not a full success. */
export function promotedReelLine(status: 'ok' | 'failed'): ReelPromoteResult {
  if (status === 'failed') {
    return {
      ok: false,
      code: 'first_comment_failed',
      text: '视频已经公开，第一条评论没有发出去。',
    }
  }
  return { ok: true, code: 'reel_promoted', text: '这条视频已按预览转公开。' }
}

const STORY_TEXT: Record<StoryAuthResult['code'], string> = {
  story_authorized: 'Story 已授权。到点仍由原来的发布器发送，这里没有另写一个。',
  story_already_authorized: 'Story 本来就是已授权，没有重复授权。',
  story_forbidden: 'Story 没授权：这一点仍要全局管理员来点。别的不撤回。',
  story_failed: 'Story 没授权成功。别的不撤回。',
}

export function storyLine(packId: string | null, result: StoryAuthResult): WeekPackLine {
  return {
    kind: 'story',
    stable_id: packId,
    code: result.code,
    ok: result.ok,
    text: STORY_TEXT[result.code],
  }
}

export function storyUnreadLine(): WeekPackLine {
  return {
    kind: 'story', stable_id: null, code: 'story_unread', ok: false,
    text: 'Story 读不到，没有当成 0 条，也没有授权。',
  }
}

export function storyNoneLine(): WeekPackLine {
  return {
    kind: 'story', stable_id: null, code: 'story_none', ok: true,
    text: '下一周没有可授权的 Story 周包。',
  }
}

export function postLine(): WeekPackLine {
  return {
    kind: 'post', stable_id: null, code: 'skipped_not_wired', ok: true,
    text: '图文尚未接入，没有授权。',
  }
}

export function reelsOffLine(): WeekPackLine {
  return {
    kind: 'reel', stable_id: null, code: 'skipped_switch_off', ok: true,
    text: '视频不在这里转公开，请仍在视频工厂逐条处理。',
  }
}

export function reelsUnreadLine(): WeekPackLine {
  return {
    kind: 'reel', stable_id: null, code: 'reel_unread', ok: false,
    text: '视频读不到，没有当成 0 条，也没有转公开。',
  }
}

export function previewRequiredLine(workOrderId: string): WeekPackLine {
  return {
    kind: 'reel', stable_id: workOrderId, code: 'preview_required', ok: false,
    text: '有一条视频还没预览，没有公开。其他条不撤回。',
  }
}

export async function runStoryLine(
  manifest: WeekPackManifest,
  authorize: (packId: string, contentHash: string) => Promise<StoryAuthResult>,
): Promise<WeekPackLine> {
  if (manifest.story.read_state !== 'ok') return storyUnreadLine()
  if (!manifest.story.pack_id || !manifest.story.content_hash) return storyNoneLine()
  try {
    const result = await authorize(manifest.story.pack_id, manifest.story.content_hash)
    return storyLine(manifest.story.pack_id, result)
  } catch {
    return storyLine(manifest.story.pack_id, { ok: false, code: 'story_failed' })
  }
}

export async function runReelLines(
  manifest: WeekPackManifest,
  reelGoPublic: boolean,
  tokens: ReadonlyMap<string, string>,
  promote: (workOrderId: string, previewToken: string) => Promise<ReelPromoteResult>,
): Promise<WeekPackLine[]> {
  if (!reelGoPublic) return [reelsOffLine()]
  if (manifest.reels.read_state !== 'ok') return [reelsUnreadLine()]
  const lines: WeekPackLine[] = []
  for (const reel of manifest.reels.items) {
    lines.push(await oneReel(reel.work_order_id, tokens.get(reel.work_order_id), promote))
  }
  if (lines.length === 0) {
    lines.push({
      kind: 'reel', stable_id: null, code: 'reel_none', ok: true,
      text: '这一周没有要转公开的视频。',
    })
  }
  return lines
}

async function oneReel(
  workOrderId: string,
  token: string | undefined,
  promote: (workOrderId: string, previewToken: string) => Promise<ReelPromoteResult>,
): Promise<WeekPackLine> {
  if (!token) return previewRequiredLine(workOrderId)
  try {
    const result = await promote(workOrderId, token)
    return { kind: 'reel', stable_id: workOrderId, code: result.code, ok: result.ok, text: result.text }
  } catch {
    return {
      kind: 'reel', stable_id: workOrderId, code: 'reel_failed', ok: false,
      text: '有一条视频没能转公开。其他条不撤回。',
    }
  }
}
