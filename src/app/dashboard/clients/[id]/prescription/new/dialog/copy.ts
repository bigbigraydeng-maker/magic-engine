import type { DiagnosticDimension } from '@/types/diagnostic'
import { coerceWeaknesses, extractDimensionPrefix } from '@/lib/huatuo/weakness-utils'

const INTERNAL_NAME = /诸葛亮|广告\s*Agent|huatuo/gi

export const DIMENSION_LABEL: Record<DiagnosticDimension, string> = {
  seo: '搜索',
  ai_visibility: 'AI 可见度',
  social: '社媒',
  reputation: '口碑',
  competitor: '竞品',
  ads: '广告',
}

export function publicWords(text: string): string {
  return text.replace(INTERNAL_NAME, '华佗')
}

export function publicProgressNote(note: string | null | undefined): string | null {
  if (!note?.trim()) return null
  const cleaned = publicWords(note).trim()
  if (cleaned.includes('{') || cleaned.length > 120) return '正在写处方'
  return cleaned
}

export function humanJobError(raw: string): string {
  const text = publicWords(raw).trim()
  if (!text) return '这次没写成。请换一句再说。'
  if (/discovery|品牌扫描|发现报告/i.test(text)) return '品牌扫描还没确认，确认之后才能开方。'
  if (/weakness|薄弱/.test(text)) return '这版没有标出要改的点。说「再开一版」，并写上每月预算。'
  if (/已批准|already approved/i.test(text)) return '这版已经同意，不能再改。要调整就说「再开一版」。'
  if (/business_goal|monthly_budget|intake/i.test(text)) return '还需要说清楚要什么结果，以及每月预算。'
  if (/正在生成|generating/i.test(text)) return '还在写，写完再改。'
  if (/流意外|意外关闭/.test(text)) return '写到一半断了。请刷新，写好的处方会在上面。'
  if (text.includes('{') || text.includes('}') || text.length > 180) return '这次没写成。请换一句再说。'
  return text
}

export function progressLabel(status: string | null, writing: boolean): string {
  if (writing || status === 'generating') return '华佗正在写处方'
  if (status === 'approved') return '这版已经同意'
  if (status === 'draft') return '可以看这版处方'
  if (status === 'failed') return '这版没写成'
  return '还没有处方'
}

export function weaknessSentences(raw: unknown): string[] {
  return coerceWeaknesses(raw)
    .map((item) => extractDimensionPrefix(item.text).cleanedText.trim())
    .filter((text) => text.length > 0)
}
