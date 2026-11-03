// Variant orders: one already-rendered base video, exactly one change (hook lines or music).
// Pure parsing/brief-building only; the order stops at in_review and is never published here.

import { isRemotionBrief } from './render-mode'
import { checkRemotionProps, replaceRemotionMusic } from './remotion-music-options.mjs'

export const VARIANT_BASE_STATUSES = ['in_review', 'published', 'superseded', 'review_rejected'] as const
export const MAX_HOOK_LINE_CHARS = 9
export const MAX_VARIANT_ORDERS_PER_DAY = 10
export const VARIANT_ORDER_SOURCE = 'me_variant_order'

const STRIPPED_KEYS = [
  'reopened_from',
  'review_feedback',
  'review_feedback_by',
  'review_feedback_digest',
  'review_checklist_failed_items',
  'recipe_replan_required',
  'recipe_replan_reason',
  'previous_creative_recipe',
  'variant_of',
] as const

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MUSIC_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export interface HookLine {
  text: string
  badge: string | null
}

export type VariantChange = { kind: 'hook'; lines: HookLine[] } | { kind: 'music'; musicId: string }

export type ParsedVariantRequest =
  | { ok: true; baseId: string; change: VariantChange; note: string }
  | { ok: false; error: string }

export type BuiltVariant =
  | { ok: true; brief: Record<string, unknown>; summary: string }
  | { ok: false; error: string }

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function parseHookLines(raw: unknown): { ok: true; lines: HookLine[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length !== 3) return { ok: false, error: '开场文字必须是 3 行' }
  const lines: HookLine[] = []
  for (let i = 0; i < raw.length; i++) {
    const item: unknown = raw[i]
    if (!isPlainObject(item)) return { ok: false, error: `第 ${i + 1} 行开场文字格式不对` }
    const text = String(item.text ?? '').trim()
    if (text.length === 0) return { ok: false, error: `第 ${i + 1} 行开场文字是空的` }
    if (text.length > 40) return { ok: false, error: `第 ${i + 1} 行开场文字太长` }
    const rawBadge: unknown = item.badge
    let badge: string | null
    if (rawBadge === null || rawBadge === undefined) {
      badge = null
    } else if (typeof rawBadge === 'string') {
      const trimmed = rawBadge.trim()
      if (trimmed.length === 0) {
        badge = null
      } else if (trimmed.length > 6) {
        return { ok: false, error: `第 ${i + 1} 行的小标签太长` }
      } else {
        badge = trimmed
      }
    } else {
      return { ok: false, error: `第 ${i + 1} 行的小标签格式不对` }
    }
    lines.push({ text, badge })
  }
  return { ok: true, lines }
}

function parseChange(raw: unknown): { ok: true; change: VariantChange } | { ok: false; error: string } {
  if (!isPlainObject(raw)) return { ok: false, error: '只能改开场文字或换配乐' }
  if (raw.kind === 'hook') {
    const parsed = parseHookLines(raw.lines)
    if (!parsed.ok) return parsed
    return { ok: true, change: { kind: 'hook', lines: parsed.lines } }
  }
  if (raw.kind === 'music') {
    const musicId: unknown = raw.music_id
    if (typeof musicId !== 'string' || musicId.length > 40 || !MUSIC_ID_RE.test(musicId)) {
      return { ok: false, error: '请选一首曲库里的配乐' }
    }
    return { ok: true, change: { kind: 'music', musicId } }
  }
  return { ok: false, error: '只能改开场文字或换配乐' }
}

export function parseVariantRequest(body: unknown): ParsedVariantRequest {
  if (!isPlainObject(body)) return { ok: false, error: '请求格式不对' }
  const baseId: unknown = body.base_work_order_id
  if (typeof baseId !== 'string' || !UUID_RE.test(baseId)) {
    return { ok: false, error: '缺少底稿视频编号' }
  }
  const parsed = parseChange(body.change)
  if (!parsed.ok) return parsed
  const rawNote: unknown = body.note
  const note = typeof rawNote === 'string' ? rawNote.trim().slice(0, 300) : ''
  return { ok: true, baseId, change: parsed.change, note }
}

function buildHookChange(
  remotion: Record<string, unknown>,
  props: Record<string, unknown>,
  lines: HookLine[],
): { ok: true; nextRemotion: Record<string, unknown>; summary: string } | { ok: false; error: string } {
  if (remotion.template !== 'list') {
    return { ok: false, error: '只有清单款视频能改开场文字，这条可以换配乐' }
  }
  const hook = props.hook
  if (!isPlainObject(hook) || !Array.isArray(hook.lines)) {
    return { ok: false, error: '这条视频没有开场文字' }
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const width = line.text.length + (line.badge ? line.badge.length + 1 : 0)
    if (width > MAX_HOOK_LINE_CHARS) {
      return {
        ok: false,
        error: `第 ${i + 1} 行太长：最多 ${MAX_HOOK_LINE_CHARS} 个字符（含小标签），现在是 ${width} 个`,
      }
    }
  }
  const nextRemotion: Record<string, unknown> = {
    ...remotion,
    props: {
      ...props,
      hook: { ...hook, lines: lines.map((l) => ({ text: l.text, badge: l.badge })) },
    },
  }
  const check = checkRemotionProps(nextRemotion)
  if (!check.ok) return { ok: false, error: `开场文字不合格：${check.error}` }
  const summary =
    '开场文字改成「' + lines.map((l) => (l.badge ? `${l.badge} ${l.text}` : l.text)).join(' / ') + '」'
  return { ok: true, nextRemotion, summary }
}

export function buildVariantBrief(baseBrief: unknown, baseId: string, change: VariantChange): BuiltVariant {
  if (!isRemotionBrief(baseBrief)) {
    return { ok: false, error: '这条视频不是模板出片，暂时不能照它下单' }
  }
  if (!isPlainObject(baseBrief)) {
    return { ok: false, error: '这条视频不是模板出片，暂时不能照它下单' }
  }
  if (Object.prototype.hasOwnProperty.call(baseBrief, 'creative_recipe')) {
    return { ok: false, error: '这条视频不是模板出片，暂时不能照它下单' }
  }
  const copy: Record<string, unknown> = { ...baseBrief }
  for (const key of STRIPPED_KEYS) delete copy[key]
  const remotion = copy.remotion
  if (!isPlainObject(remotion)) return { ok: false, error: '读不到这条视频的参数' }
  const props = remotion.props
  if (!isPlainObject(props)) return { ok: false, error: '读不到这条视频的参数' }

  let nextRemotion: Record<string, unknown>
  let summary: string
  if (change.kind === 'hook') {
    const built = buildHookChange(remotion, props, change.lines)
    if (!built.ok) return built
    nextRemotion = built.nextRemotion
    summary = built.summary
  } else {
    const replaced = replaceRemotionMusic(remotion, change.musicId)
    if (!replaced) {
      return { ok: false, error: '这首配乐不适用于这条视频，或无人声核验时长不够' }
    }
    nextRemotion = replaced.remotion
    summary = `配乐换成 ${replaced.choice.id}`
  }

  return {
    ok: true,
    brief: { ...copy, remotion: nextRemotion, variant_of: { base_work_order_id: baseId, change: summary } },
    summary,
  }
}
