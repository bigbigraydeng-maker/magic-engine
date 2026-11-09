/**
 * 清单指纹：覆盖**所有**结构化字段（含判据文字），任何字改了指纹就变，
 * 旧的 item_result / review / 签字随之作废（设计稿 §5）。
 */

import { createHash } from 'node:crypto'
import type { Checklist } from './types'

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return `{${Object.keys(obj)
      .sort()
      .filter((k) => obj[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function checklistHash(checklist: Checklist): string {
  const payload = {
    featureKey: checklist.featureKey,
    title: checklist.title,
    riskLevel: checklist.riskLevel,
    scopeNote: checklist.scopeNote,
    evidencePolicy: checklist.evidencePolicy,
    items: checklist.items,
  }
  return createHash('sha256').update(canonical(payload)).digest('hex')
}
