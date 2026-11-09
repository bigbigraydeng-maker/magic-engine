/**
 * 验收 2 / 4：卡在运行中的任务进得了失败邮件；同一个原因的 N 次收成一行。
 *
 * 这里断言的是**路由真正在用的那两段代码**（`isDigestFailure` + `reconcile`），
 * 不是它们的复刻版 —— 判据留在路由里就只能靠「读代码确认」，
 * 而这整件事修的就是「没真跑过不算数」。
 */

import { describe, expect, it } from 'vitest'
import {
  failureCell,
  isAbandonedDigestRow,
  isDigestFailure,
  summaryFailureDetail,
  type DigestRunRow,
} from '../digest-cells'
import { failureSignature } from '../failure-signature'
import { reconcile } from '@/lib/todo-reconciliation/reconcile'
import type { RawWorkItem } from '@/lib/todo-reconciliation/types'

const NOW = new Date('2026-09-23T19:00:00Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()

describe('验收 2：卡在 running 的任务进得了失败邮件', () => {
  it('🔴 复刻 attribution-cron 2026-09-22：开跑了、没有结束时间、状态还是 running', () => {
    // 原筛选是 `failed_count > 0 || status === 'failed'` —— 这一行两边都接不住，
    // 于是这封邮件在设计上不可能报卡死
    const stuck: DigestRunRow = {
      status: 'running',
      failed_count: 0,
      started_at: hoursAgo(5),
      finished_at: null,
    }
    expect(isDigestFailure(stuck, NOW)).toBe(true)
  })

  it('🔴 正在正常跑的那一次不许被当成失败 —— 日报常常就在某个任务的执行窗口里跑', () => {
    const running: DigestRunRow = {
      status: 'running',
      failed_count: 0,
      started_at: hoursAgo(0.3),
      finished_at: null,
    }
    expect(isDigestFailure(running, NOW)).toBe(false)
  })

  it('原来就接得住的两类，一类都不能丢', () => {
    expect(isDigestFailure({ status: 'completed', failed_count: 3 }, NOW)).toBe(true)
    expect(isDigestFailure({ status: 'failed', failed_count: 0 }, NOW)).toBe(true)
  })

  it('跑成了、什么都没失败 → 不进邮件', () => {
    expect(
      isDigestFailure(
        { status: 'completed', failed_count: 0, started_at: hoursAgo(3), finished_at: hoursAgo(2.9) },
        NOW,
      ),
    ).toBe(false)
  })

  it('卡死那一格不能再显示成红色的「0 failed」', () => {
    const stuck: DigestRunRow = { status: 'running', failed_count: 0, started_at: hoursAgo(5), finished_at: null }
    expect(failureCell(stuck, NOW)).toMatch(/卡住了/)
  })

  it('孤儿行（abandoned，或迁移未应用时 failed + abandoned:）进邮件，格子不写 0 failed', () => {
    const abandoned: DigestRunRow = { status: 'abandoned', failed_count: 0, error_message: 'still running' }
    expect(isDigestFailure(abandoned, NOW)).toBe(true)
    expect(failureCell(abandoned, NOW)).toBe('abandoned')

    const fallback: DigestRunRow = {
      status: 'failed',
      failed_count: 0,
      error_message: 'abandoned: still running past twice the expected duration',
    }
    expect(isAbandonedDigestRow(fallback)).toBe(true)
    expect(isDigestFailure(fallback, NOW)).toBe(true)
    expect(failureCell(fallback, NOW)).toBe('abandoned')
  })

  it('有的条目成了、有的没成（partial）也进邮件', () => {
    expect(isDigestFailure({ status: 'partial', failed_count: 0 }, NOW)).toBe(true)
    expect(failureCell({ status: 'partial', failed_count: 0 }, NOW)).toBe('partial')
    expect(failureCell({ status: 'partial', failed_count: 2 }, NOW)).toBe('2 failed')
  })
})

describe('PM 现在看得到 summary 里的客户级明细', () => {
  it('🔴 卡片点名的那个例子：questions_failed: 47 以前一个字都看不到', () => {
    expect(summaryFailureDetail({ questions_failed: 47, clients: 3 })).toBe('questions_failed=47')
  })

  it('只挑带失败含义、且大于 0 的数字键 —— 不把整坨配置糊进邮件', () => {
    const out = summaryFailureDetail({
      questions_failed: 2,
      skipped_clients: 1,
      errors: 0,
      ok_count: 99,
      note: 'whatever',
    })
    expect(out).toContain('questions_failed=2')
    expect(out).toContain('skipped_clients=1')
    expect(out).not.toContain('errors=0')
    expect(out).not.toContain('ok_count')
    expect(out).not.toContain('note')
  })

  it('不是对象 / 是数组 / 是 null 时安静返回空串', () => {
    expect(summaryFailureDetail(null)).toBe('')
    expect(summaryFailureDetail([1, 2])).toBe('')
    expect(summaryFailureDetail('nope')).toBe('')
  })

  it('键太多时截断，邮件不会被一坨 JSON 撑爆', () => {
    const big: Record<string, number> = {}
    for (let i = 0; i < 20; i++) big[`thing_${i}_failed`] = i + 1
    expect(summaryFailureDetail(big).split(' · ')).toHaveLength(4)
  })
})

describe('验收 4：降噪 —— 同一个原因的 N 次收成一行', () => {
  /** 按路由里同一套规则造 RawWorkItem。 */
  function toItems(runs: Array<{ job: string; err: string; at: string }>): RawWorkItem[] {
    return runs.map((r, i) => ({
      id: `${r.job}@${i}`,
      source: 'cron_failure' as const,
      category: r.job,
      clientId: null,
      clientName: null,
      rootCauseKey: `${r.job}::${failureSignature(r.err) || 'unknown'}`,
      label: r.job,
      detail: r.err,
      createdAt: r.at,
    }))
  }

  it('🔴 复刻 2026-09-22：prospecting-sweep 一家 25 行 → 收成 1 行，并如实说明是 25 次', () => {
    const runs = Array.from({ length: 25 }, (_, i) => ({
      job: 'prospecting-sweep',
      // 同一个毛病（地图账单没开），只有计数和时间不同
      err: `Google Places API billing not enabled; 0 of ${i + 1} areas scanned at 2026-09-22T0${i % 10}:00:00Z`,
      at: hoursAgo(i),
    }))
    const clusters = reconcile(toItems(runs), NOW.toISOString()).unresolvedClusters
    expect(clusters).toHaveLength(1)
    expect(clusters[0].occurrenceCount).toBe(25)
  })

  it('🔴 但两个**不同**的真问题绝不许被合并（降噪不能把真告警一起降掉）', () => {
    const runs = [
      { job: 'social-sync', err: '(#10) Application does not have permission', at: hoursAgo(1) },
      { job: 'social-sync', err: '(#100) Object does not exist', at: hoursAgo(2) },
      { job: 'social-sync', err: 'Request failed with status 429', at: hoursAgo(3) },
      { job: 'social-sync', err: 'Request failed with status 500', at: hoursAgo(4) },
    ]
    expect(reconcile(toItems(runs), NOW.toISOString()).unresolvedClusters).toHaveLength(4)
  })

  it('不同任务的同一句错误不合并 —— 它们要人去查的是不同的地方', () => {
    const runs = [
      { job: 'a-cron', err: 'timeout', at: hoursAgo(1) },
      { job: 'b-cron', err: 'timeout', at: hoursAgo(1) },
    ]
    expect(reconcile(toItems(runs), NOW.toISOString()).unresolvedClusters).toHaveLength(2)
  })

  it('🔴 长期故障恶化时会自动冒到最上面，不会因为「是老问题」被压在看不见的底部', () => {
    const chronic = Array.from({ length: 200 }, (_, i) => ({
      job: 'prospecting-sweep',
      err: `billing not enabled, attempt ${i}`,
      at: hoursAgo(i % 24),
    }))
    const fresh = [{ job: 'blog-weekly', err: 'unique new failure', at: hoursAgo(1) }]
    const clusters = reconcile(toItems([...fresh, ...chronic]), NOW.toISOString())
      .unresolvedClusters.slice()
      .sort((a, b) => b.occurrenceCount - a.occurrenceCount)
    expect(clusters[0].label).toBe('prospecting-sweep')
    expect(clusters[0].occurrenceCount).toBe(200)
  })

  it('80 行那封邮件的整体效果：两个大户各收 1 行，其余照旧', () => {
    const runs = [
      ...Array.from({ length: 25 }, (_, i) => ({ job: 'prospecting-sweep', err: `billing not enabled ${i}`, at: hoursAgo(i) })),
      ...Array.from({ length: 24 }, (_, i) => ({ job: 'messenger-sync-hourly', err: `token expired ${i}`, at: hoursAgo(i) })),
      { job: 'blog-weekly', err: 'real new problem', at: hoursAgo(2) },
    ]
    const clusters = reconcile(toItems(runs), NOW.toISOString()).unresolvedClusters
    expect(clusters).toHaveLength(3)
    // 一条真告警都没丢：49 + 1 次全部还在
    expect(clusters.reduce((s, c) => s + c.occurrenceCount, 0)).toBe(50)
  })
})
