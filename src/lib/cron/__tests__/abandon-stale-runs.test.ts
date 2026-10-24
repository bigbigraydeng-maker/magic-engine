/**
 * 进程重启后停在 running 的行，要按「预计时长的两倍」收成 abandoned。
 * 预计时长必须跟路由文件里的 maxDuration 对得上，改了一边另一边没改就红。
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  abandonStaleRunningRuns,
  selectAbandonedRuns,
  type OpenRunRow,
} from '../abandon-stale-runs'
import { abandonAfterMs, JOB_MAX_DURATION_SEC, UNKNOWN_ABANDON_AFTER_MS } from '../expected-duration'

const NOW = new Date('2026-10-24T06:00:00.000Z')

function row(jobName: string, ageMs: number): OpenRunRow {
  return {
    id: `${jobName}-${ageMs}`,
    job_name: jobName,
    started_at: new Date(NOW.getTime() - ageMs).toISOString(),
  }
}

/** 重新扫路由：同一文件里既有 maxDuration 又有 startCronRun('字面量') 才收录。 */
function scannedDurations(): Record<string, number> {
  const root = join(process.cwd(), 'src/app/api/cron')
  const out: Record<string, number> = {}
  for (const dir of readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue
    let text: string
    try {
      text = readFileSync(join(root, dir.name, 'route.ts'), 'utf8')
    } catch {
      continue
    }
    const duration = text.match(/export const maxDuration\s*=\s*(\d+)/)
    if (!duration) continue
    const names = [...text.matchAll(/startCronRun\(\s*'([^']+)'\s*\)/g)].map((match) => match[1])
    for (const name of new Set(names)) out[name] = Number(duration[1])
  }
  return out
}

describe('abandonAfterMs', () => {
  it('已知任务用 maxDuration 的两倍，未知任务用 2 小时', () => {
    expect(abandonAfterMs('messenger-sync-hourly')).toBe(600 * 1000 * 2)
    expect(abandonAfterMs('goals-expiry-check')).toBe(60 * 1000 * 2)
    expect(abandonAfterMs('not-a-registered-job')).toBe(UNKNOWN_ABANDON_AFTER_MS)
    expect(UNKNOWN_ABANDON_AFTER_MS).toBe(2 * 60 * 60 * 1000)
  })

  it('表和路由文件对得上 —— 改了 maxDuration 这里没改就会红', () => {
    expect(scannedDurations()).toEqual(JOB_MAX_DURATION_SEC)
  })
})

describe('selectAbandonedRuns', () => {
  it('刚过两倍才收，还在预算内的不动', () => {
    const limit = abandonAfterMs('messenger-sync-hourly')
    const picked = selectAbandonedRuns(
      [
        row('messenger-sync-hourly', limit + 1000),
        row('messenger-sync-hourly', limit),
        row('mystery-job', UNKNOWN_ABANDON_AFTER_MS + 1000),
        row('mystery-job', UNKNOWN_ABANDON_AFTER_MS - 1000),
        { id: 'bad', job_name: 'mystery-job', started_at: 'not-a-date' },
      ],
      NOW,
    )
    expect(picked.map((item) => item.id)).toEqual([
      `messenger-sync-hourly-${limit + 1000}`,
      `mystery-job-${UNKNOWN_ABANDON_AFTER_MS + 1000}`,
    ])
  })
})

interface StoredRun extends OpenRunRow {
  status: string
  error_message: string | null
  finished_at: string | null
}

function fakeLog(rows: StoredRun[], opts: { rejectAbandoned?: boolean } = {}) {
  return {
    from(table: string) {
      if (table !== 'cron_run_logs') throw new Error(`unexpected table ${table}`)
      let mode: 'select' | 'update' = 'select'
      let payload: Record<string, unknown> = {}
      const eqs: Array<[string, unknown]> = []
      let olderThan: string | null = null
      const hits = () =>
        rows.filter(
          (item) =>
            eqs.every(([col, value]) => item[col as keyof StoredRun] === value) &&
            (olderThan == null || item.started_at < olderThan),
        )
      const builder: Record<string, unknown> = {
        select: () => builder,
        update: (patch: Record<string, unknown>) => {
          mode = 'update'
          payload = patch
          return builder
        },
        eq: (col: string, value: unknown) => {
          eqs.push([col, value])
          return builder
        },
        lt: (col: string, value: string) => {
          if (col === 'started_at') olderThan = value
          return builder
        },
        limit: () => builder,
        then: (resolve: (value: unknown) => unknown) => {
          if (mode === 'update' && opts.rejectAbandoned && payload.status === 'abandoned') {
            return Promise.resolve(
              resolve({
                data: null,
                error: { code: '23514', message: 'violates check constraint "cron_run_logs_status_check"' },
              }),
            )
          }
          if (mode === 'update') {
            for (const item of hits()) Object.assign(item, payload)
            return Promise.resolve(resolve({ data: hits(), error: null }))
          }
          return Promise.resolve(resolve({
            data: hits().map((item) => ({ id: item.id, job_name: item.job_name, started_at: item.started_at })),
            error: null,
          }))
        },
      }
      return builder
    },
  }
}

describe('abandonStaleRunningRuns', () => {
  it('过期的 running 收成 abandoned，年轻的留着', async () => {
    const rows: StoredRun[] = [
      { ...row('messenger-sync-hourly', abandonAfterMs('messenger-sync-hourly') + 5000), status: 'running', error_message: null, finished_at: null },
      { ...row('messenger-sync-hourly', 60_000), status: 'running', error_message: null, finished_at: null },
    ]
    const result = await abandonStaleRunningRuns(fakeLog(rows) as never, NOW)
    expect(result).toEqual({ abandoned: 1 })
    expect(rows[0].status).toBe('abandoned')
    expect(rows[0].error_message?.startsWith('abandoned:')).toBe(true)
    expect(rows[0].finished_at).toBe(NOW.toISOString())
    expect(rows[1].status).toBe('running')
  })

  it('状态约束还没放行 abandoned 时改写成 failed，错误仍以 abandoned: 开头', async () => {
    const rows: StoredRun[] = [
      { ...row('mystery-job', UNKNOWN_ABANDON_AFTER_MS + 1000), status: 'running', error_message: null, finished_at: null },
    ]
    const result = await abandonStaleRunningRuns(fakeLog(rows, { rejectAbandoned: true }) as never, NOW)
    expect(result).toEqual({ abandoned: 1 })
    expect(rows[0].status).toBe('failed')
    expect(rows[0].error_message?.startsWith('abandoned:')).toBe(true)
  })
})
