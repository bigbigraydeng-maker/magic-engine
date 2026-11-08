/**
 * Read-only ads investigation tools for project Luban.
 */

import type Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { truncateToolOutput } from '@/lib/agent-tools/readonly/types'
import { aggregateInsightRows, deltaMetrics } from './aggregate'
import { classifyDeliveryIssues } from './delivery'
import { parseIsoDate, presetWeekVsPrior } from './dates'
import {
  buildInvestigationContext,
  loadInsightSlices,
  loadLatestSnapshotsForDelivery,
  matchEntities,
  type InvestigationDataContext,
} from './load'
import { opaqueEntityRef, type EntityLevel } from './refs'

export interface AdsInvestigationToolContext {
  supabase: SupabaseClient
  clientId: string
}

const LEVEL_ENUM = ['campaign', 'adset', 'ad'] as const

const METRICS_TOOL: Anthropic.Tool = {
  name: 'ads_read_metrics',
  description:
    '只读：按系列/广告组/广告查看指定日期范围内的花费、展示、点击、CTR、CPM、留资/私信、主结果成本、频次等。'
    + '用名称关键词或上轮返回的 entity_ref 定位对象；不传则返回账户下匹配的前若干条汇总。',
  input_schema: {
    type: 'object' as const,
    properties: {
      level: { type: 'string', enum: [...LEVEL_ENUM], description: '层级；不填则三层都查。' },
      name_contains: { type: 'string', description: '名称包含（不区分大小写）。' },
      entity_ref: { type: 'string', description: '上一轮工具返回的不透明 ref。' },
      start_date: { type: 'string', description: '开始日 YYYY-MM-DD（含）。' },
      end_date: { type: 'string', description: '结束日 YYYY-MM-DD（含）。' },
    },
    required: ['start_date', 'end_date'],
  },
}

const COMPARE_TOOL: Anthropic.Tool = {
  name: 'ads_compare_periods',
  description:
    '只读：对比两个日期区间（如本周 vs 上周）同一对象的指标及差额/百分比。支持 preset=this_week_vs_last_week。',
  input_schema: {
    type: 'object' as const,
    properties: {
      preset: { type: 'string', enum: ['this_week_vs_last_week'] },
      period_a_start: { type: 'string' },
      period_a_end: { type: 'string' },
      period_b_start: { type: 'string' },
      period_b_end: { type: 'string' },
      level: { type: 'string', enum: [...LEVEL_ENUM] },
      name_contains: { type: 'string' },
      entity_ref: { type: 'string' },
    },
    required: [],
  },
}

const DELIVERY_TOOL: Anthropic.Tool = {
  name: 'ads_read_delivery_issues',
  description:
    '只读：列出被拒、有问题、学习受限、被上层暂停等投放状态（来自最新实体快照，不是实时 Graph）。',
  input_schema: {
    type: 'object' as const,
    properties: {
      level: { type: 'string', enum: [...LEVEL_ENUM] },
      name_contains: { type: 'string' },
    },
    required: [],
  },
}

const FUNNEL_TOOL: Anthropic.Tool = {
  name: 'ads_read_funnel_stages',
  description:
    '只读：单条广告在日期范围内的漏斗读数（展示、链接点击、3 秒播放、完播、留资/私信主结果）。仅 ad 层。',
  input_schema: {
    type: 'object' as const,
    properties: {
      name_contains: { type: 'string' },
      entity_ref: { type: 'string' },
      start_date: { type: 'string' },
      end_date: { type: 'string' },
    },
    required: ['start_date', 'end_date'],
  },
}

function parseLevel(raw: unknown): EntityLevel | undefined {
  return typeof raw === 'string' && (LEVEL_ENUM as readonly string[]).includes(raw)
    ? (raw as EntityLevel)
    : undefined
}

function jsonResult(body: unknown): string {
  return truncateToolOutput(JSON.stringify(body, null, 2))
}

async function getCtx(supabase: SupabaseClient, clientId: string): Promise<InvestigationDataContext> {
  return buildInvestigationContext(supabase, clientId)
}

function baseEvidence(ctx: InvestigationDataContext, dateRange: Record<string, string>, metrics: string[]) {
  return {
    metrics_included: metrics,
    date_range: dateRange,
    data_freshness: ctx.freshness,
    could_not_read: [...ctx.couldNotRead],
  }
}

async function metricsForEntity(
  supabase: SupabaseClient,
  clientId: string,
  ctx: InvestigationDataContext,
  ent: { ref: string; level: EntityLevel; name: string | null; account_ref: string },
  start: string,
  end: string,
) {
  const internal = ctx.entityByRef.get(ent.ref)
  const accountId = internal ? ctx.accountIdByRef.get(internal.accountRef) : undefined
  if (!accountId || !internal) {
    return { error: '无法解析 entity_ref', ref: ent.ref }
  }
  const { rows, couldNotRead } = await loadInsightSlices(
    supabase,
    clientId,
    accountId,
    internal.entityId,
    internal.level,
    start,
    end,
  )
  const agg = aggregateInsightRows(rows, ctx.outcomePrimary)
  return {
    entity_ref: ent.ref,
    level: ent.level,
    name: ent.name,
    account_ref: ent.account_ref,
    metrics: agg,
    could_not_read: couldNotRead,
  }
}

export function buildAdsInvestigationTools(ctx: AdsInvestigationToolContext): {
  tools: Anthropic.Tool[]
  handlers: Record<string, (input: unknown) => Promise<string>>
} {
  const handlers = {
    ads_read_metrics: async (input: unknown): Promise<string> => {
      const o = (input && typeof input === 'object') ? input as Record<string, unknown> : {}
      const start = parseIsoDate(o.start_date, 'start_date')
      const end = parseIsoDate(o.end_date, 'end_date')
      if (typeof start === 'object') return jsonResult({ error: start.error })
      if (typeof end === 'object') return jsonResult({ error: end.error })
      if (start > end) return jsonResult({ error: 'start_date 不能晚于 end_date' })

      const inv = await getCtx(ctx.supabase, ctx.clientId)
      const level = parseLevel(o.level)
      const entities = matchEntities(inv, {
        level,
        name_contains: typeof o.name_contains === 'string' ? o.name_contains : undefined,
        entity_ref: typeof o.entity_ref === 'string' ? o.entity_ref : undefined,
      })

      if (entities.length === 0) {
        return jsonResult({
          entities: [],
          evidence: baseEvidence(inv, { start, end }, METRIC_LIST),
          could_not_read: [...inv.couldNotRead, '没有匹配的广告对象（不是「没有问题」）'],
        })
      }

      const results = []
      const extraCould: string[] = []
      for (const ent of entities) {
        results.push(await metricsForEntity(ctx.supabase, ctx.clientId, inv, ent, start, end))
        const last = results[results.length - 1] as { could_not_read?: string[] }
        if (last.could_not_read?.length) extraCould.push(...last.could_not_read)
      }

      return jsonResult({
        entities: results,
        evidence: {
          ...baseEvidence(inv, { start, end }, METRIC_LIST),
          could_not_read: [...inv.couldNotRead, ...extraCould],
        },
      })
    },

    ads_compare_periods: async (input: unknown): Promise<string> => {
      const o = (input && typeof input === 'object') ? input as Record<string, unknown> : {}
      let aStart: string
      let aEnd: string
      let bStart: string
      let bEnd: string

      if (o.preset === 'this_week_vs_last_week') {
        const p = presetWeekVsPrior()
        aStart = p.period_a.start
        aEnd = p.period_a.end
        bStart = p.period_b.start
        bEnd = p.period_b.end
      } else {
        const pa = parseIsoDate(o.period_a_start, 'period_a_start')
        const pb = parseIsoDate(o.period_a_end, 'period_a_end')
        const pc = parseIsoDate(o.period_b_start, 'period_b_start')
        const pd = parseIsoDate(o.period_b_end, 'period_b_end')
        if ([pa, pb, pc, pd].some(x => typeof x === 'object')) {
          return jsonResult({ error: '自定义区间需要四个 period_* 日期或 preset' })
        }
        ;[aStart, aEnd, bStart, bEnd] = [pa, pb, pc, pd]
      }

      const inv = await getCtx(ctx.supabase, ctx.clientId)
      const level = parseLevel(o.level)
      const entities = matchEntities(inv, {
        level,
        name_contains: typeof o.name_contains === 'string' ? o.name_contains : undefined,
        entity_ref: typeof o.entity_ref === 'string' ? o.entity_ref : undefined,
      })

      if (entities.length === 0) {
        return jsonResult({
          comparisons: [],
          evidence: baseEvidence(inv, {
            period_a_start: aStart,
            period_a_end: aEnd,
            period_b_start: bStart,
            period_b_end: bEnd,
          }, METRIC_LIST),
          could_not_read: [...inv.couldNotRead, '没有匹配的广告对象（不是「没有问题」）'],
        })
      }

      const comparisons = []
      const extraCould: string[] = []
      for (const ent of entities) {
        const [ra, rb] = await Promise.all([
          metricsForEntity(ctx.supabase, ctx.clientId, inv, ent, aStart, aEnd),
          metricsForEntity(ctx.supabase, ctx.clientId, inv, ent, bStart, bEnd),
        ])
        if ('metrics' in ra && 'metrics' in rb) {
          comparisons.push({
            entity_ref: ent.ref,
            name: ent.name,
            level: ent.level,
            period_a: { start: aStart, end: aEnd, metrics: ra.metrics },
            period_b: { start: bStart, end: bEnd, metrics: rb.metrics },
            deltas: deltaMetrics(ra.metrics, rb.metrics),
          })
        }
        for (const r of [ra, rb]) {
          const c = (r as { could_not_read?: string[] }).could_not_read
          if (c?.length) extraCould.push(...c)
        }
      }

      return jsonResult({
        comparisons,
        evidence: {
          ...baseEvidence(inv, {
            period_a_start: aStart,
            period_a_end: aEnd,
            period_b_start: bStart,
            period_b_end: bEnd,
          }, METRIC_LIST),
          could_not_read: [...inv.couldNotRead, ...extraCould],
        },
      })
    },

    ads_read_delivery_issues: async (input: unknown): Promise<string> => {
      const o = (input && typeof input === 'object') ? input as Record<string, unknown> : {}
      const inv = await getCtx(ctx.supabase, ctx.clientId)
      const level = parseLevel(o.level)
      const name = typeof o.name_contains === 'string' ? o.name_contains : undefined

      const allIssues: Array<Record<string, unknown>> = []
      const extraCould: string[] = []

      for (const acct of inv.accounts) {
        const accountId = inv.accountIdByRef.get(acct.ref)
        if (!accountId) continue
        const { snaps, couldNotRead } = await loadLatestSnapshotsForDelivery(
          ctx.supabase,
          ctx.clientId,
          accountId,
          level,
          name,
        )
        extraCould.push(...couldNotRead)
        const issues = classifyDeliveryIssues(snaps)
        for (const issue of issues) {
          const ref = opaqueEntityRef(issue.level, issue.entity_id)
          allIssues.push({
            entity_ref: ref,
            account_ref: acct.ref,
            category: issue.category,
            level: issue.level,
            name: issue.name,
            detail: issue.detail,
            effective_status: issue.effective_status,
            learning_stage: issue.learning_stage,
          })
        }
      }

      if (extraCould.length && allIssues.length === 0) {
        extraCould.push('未能完整读取快照时，不能当作「没有投放问题」')
      }

      return jsonResult({
        issues: allIssues.slice(0, 40),
        evidence: baseEvidence(inv, { as_of: 'latest_snapshot' }, ['delivery_status']),
        could_not_read: [...inv.couldNotRead, ...extraCould],
      })
    },

    ads_read_funnel_stages: async (input: unknown): Promise<string> => {
      const o = (input && typeof input === 'object') ? input as Record<string, unknown> : {}
      const start = parseIsoDate(o.start_date, 'start_date')
      const end = parseIsoDate(o.end_date, 'end_date')
      if (typeof start === 'object') return jsonResult({ error: start.error })
      if (typeof end === 'object') return jsonResult({ error: end.error })

      const inv = await getCtx(ctx.supabase, ctx.clientId)
      const entities = matchEntities(inv, {
        level: 'ad',
        name_contains: typeof o.name_contains === 'string' ? o.name_contains : undefined,
        entity_ref: typeof o.entity_ref === 'string' ? o.entity_ref : undefined,
      })

      const funnels = []
      const extraCould: string[] = []
      for (const ent of entities.slice(0, 10)) {
        const block = await metricsForEntity(ctx.supabase, ctx.clientId, inv, ent, start, end)
        if ('metrics' in block) {
          funnels.push({
            entity_ref: ent.ref,
            name: ent.name,
            funnel: {
              impressions: block.metrics.impressions,
              link_clicks: block.metrics.link_clicks,
              video_3s_views: block.metrics.video_3s_views,
              video_thruplays: block.metrics.video_thruplays,
              leads: block.metrics.leads,
              messaging_conversations: block.metrics.messaging_conversations,
              primary_results: block.metrics.primary_results,
              cost_per_primary: block.metrics.cost_per_primary,
            },
          })
        }
        const c = (block as { could_not_read?: string[] }).could_not_read
        if (c?.length) extraCould.push(...c)
      }

      return jsonResult({
        ads: funnels,
        evidence: {
          ...baseEvidence(inv, { start, end }, FUNNEL_METRICS),
          could_not_read: [...inv.couldNotRead, ...extraCould],
        },
      })
    },
  }

  return {
    tools: [METRICS_TOOL, COMPARE_TOOL, DELIVERY_TOOL, FUNNEL_TOOL],
    handlers,
  }
}

const METRIC_LIST = [
  'spend', 'impressions', 'clicks', 'ctr', 'cpm', 'leads', 'messaging_conversations',
  'primary_results', 'cost_per_primary', 'frequency_7d_latest', 'frequency_daily_avg',
]

const FUNNEL_METRICS = [
  'impressions', 'link_clicks', 'video_3s_views', 'video_thruplays', 'leads', 'primary_results',
]
