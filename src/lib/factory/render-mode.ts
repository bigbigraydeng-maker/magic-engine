// Render-mode helpers for the content factory chat.
//
// Why this exists: orders whose brief carries a `remotion` object are rendered by the
// remotion branch of the worker (scripts/factory-worker/remotion-branch.mjs). That branch's
// assertRemotionBrief() throws when it sees review_feedback / reopened_from, i.e. remotion
// orders CANNOT be redone from review feedback. So the chat tool must refuse to reject them
// (and must not reopen a new order) instead of silently producing a broken/duplicate render.

export type RenderMode = 'recipe' | 'template'

export const REMOTION_REJECT_UNSUPPORTED_MESSAGE =
  '这条是模板出片，对话框改不了画面，需要改模板参数或在后台重新出单。没有作废旧单，也没有重开新单。'

/** true when brief.remotion is a non-null, non-array object (the worker's remotion branch handles these orders). */
export function isRemotionBrief(brief: unknown): boolean {
  if (brief === null || typeof brief !== 'object' || Array.isArray(brief)) return false
  const remotion = (brief as { remotion?: unknown }).remotion
  return remotion !== null && typeof remotion === 'object' && !Array.isArray(remotion)
}

export function renderModeOf(brief: unknown): RenderMode {
  return isRemotionBrief(brief) ? 'template' : 'recipe'
}

export function renderModeLabel(brief: unknown): string {
  return renderModeOf(brief) === 'template' ? '模板出片(remotion)' : '配方出片'
}
