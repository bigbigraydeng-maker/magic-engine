import { describe, expect, it } from 'vitest'
import { runDirectLeadSheetSync } from '../direct-run'
import type { LeadSheetClientReceipt, LeadSheetRouteReceipt } from '../types'

function route(appended: number, error: string | null): LeadSheetRouteReceipt {
  return {
    routeKey: 'main', label: null, spreadsheetId: 'sheet', tabName: 'Leads', matched: appended, alreadyPresent: 0,
    skippedNoIdentity: 0, skippedLeadIds: [], appended, appendedLeadIds: [], outsideWindow: 0,
    unmappedValues: [], blankedFields: [], error,
  }
}

function receipt(id: string, appended: number, error: string | null = null): LeadSheetClientReceipt {
  return { clientId: id, clientName: null, routes: [route(appended, error)], unrouted: 0, error: null, warning: null }
}

describe('线索进表格：Inngest 停了，直接同步', () => {
  it('逐个客户同步，一客户一行运行记录，合计新增行数', async () => {
    const order: string[] = []
    const logged: string[] = []
    const r = await runDirectLeadSheetSync({
      loadClientIds: async () => ['a', 'b'],
      loadClientName: async (id) => `name-${id}`,
      sync: async (c) => { order.push(`${c.id}:${c.name}`); return receipt(c.id, c.id === 'a' ? 2 : 1) },
      logClient: async (rc) => { logged.push(rc.clientId) },
    })
    expect(order).toEqual(['a:name-a', 'b:name-b'])
    expect(logged).toEqual(['a', 'b'])
    expect(r).toEqual({ status: 'done', clients: 2, appended: 3, failedClients: 0, error: null })
  })

  it('一个客户抛错：记成失败、照样留运行记录，后面的客户照跑', async () => {
    const logged: LeadSheetClientReceipt[] = []
    const r = await runDirectLeadSheetSync({
      loadClientIds: async () => ['a', 'b'],
      loadClientName: async () => null,
      sync: async (c) => { if (c.id === 'a') throw new Error('sheet 403'); return receipt(c.id, 1) },
      logClient: async (rc) => { logged.push(rc) },
    })
    expect(logged.map((x) => [x.clientId, x.error])).toEqual([['a', 'sheet 403'], ['b', null]])
    expect(r.failedClients).toBe(1)
    expect(r.appended).toBe(1)
    expect(r.error).toBe('sheet 403')
  })

  it('路线写失败也算失败客户', async () => {
    const r = await runDirectLeadSheetSync({
      loadClientIds: async () => ['a'],
      loadClientName: async () => null,
      sync: async (c) => receipt(c.id, 0, 'quota'),
      logClient: async () => undefined,
    })
    expect(r).toMatchObject({ failedClients: 1, error: 'quota' })
  })

  it('读不到客户名单 → roster_failed，不同步任何客户', async () => {
    let synced = 0
    const r = await runDirectLeadSheetSync({
      loadClientIds: async () => { throw new Error('table missing') },
      loadClientName: async () => null,
      sync: async (c) => { synced++; return receipt(c.id, 0) },
      logClient: async () => undefined,
    })
    expect(r).toMatchObject({ status: 'roster_failed', error: 'table missing' })
    expect(synced).toBe(0)
  })
})
