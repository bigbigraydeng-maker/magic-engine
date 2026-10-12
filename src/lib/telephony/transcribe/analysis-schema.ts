/**
 * 通话分析的数据形状。
 *
 * 原则：每一条「事实」必须带原话（quote）。原话在转写文本里找不到的事实一律丢弃——
 * 模型编的东西不能进客户记录。摘要只是「待复核的概述」，不当事实用。
 */

import { z } from 'zod'

/** CTS（旅游）关心的信息种类；行业差异走这个枚举的版本，不进共享流水线。 */
export const FACT_KEYS = [
  'destination_or_tour', // 团型 / 目的地
  'travel_window', // 出发时间（客人原话的意思）
  'party_size', // 人数
  'budget', // 预算（含币种）
  'concern', // 顾虑
  'competitor', // 提到的竞品
  'decision_maker', // 谁拍板
  'next_step', // 约定的下一步
  'callback_time', // 约定回电时间
  'do_not_contact', // 客人要求别再联系
] as const
export type FactKey = (typeof FACT_KEYS)[number]

export const ANALYSIS_SCHEMA_VERSION = 1

export const RawFactSchema = z.object({
  key: z.enum(FACT_KEYS),
  value: z.string().min(1).max(300),
  quote: z.string().min(1).max(500),
  confidence: z.number().min(0).max(1),
})
export type RawFact = z.infer<typeof RawFactSchema>

export const RawAnalysisSchema = z.object({
  summary: z.string().max(1200),
  language: z.string().max(40).nullable().default(null),
  facts: z.array(RawFactSchema).max(40).default([]),
})
export type RawAnalysis = z.infer<typeof RawAnalysisSchema>

export interface VerifiedAnalysis {
  summary: string
  language: string | null
  facts: RawFact[]
  /** 因为原话在转写里找不到而被丢掉的条数（可见，不静默）。 */
  droppedFacts: number
}

const norm = (s: string) => s.toLowerCase().replace(/[\s　"'“”‘’.,，。!！?？、:;；]+/g, '')

/** 事实的原话必须真的出现在转写里（忽略空白和标点、大小写）。 */
export function verifyFacts(raw: RawAnalysis, transcript: string): VerifiedAnalysis {
  const t = norm(transcript)
  const kept = raw.facts.filter((f) => {
    const q = norm(f.quote)
    return q.length >= 2 && t.includes(q)
  })
  return { summary: raw.summary, language: raw.language, facts: kept, droppedFacts: raw.facts.length - kept.length }
}

export const ANALYSIS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'language', 'facts'],
  properties: {
    summary: { type: 'string' },
    language: { type: ['string', 'null'] },
    facts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'value', 'quote', 'confidence'],
        properties: {
          key: { type: 'string', enum: [...FACT_KEYS] },
          value: { type: 'string' },
          quote: { type: 'string' },
          confidence: { type: 'number' },
        },
      },
    },
  },
} as const
