/**
 * D3 暂停待批准 → 今日待办。
 *
 * 🔴 验收「一条等批准的暂停，今日待办里只出现一条」必须**两个来源一起测**：
 *    通用 handoff（`fetchKernelHandoffTodos`，manual-items 的 pushKernelItems 调它）
 *    和专属待办（`pushAdsAutoPauseItems`）分开测都绿、合起来却一条都没有 / 出两条，
 *    正是魏征 2026-09-26 指出的「两边对不上照样全绿」。所以这里在**同一个假库**上
 *    跑两个来源，再过一遍坏链接过滤。
 *    （不直接调 `loadManualItems`：它会查二十多张别的表，假库对没建模的表一律抛错，
 *     测试会变成在给无关的表凑数据。manual-items 里这两路只是原样 push，没有别的加工。）
 */

import { describe, it, expect } from 'vitest'
import { createFakeSupabase, type Row, type FakeSupabaseOptions } from '@/lib/kernel/__tests__/fake-supabase'
import { fetchKernelHandoffTodos } from '@/lib/kernel/handoff'
import { dropBrokenLinks, type ManualItem } from '../manual-item-types'
import { pushAdsAutoPauseItems } from '../ads-auto-pause-items'

const D3 = 'ads.auto_pause_on_d3'
const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const RUN = '00000000-0000-4000-8000-000000000001'
const DEC = '00000000-0000-4000-8000-000000000002'
const NOW = new Date('2026-09-26T09:00:00.000Z')

function tables(opts: { decisionMatches?: boolean } = {}) {
  const runs: Row[] = [{
    id: RUN, client_id: CLIENT, action_key: D3, action_version: 1, idempotency_key: 'k1',
    status: 'pending_approval', needs_human: true, authorization_decision_id: DEC, last_error: null,
    input: { ad_account_id: 'act_1', adset_id: 'adset-9', diagnosis_code: 'D3', insight_date: '2026-09-25' },
    rationale: '「圣诞团」连续 3 天花钱没结果', created_at: '2026-09-25T20:00:00Z', updated_at: '2026-09-25T20:00:00Z',
  }]
  const decisions: Row[] = [{
    id: DEC, action_run_id: opts.decisionMatches === false ? 'someone-else' : RUN, client_id: CLIENT,
    action_key: D3, action_version: 1, idempotency_key: 'k1', verdict: 'require_approval',
  }]
  // 🔴 账表一行都没有 —— 「提交成功、写账失败」的孤儿形状
  return { action_runs: runs, authorization_decisions: decisions, flywheel_actions: [] as Row[] }
}

const okFetch: typeof fetch = async () => new Response(null, { status: 200 })

async function bothSources(t = tables()): Promise<ManualItem[]> {
  const sb = createFakeSupabase(t)
  const items: ManualItem[] = []
  await pushAdsAutoPauseItems(sb, items, () => 'CTS Tours NZ')
  for (const todo of await fetchKernelHandoffTodos(sb, NOW)) {
    items.push({ kind: 'kernel_needs_human', client_id: todo.client_id, client_name: 'CTS Tours NZ', what: todo.what, how: todo.how, href: todo.href })
  }
  return (await dropBrokenLinks(items, okFetch)).kept
}

describe('🔴 一条等批准的暂停，今日待办里恰好一条', () => {
  it('账表漏记的孤儿 run → 恰好一条专属待办，链接来自登记表，过完坏链接过滤还在', async () => {
    const kept = await bothSources()
    expect(kept).toHaveLength(1)
    expect(kept[0]).toMatchObject({
      kind: 'ads_auto_pause_pending',
      client_id: CLIENT,
      href: `https://app.magicengine.com.au/dashboard/clients/${CLIENT}/ads-health?tab=approvals`,
    })
    expect(kept[0].what).toContain('圣诞团')
    expect(`${kept[0].what}${kept[0].how}`).not.toContain('还没上线')
  })

  it('🔴 审批记录对不上的 run → 仍是恰好一条，待办说「回我一句」，不说「点批准」', async () => {
    const kept = await bothSources(tables({ decisionMatches: false }))
    expect(kept).toHaveLength(1)
    expect(kept[0].how).toContain('回我一句')
    expect(kept[0].how).not.toContain('点「批准」')
  })
})

describe('🔴 专属待办读失败也要下发，不只打日志', () => {
  it('读 action_runs 失败 → 一条「读不出来」', async () => {
    const opts: FakeSupabaseOptions = { failOn: [{ table: 'action_runs', op: 'select', message: 'boom' }] }
    const sb = createFakeSupabase(tables(), opts)
    const items: ManualItem[] = []
    await pushAdsAutoPauseItems(sb, items, () => 'x')
    // 两栏都读 action_runs（被拦那栏从 2026-11-04 起也读被拒 run），各报一条「读不出来」
    expect(items.map((i) => i.kind)).toEqual(['ads_auto_pause_pending', 'ads_auto_pause_blocked'])
    for (const item of items) {
      expect(item.what).toContain('读不出来')
      expect(item.how).toContain('回我一句')
    }
  })
})

describe('🔴 积压超过上限要说出来，不静默截掉', () => {
  it('101 条等批准 → 100 条待办 + 1 条「超过 100 条」', async () => {
    const runs: Row[] = []
    const decisions: Row[] = []
    for (let i = 0; i < 101; i++) {
      const id = `00000000-0000-4000-8000-${String(1000 + i).padStart(12, '0')}`
      const dec = `00000000-0000-4000-9000-${String(1000 + i).padStart(12, '0')}`
      runs.push({
        id, client_id: CLIENT, action_key: D3, action_version: 1, idempotency_key: `k${i}`,
        status: 'pending_approval', needs_human: true, authorization_decision_id: dec, last_error: null,
        input: { adset_id: `adset-${i}` }, rationale: '花钱没结果',
        created_at: new Date(Date.UTC(2026, 8, 1) + i * 60_000).toISOString(),
      })
      decisions.push({
        id: dec, action_run_id: id, client_id: CLIENT, action_key: D3, action_version: 1,
        idempotency_key: `k${i}`, verdict: 'require_approval',
      })
    }
    const sb = createFakeSupabase({ action_runs: runs, authorization_decisions: decisions, flywheel_actions: [] })
    const items: ManualItem[] = []
    await pushAdsAutoPauseItems(sb, items, () => 'x')
    expect(items).toHaveLength(101)
    expect(items.at(-1)!.what).toContain('超过 100 条')
    expect(items.at(-1)!.how).toContain('回我一句')
  })
})

// ── 被拦下的暂停建议（2026-11-04）──────────────────────────────────────────────
//
// 🔴 时间一律注入 `now`，不拨假时钟：「近 7 天」的边界由 created_at 和注入的 now 算，
//    删掉时间过滤，「8 天前的不收」那条必须红。

const DAY = 24 * 60 * 60 * 1000
const BLOCKED_NOW = new Date('2026-11-04T09:00:00.000Z')
const ago = (days: number) => new Date(BLOCKED_NOW.getTime() - days * DAY).toISOString()

let rowSeq = 0
function ledgerRow(payload: Record<string, unknown>, createdAt: string, clientId = CLIENT): Row {
  rowSeq += 1
  return {
    id: `00000000-0000-4000-a000-${String(rowSeq).padStart(12, '0')}`,
    client_id: clientId,
    flywheel: 'ads',
    action_type: D3,
    created_at: createdAt,
    payload: { diagnosis_code: 'D3', ...payload },
  }
}

const kernelBlocked = (createdAt: string, extra: Record<string, unknown> = {}) =>
  ledgerRow({
    status: 'blocked',
    adset_id: 'adset-7',
    adset_name: '北京团 · 兴趣人群',
    action_run_id: '00000000-0000-4000-8000-0000000000b1',
    reason: '「把花钱没结果的广告组暂停」会作用到客户自己的资产之外，这类动作一律要人点头 —— 这个客户的规则却配成了「自动执行」',
    ...extra,
  }, createdAt)

async function blockedOnly(rows: Row[], extraRuns: Row[] = []): Promise<ManualItem[]> {
  const sb = createFakeSupabase({ action_runs: extraRuns, authorization_decisions: [], flywheel_actions: rows })
  const items: ManualItem[] = []
  await pushAdsAutoPauseItems(sb, items, () => 'CTS Tours NZ', BLOCKED_NOW)
  return items.filter((i) => i.kind === 'ads_auto_pause_blocked')
}

function deniedRun(id: string, adsetId: string, updatedAt: string): Row {
  return {
    id, client_id: CLIENT, action_key: D3, action_version: 1, idempotency_key: `k-${id}`,
    status: 'denied', needs_human: true, authorization_decision_id: null,
    last_error: '这个客户的规则却配成了「自动执行」。先把规则改成「要审批」，在那之前一律不做',
    input: { ad_account_id: 'act_1', adset_id: adsetId, diagnosis_code: 'D3', insight_date: '2026-11-03' },
    rationale: '花钱没结果', created_at: updatedAt, updated_at: updatedAt,
  }
}

describe('🔴 被拦下的暂停建议进今日待办（不再只躺在账表里）', () => {
  it('内核拒了的 blocked → 一条待办，带 what / how / href 三件套', async () => {
    const items = await blockedOnly([kernelBlocked(ago(1))])
    expect(items).toHaveLength(1)
    const [item] = items
    expect(item.client_id).toBe(CLIENT)
    expect(item.what).toContain('北京团 · 兴趣人群')
    expect(item.what).toContain('被拦下')
    expect(item.what).toContain('系统没能出手暂停它')
    expect(item.what).not.toContain('照常花钱') // 没核实过的说法不写
    expect(item.what).toContain('规则却配成了「自动执行」') // 原因原文要带上
    expect(item.how).toContain('回我一句')
    expect(item.href).toBe(`https://app.magicengine.com.au/dashboard/clients/${CLIENT}/ads-health?tab=ads`)
  })

  it('🔴 how 不让 PM 去改规则：原因里「改成要审批」由系统同步做', async () => {
    const [item] = await blockedOnly([kernelBlocked(ago(1))])
    expect(item.how).toContain('你不用去改规则')
    expect(item.how).toContain('同步')
    expect(item.how).not.toMatch(/去(设置|后台)里?把规则改/)
  })

  it('安全闸拦的（没有内核 run）→ 也进，但说清不是规则配错，链接去「每条广告」', async () => {
    const items = await blockedOnly([
      ledgerRow({ status: 'blocked', adset_id: 'adset-8', adset_name: '上海团', reason: '共用账户，不自动出手' }, ago(2)),
    ])
    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('共用账户')
    expect(items[0].how).toContain('安全闸')
    expect(items[0].href).toBe(`https://app.magicengine.com.au/dashboard/clients/${CLIENT}/ads-health?tab=ads`)
  })

  it('🔴 核实过是别人主页的组（other_page）不进待办；客户没登记主页（client_page_unknown）照进', async () => {
    const other = ledgerRow({ status: 'blocked', adset_id: 'adset-o', adset_name: '别人的组', ownership_verdict: 'other_page', reason: 'x' }, ago(1))
    const unknown = ledgerRow({ status: 'blocked', adset_id: 'adset-u', adset_name: '没登记主页', ownership_verdict: 'client_page_unknown', reason: '客户没登记 Facebook 主页' }, ago(1))
    const items = await blockedOnly([other, unknown])
    expect(items.map((i) => i.what.includes('没登记主页'))).toEqual([true])
  })

  it('内部代号翻成人话，不把 kernel_inconsistent_pending_approval 原样甩给 PM', async () => {
    const items = await blockedOnly([kernelBlocked(ago(1), { reason: 'kernel_inconsistent_pending_approval' })])
    expect(items[0].what).not.toContain('kernel_inconsistent_pending_approval')
    expect(items[0].what).toContain('审批记录没挂上')
  })

  it('🔴 8 天前的 blocked 不收；6 天前的收', async () => {
    expect(await blockedOnly([kernelBlocked(ago(8))])).toHaveLength(0)
    expect(await blockedOnly([kernelBlocked(ago(6))])).toHaveLength(1)
  })

  it('🔴 只收 blocked：dry_run_logged / awaiting_approval / failed 都不进这一栏', async () => {
    const rows = ['dry_run_logged', 'awaiting_approval', 'failed'].map((status, i) =>
      ledgerRow({ status, adset_id: `adset-${i}`, reason: 'x' }, ago(1)),
    )
    expect(await blockedOnly(rows)).toHaveLength(0)
  })

  it('同一个广告组被拦多天 → 只出一条，写明被拦了几次', async () => {
    const items = await blockedOnly([kernelBlocked(ago(1)), kernelBlocked(ago(2)), kernelBlocked(ago(3))])
    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('被拦了 3 次')
  })

  it('不收别的动作的账（action_type 不是 D3 自动暂停）', async () => {
    const other = { ...kernelBlocked(ago(1)), action_type: 'ads.pause_unit' }
    expect(await blockedOnly([other])).toHaveLength(0)
  })

  it('读账表失败 → 一条「读不出来」，不只打日志', async () => {
    const opts: FakeSupabaseOptions = { failOn: [{ table: 'flywheel_actions', op: 'select', message: 'boom' }] }
    const sb = createFakeSupabase({ action_runs: [], authorization_decisions: [], flywheel_actions: [] }, opts)
    const items: ManualItem[] = []
    await pushAdsAutoPauseItems(sb, items, () => 'x', BLOCKED_NOW)
    const blocked = items.filter((i) => i.kind === 'ads_auto_pause_blocked')
    expect(blocked).toHaveLength(1)
    expect(blocked[0].what).toContain('读不出来')
  })

  it('🔴 等批准那一栏行为不变：pending + 别的广告组一条 blocked → 各一条，pending 链接仍是「等你点头」', async () => {
    const t = tables()
    t.flywheel_actions = [kernelBlocked(ago(1))]
    const sb = createFakeSupabase(t)
    const items: ManualItem[] = []
    await pushAdsAutoPauseItems(sb, items, () => 'CTS Tours NZ', BLOCKED_NOW)
    expect(items.map((i) => i.kind)).toEqual(['ads_auto_pause_pending', 'ads_auto_pause_blocked'])
    expect(items[0].href).toBe(`https://app.magicengine.com.au/dashboard/clients/${CLIENT}/ads-health?tab=approvals`)
    expect(items[0].what).toContain('圣诞团')
  })
})

describe('🔴 被拦下按「客户 + 广告组」去重', () => {
  it('同一广告组已有等批准（不同 run）→ 不再列「被拦下」', async () => {
    const t = tables() // 等批准的是 adset-9
    t.flywheel_actions = [kernelBlocked(ago(2), { adset_id: 'adset-9', action_run_id: '00000000-0000-4000-8000-0000000000c9' })]
    const sb = createFakeSupabase(t)
    const items: ManualItem[] = []
    await pushAdsAutoPauseItems(sb, items, () => 'CTS Tours NZ', BLOCKED_NOW)
    expect(items.map((i) => i.kind)).toEqual(['ads_auto_pause_pending'])
  })

  it('同一广告组在被拦之后又有非 blocked 的账（演练 / 等批准 / 失败…）→ 不列；之前的非 blocked 账不影响', async () => {
    for (const status of ['dry_run_logged', 'awaiting_approval', 'failed']) {
      const later = ledgerRow({ status, adset_id: 'adset-7', reason: 'x' }, ago(1))
      expect(await blockedOnly([kernelBlocked(ago(2)), later]), status).toHaveLength(0)
    }
    const earlier = ledgerRow({ status: 'dry_run_logged', adset_id: 'adset-7', reason: 'x' }, ago(3))
    expect(await blockedOnly([kernelBlocked(ago(2)), earlier])).toHaveLength(1)
  })

  it('别的客户的同名广告组不算同一组', async () => {
    const otherClient = '00000000-0000-4000-8000-0000000000ee'
    const later = ledgerRow({ status: 'dry_run_logged', adset_id: 'adset-7', reason: 'x' }, ago(1), otherClient)
    expect(await blockedOnly([kernelBlocked(ago(2)), later])).toHaveLength(1)
  })
})

describe('🔴 内核被拒的 run 以 action_runs 为真相（通用 handoff 不再发这条）', () => {
  it('账表漏记的被拒 run → 照样一条「被拦下」，原因取 run 的 last_error', async () => {
    const items = await blockedOnly([], [deniedRun('00000000-0000-4000-8000-0000000000d1', 'adset-21', ago(1))])
    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('adset-21')
    expect(items[0].what).toContain('规则却配成了「自动执行」')
  })

  it('被拒 run 账表也记了 → 只出一条（用账表的广告组名）', async () => {
    const runId = '00000000-0000-4000-8000-0000000000d2'
    const items = await blockedOnly(
      [kernelBlocked(ago(1), { action_run_id: runId, adset_id: 'adset-22', adset_name: '杭州团' })],
      [deniedRun(runId, 'adset-22', ago(1))],
    )
    expect(items).toHaveLength(1)
    expect(items[0].what).toContain('杭州团')
    expect(items[0].what).not.toContain('被拦了 2 次')
  })

  it('8 天前被拒的 run 不收', async () => {
    expect(await blockedOnly([], [deniedRun('00000000-0000-4000-8000-0000000000d3', 'adset-23', ago(8))])).toHaveLength(0)
  })
})
