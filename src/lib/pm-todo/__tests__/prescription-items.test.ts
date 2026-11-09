/**
 * 本周方案复查通知。
 *
 * 旧通知按看板上的待办条数说话。批准不再往看板上插待办之后，条数是 0，
 * 那句「一个可执行动作都没排出来」会变成误报。现在只读周二任务写好的人话。
 */

import { describe, expect, it } from 'vitest'
import { PRESCRIPTION_WEEKLY_CHECK_KIND } from '@/lib/diagnostic/prescription-weekly-check'
import { prescriptionCheckItemsFromLogs, pushPrescriptionItems } from '../manual-strategy-items'

const NOW = new Date('2026-10-25T00:00:00Z')

describe('prescriptionCheckItemsFromLogs', () => {
  it('把复查人话原样放进通知，不把整段记录摊成一串符号', () => {
    const items = prescriptionCheckItemsFromLogs([
      {
        summary: {
          kind: PRESCRIPTION_WEEKLY_CHECK_KIND,
          outcomes: [
            {
              clientId: 'c1',
              clientName: '北岛旅行',
              result: 'checked',
              goalId: 'g1',
              progress: '目标《春季咨询》已经批准。看板上没有挂着这份方案的待办。批准方案时不会再往看板上插待办，所以这不是故障。',
              suggestion: '建议你看这些阶段要不要继续。系统不会自己改，也不会自动批准一份新的。',
            },
            {
              clientId: 'c1',
              clientName: '北岛旅行',
              result: 'checked',
              progress: '同一客户第二条不该再出一条',
              suggestion: '不该出现',
            },
            { clientId: 'c2', result: 'skipped', detail: '不是付费客户' },
          ],
        },
      },
    ], () => '未知客户')

    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('prescription_updated')
    expect(items[0].client_name).toBe('北岛旅行')
    expect(items[0].what).toContain('所以这不是故障')
    expect(items[0].what).not.toContain('一个可执行动作都没排出来')
    expect(items[0].what).not.toContain('{')
    expect(items[0].how).toContain('不会自己改')
    expect(items[0].href).toBe('https://app.magicengine.com.au/dashboard/clients/c1/goal/g1')
  })

  it('数据读不到仍写进通知，读失败和跳过的不写', () => {
    const items = prescriptionCheckItemsFromLogs([
      {
        summary: {
          kind: PRESCRIPTION_WEEKLY_CHECK_KIND,
          outcomes: [
            {
              clientId: 'c1',
              clientName: '北岛旅行',
              result: 'unreadable',
              goalId: 'g1',
              progress: '数据读不到。阶段这次没读出来，不把没读到当成没有。',
              suggestion: '数据读不到，这周先不判断效果。系统不会自己改方案，也不会新开一份。',
            },
            { clientId: 'c2', result: 'error', detail: 'boom', progress: '不该出现', suggestion: '不该出现' },
          ],
        },
      },
    ], () => '未知客户')
    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('数据读不到')
    expect(items[0].what).not.toContain('0 条阶段')
    expect(items[0].href).toContain('/goal/g1')
  })

  it('旧的自动开方记录没有复查标记，不再报警', () => {
    const items = prescriptionCheckItemsFromLogs([
      {
        summary: {
          outcomes: [
            { clientId: 'c1', clientName: '北岛旅行', result: 'prescribed', executionItems: 0 },
          ],
        },
      },
    ], () => '未知客户')
    expect(items).toEqual([])
  })

  it('更新的一轮不是复查时，往下找上一轮复查', () => {
    const items = prescriptionCheckItemsFromLogs([
      { summary: { note: '别的形状' } },
      {
        summary: {
          kind: PRESCRIPTION_WEEKLY_CHECK_KIND,
          outcomes: [{
            clientId: 'c1',
            result: 'checked',
            progress: '进度一句。',
            suggestion: '建议一句。系统不会自己改。',
          }],
        },
      },
    ], () => '北岛旅行')
    expect(items[0].what).toBe('进度一句。')
    expect(items[0].client_name).toBe('北岛旅行')
    expect(items[0].href).toBe('https://app.magicengine.com.au/dashboard/clients/c1')
  })
})

describe('pushPrescriptionItems', () => {
  it('读运行记录，不读看板上的待办条数', async () => {
    const tables: string[] = []
    const supabase = {
      from(table: string) {
        tables.push(table)
        const api: Record<string, unknown> = {}
        const self = () => api
        api.select = self
        api.eq = self
        api.gte = self
        api.order = self
        api.limit = self
        api.then = (resolve: (value: { data: unknown[]; error: null }) => unknown) => resolve({
          data: [{
            summary: {
              kind: PRESCRIPTION_WEEKLY_CHECK_KIND,
              outcomes: [{
                clientId: 'c1',
                clientName: '北岛旅行',
                result: 'checked',
                goalId: 'g1',
                progress: '本周进度。看板上没有挂着这份方案的待办。',
                suggestion: '建议只是建议。系统不会自己改。',
              }],
            },
          }],
          error: null,
        })
        return api
      },
    }
    const items: Array<{ what: string }> = []
    await pushPrescriptionItems(supabase as never, items as never, NOW, () => '未知客户')
    expect(tables).toEqual(['cron_run_logs'])
    expect(items[0].what).not.toContain('一个可执行动作都没排出来')
  })
})
