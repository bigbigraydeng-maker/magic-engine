// Turns a template-render brief into the same nine-frame input the other route uses.
// Only on-screen copy is collected. File names, colours, and urls are not captions.

import type { NineGridInput } from '@/lib/maliang/render-check'

const TEXT_KEYS = new Set([
  'line', 'lines', 'place', 'text', 'caption', 'title', 'cta', 'label',
  'fromLabel', 'qualifier', 'footnote', 'dateLine', 'headline', 'subline',
])

const MAX_LINES = 16
const MAX_LINE = 180

interface RemotionBrief {
  template?: unknown
  props?: unknown
}

function remotionOf(brief: unknown): RemotionBrief | null {
  if (!brief || typeof brief !== 'object' || Array.isArray(brief)) return null
  const remotion = (brief as { remotion?: unknown }).remotion
  if (!remotion || typeof remotion !== 'object' || Array.isArray(remotion)) return null
  return remotion as RemotionBrief
}

function looksLikeAsset(value: string): boolean {
  if (value.includes('/') || value.startsWith('http://') || value.startsWith('https://')) return true
  return /\.(mp4|mp3|png|jpe?g|webp|mov|wav|svg)$/i.test(value)
}

function pushText(value: unknown, out: string[]): void {
  const add = (raw: string) => {
    const text = raw.trim().slice(0, MAX_LINE)
    if (!text || looksLikeAsset(text) || out.includes(text) || out.length >= MAX_LINES) return
    out.push(text)
  }
  if (typeof value === 'string') {
    add(value)
    return
  }
  if (!Array.isArray(value)) return
  for (const item of value) {
    if (typeof item === 'string') add(item)
  }
}

function collectText(node: unknown, out: string[], depth: number): void {
  if (depth > 8 || out.length >= MAX_LINES) return
  if (Array.isArray(node)) {
    for (const item of node) collectText(item, out, depth + 1)
    return
  }
  if (!node || typeof node !== 'object') return
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (TEXT_KEYS.has(key)) pushText(value, out)
    else collectText(value, out, depth + 1)
  }
}

export function logoExpectedFromRemotionBrief(brief: unknown): boolean {
  const props = remotionOf(brief)?.props
  if (!props || typeof props !== 'object' || Array.isArray(props)) return false
  const logo = (props as { logoFile?: unknown }).logoFile
  return typeof logo === 'string' && logo.trim().length > 0
}

export function remotionVisualNotes(brief: unknown): string[] {
  const remotion = remotionOf(brief)
  const template = typeof remotion?.template === 'string' && remotion.template.trim()
    ? remotion.template.trim().slice(0, 40)
    : 'unknown'
  const notes = [`template ${template}`]
  const props = remotion?.props
  const scenes = props && typeof props === 'object' && !Array.isArray(props)
    ? (props as { scenes?: unknown }).scenes
    : undefined
  const count = Array.isArray(scenes) ? Math.min(scenes.length, 8) : 0
  for (let i = 0; i < count; i++) notes.push(`scene ${i + 1} is a composed template frame`)
  return notes
}

/** Hook lines, each scene place and line, and the end title. Not truncated. */
export function sceneCopyLines(brief: unknown): string[] {
  const props = remotionOf(brief)?.props
  if (!props || typeof props !== 'object' || Array.isArray(props)) return []
  const record = props as Record<string, unknown>
  const lines: string[] = []
  const push = (value: unknown) => {
    const items = typeof value === 'string' ? [value] : Array.isArray(value) ? value : []
    for (const item of items) {
      if (typeof item !== 'string') continue
      const text = item.trim()
      if (!text || lines.includes(text)) continue
      lines.push(text)
    }
  }
  const hook = record.hook
  if (hook && typeof hook === 'object' && !Array.isArray(hook)) push((hook as { lines?: unknown }).lines)
  if (Array.isArray(record.scenes)) {
    for (const scene of record.scenes) {
      if (!scene || typeof scene !== 'object' || Array.isArray(scene)) continue
      const row = scene as { place?: unknown; line?: unknown }
      push(row.place)
      push(row.line)
    }
  }
  const end = record.end
  if (end && typeof end === 'object' && !Array.isArray(end)) push((end as { title?: unknown }).title)
  return lines
}

export function onScreenLines(brief: unknown, caption: unknown): string[] {
  const lines: string[] = []
  if (typeof caption === 'string') pushText(caption, lines)
  const props = remotionOf(brief)?.props
  if (props) collectText(props, lines, 0)
  return lines
}

export function remotionNineGridInput(args: {
  title: string
  brandName: string
  brief: unknown
  caption: unknown
}): NineGridInput {
  return {
    title: args.title,
    brandName: args.brandName,
    expectedCaptions: onScreenLines(args.brief, args.caption),
    compareLines: sceneCopyLines(args.brief),
    visualNotes: remotionVisualNotes(args.brief),
    logoExpected: logoExpectedFromRemotionBrief(args.brief),
  }
}
