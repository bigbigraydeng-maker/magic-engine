import { describe, it, expect } from 'vitest'
import {
  checkDormantDraft,
  checkAccountBackstop,
  type DormantSnapshotRow,
  type DormantSpendRow,
  type DormantLayerEvidence,
  type DormantSpendEvidence,
  type AccountBackstopRow,
  type AccountBackstopSpendRow,
} from '../dormant-draft-check'

const NOW = new Date('2026-10-05T12:00:00Z')
const SINCE = '2026-10-05'
const THROUGH = '2026-10-04'

function snap(
  level: DormantSnapshotRow['level'],
  entity_id: string,
  campaign_id: string | null,
  status: string | null,
  captured_at = '2026-10-05T11:00:00Z',
): DormantSnapshotRow {
  return { level, entity_id, campaign_id, status, effective_status: status, captured_at }
}

function spendRow(entity_id: string, insight_date: string, spend: number): DormantSpendRow {
  return { entity_id, insight_date, spend }
}

function liveLayers(rows: readonly DormantSnapshotRow[], readOk = true): DormantLayerEvidence {
  return { source: 'meta_live', readOk, rows }
}

function dbLayers(rows: readonly DormantSnapshotRow[]): DormantLayerEvidence {
  return { source: 'db_snapshot', rows }
}

function liveSpend(rows: readonly DormantSpendRow[], readOk = true, throughDate = THROUGH): DormantSpendEvidence {
  return { source: 'meta_live', readOk, throughDate, rows }
}

function dbSpend(rows: readonly DormantSpendRow[], latestInsightDate: string | null): DormantSpendEvidence {
  return { source: 'db_insights', latestInsightDate, rows }
}

const DRAFT = 'c1'

function pausedThreeLayers(): DormantSnapshotRow[] {
  return [
    snap('campaign', 'c1', 'c1', 'PAUSED'),
    snap('adset', 'a1', 'c1', 'PAUSED'),
    snap('ad', 'ad1', 'c1', 'PAUSED'),
  ]
}

describe('checkDormantDraft', () => {
  it('ok path: live layers readOk true and live zero spend readOk true', () => {
    const res = checkDormantDraft({
      campaignIds: [DRAFT],
      layers: liveLayers(pausedThreeLayers()),
      spend: liveSpend([]),
      sinceDate: SINCE,
      requiredThroughDate: THROUGH,
      now: NOW,
    })
    expect(res.verdict).toBe('ok')
    expect(res.spendTotal).toBe(0)
    expect(res.findings).toEqual([])
  })

  it('db_snapshot layers all paused => unverified, never ok', () => {
    const res = checkDormantDraft({
      campaignIds: [DRAFT],
      layers: dbLayers(pausedThreeLayers()),
      spend: liveSpend([]),
      sinceDate: SINCE,
      requiredThroughDate: THROUGH,
      now: NOW,
    })
    expect(res.verdict).toBe('unverified')
    expect(res.findings.some((f) => f.includes('只能当参考'))).toBe(true)
  })

  it('meta_live layers readOk false with all rows paused => unverified', () => {
    const res = checkDormantDraft({
      campaignIds: [DRAFT],
      layers: liveLayers(pausedThreeLayers(), false),
      spend: liveSpend([]),
      sinceDate: SINCE,
      requiredThroughDate: THROUGH,
      now: NOW,
    })
    expect(res.verdict).toBe('unverified')
    expect(res.findings).toContain('Meta 实时读回没有全部成功，不能证明三层仍是暂停')
  })

  it('meta_live spend readOk false with empty rows => unverified, not ok', () => {
    const res = checkDormantDraft({
      campaignIds: [DRAFT],
      layers: liveLayers(pausedThreeLayers()),
      spend: liveSpend([], false),
      sinceDate: SINCE,
      requiredThroughDate: THROUGH,
      now: NOW,
    })
    expect(res.verdict).toBe('unverified')
    expect(res.findings).toContain('Meta 花费读回没有成功，不能证明花费为 0')
  })

  it('child ACTIVE under paused campaign => violation', () => {
    const rows = [
      snap('campaign', 'c1', 'c1', 'PAUSED'),
      snap('adset', 'a1', 'c1', 'ACTIVE'),
      snap('ad', 'ad1', 'c1', 'PAUSED'),
    ]
    const res = checkDormantDraft({
      campaignIds: [DRAFT],
      layers: liveLayers(rows),
      spend: liveSpend([]),
      sinceDate: SINCE,
      requiredThroughDate: THROUGH,
      now: NOW,
    })
    expect(res.verdict).toBe('violation')
    expect(res.layers.adset.notPaused).toEqual(['a1'])
  })

  it('opened campaign => violation', () => {
    const rows = [
      snap('campaign', 'c1', 'c1', 'ACTIVE'),
      snap('adset', 'a1', 'c1', 'PAUSED'),
      snap('ad', 'ad1', 'c1', 'PAUSED'),
    ]
    const res = checkDormantDraft({
      campaignIds: [DRAFT],
      layers: liveLayers(rows),
      spend: liveSpend([]),
      sinceDate: SINCE,
      requiredThroughDate: THROUGH,
      now: NOW,
    })
    expect(res.verdict).toBe('violation')
    expect(res.layers.campaign.notPaused).toEqual(['c1'])
  })

  it('spend > 0 => violation', () => {
    const res = checkDormantDraft({
      campaignIds: [DRAFT],
      layers: liveLayers(pausedThreeLayers()),
      spend: liveSpend([spendRow('c1', '2026-10-05', 3.5)]),
      sinceDate: SINCE,
      requiredThroughDate: THROUGH,
      now: NOW,
    })
    expect(res.verdict).toBe('violation')
    expect(res.spendTotal).toBe(3.5)
  })

  it('spend before sinceDate ignored', () => {
    const res = checkDormantDraft({
      campaignIds: [DRAFT],
      layers: liveLayers(pausedThreeLayers()),
      spend: liveSpend([spendRow('c1', '2026-10-01', 9.99)]),
      sinceDate: SINCE,
      requiredThroughDate: THROUGH,
      now: NOW,
    })
    expect(res.verdict).toBe('ok')
    expect(res.spendTotal).toBe(0)
  })

  it('db_insights stale => unverified', () => {
    const res = checkDormantDraft({
      campaignIds: [DRAFT],
      layers: liveLayers(pausedThreeLayers()),
      spend: dbSpend([], '2026-09-22'),
      sinceDate: SINCE,
      requiredThroughDate: THROUGH,
      now: NOW,
    })
    expect(res.verdict).toBe('unverified')
    expect(res.findings.some((f) => f.includes('库里日花费最新只到'))).toBe(true)
  })

  it('db_insights fresh => ok with live layers', () => {
    const res = checkDormantDraft({
      campaignIds: [DRAFT],
      layers: liveLayers(pausedThreeLayers()),
      spend: dbSpend([], '2026-10-04'),
      sinceDate: SINCE,
      requiredThroughDate: THROUGH,
      now: NOW,
    })
    expect(res.verdict).toBe('ok')
  })

  it('missing layer => unverified', () => {
    const rows = [snap('campaign', 'c1', 'c1', 'PAUSED'), snap('adset', 'a1', 'c1', 'PAUSED')]
    const res = checkDormantDraft({
      campaignIds: [DRAFT],
      layers: liveLayers(rows),
      spend: liveSpend([]),
      sinceDate: SINCE,
      requiredThroughDate: THROUGH,
      now: NOW,
    })
    expect(res.verdict).toBe('unverified')
    expect(res.findings.some((f) => f.includes('没读到广告这一层'))).toBe(true)
  })

  it('null own status => unverified', () => {
    const rows = [
      snap('campaign', 'c1', 'c1', 'PAUSED'),
      snap('adset', 'a1', 'c1', null),
      snap('ad', 'ad1', 'c1', 'PAUSED'),
    ]
    const res = checkDormantDraft({
      campaignIds: [DRAFT],
      layers: liveLayers(rows),
      spend: liveSpend([]),
      sinceDate: SINCE,
      requiredThroughDate: THROUGH,
      now: NOW,
    })
    expect(res.verdict).toBe('unverified')
    expect(res.findings.some((f) => f.includes('广告组 a1 的自身状态读不到'))).toBe(true)
  })

  it('violation wins over unverified', () => {
    const rows = [
      snap('campaign', 'c1', 'c1', 'PAUSED'),
      snap('adset', 'a1', 'c1', 'ACTIVE'),
      snap('ad', 'ad1', 'c1', 'PAUSED'),
    ]
    const res = checkDormantDraft({
      campaignIds: [DRAFT],
      layers: liveLayers(rows, false),
      spend: liveSpend([], false),
      sinceDate: SINCE,
      requiredThroughDate: THROUGH,
      now: NOW,
    })
    expect(res.verdict).toBe('violation')
  })

  it('rows of other campaigns ignored', () => {
    const rows = [
      ...pausedThreeLayers(),
      snap('campaign', 'c9', 'c9', 'ACTIVE'),
      snap('adset', 'a9', 'c9', 'ACTIVE'),
    ]
    const res = checkDormantDraft({
      campaignIds: [DRAFT],
      layers: liveLayers(rows),
      spend: liveSpend([]),
      sinceDate: SINCE,
      requiredThroughDate: THROUGH,
      now: NOW,
    })
    expect(res.verdict).toBe('ok')
  })

  it('empty campaignIds => unverified', () => {
    const res = checkDormantDraft({
      campaignIds: [],
      layers: liveLayers(pausedThreeLayers()),
      spend: liveSpend([]),
      sinceDate: SINCE,
      requiredThroughDate: THROUGH,
      now: NOW,
    })
    expect(res.verdict).toBe('unverified')
    expect(res.findings).toEqual(['没有给出要核对的系列编号，没法核对'])
  })
})

function acctRow(
  level: AccountBackstopRow['level'],
  entity_id: string,
  campaign_id: string | null,
  status: string | null,
): AccountBackstopRow {
  return { level, entity_id, campaign_id, status }
}

function acctSpend(entity_id: string, campaign_id: string | null, insight_date: string, spend: number): AccountBackstopSpendRow {
  return { entity_id, campaign_id, insight_date, spend }
}

function cleanAccountRows(): AccountBackstopRow[] {
  return [
    acctRow('campaign', 'c1', 'c1', 'PAUSED'),
    acctRow('adset', 'a1', 'c1', 'PAUSED'),
    acctRow('ad', 'ad1', 'c1', 'PAUSED'),
  ]
}

describe('checkAccountBackstop', () => {
  it('clean account => ok', () => {
    const res = checkAccountBackstop({
      rows: cleanAccountRows(),
      rowsReadOk: true,
      authorizedCampaignIds: [],
      knownExceptionIds: [],
      receiptCampaignIds: ['c1'],
      spend: { readOk: true, throughDate: THROUGH, rows: [] },
      sinceDate: SINCE,
      requiredThroughDate: THROUGH,
    })
    expect(res.verdict).toBe('ok')
    expect(res.unauthorizedActive).toEqual([])
    expect(res.unaccountedPausedCampaigns).toEqual([])
    expect(res.spendTotalUncovered).toBe(0)
  })

  it('uncovered ACTIVE campaign with all ad sets PAUSED => not a violation, unauthorizedActive empty', () => {
    const rows = [...cleanAccountRows(), acctRow('campaign', 'c2', 'c2', 'ACTIVE')]
    const res = checkAccountBackstop({
      rows,
      rowsReadOk: true,
      authorizedCampaignIds: [],
      knownExceptionIds: [],
      receiptCampaignIds: ['c1'],
      spend: { readOk: true, throughDate: THROUGH, rows: [] },
      sinceDate: SINCE,
      requiredThroughDate: THROUGH,
    })
    expect(res.verdict).toBe('ok')
    expect(res.unauthorizedActive).toEqual([])
  })

  it('uncovered ACTIVE adset under an ACTIVE campaign => violation and listed in unauthorizedActive', () => {
    const rows = [...cleanAccountRows(), acctRow('campaign', 'c2', 'c2', 'ACTIVE'), acctRow('adset', 'a2', 'c2', 'ACTIVE')]
    const res = checkAccountBackstop({
      rows,
      rowsReadOk: true,
      authorizedCampaignIds: [],
      knownExceptionIds: [],
      receiptCampaignIds: ['c1'],
      spend: { readOk: true, throughDate: THROUGH, rows: [] },
      sinceDate: SINCE,
      requiredThroughDate: THROUGH,
    })
    expect(res.verdict).toBe('violation')
    expect(res.unauthorizedActive).toEqual(['a2'])
  })

  it('unlisted ACTIVE adset => violation and listed in unauthorizedActive', () => {
    const rows = [...cleanAccountRows(), acctRow('adset', 'a2', 'c1', 'ACTIVE')]
    const res = checkAccountBackstop({
      rows,
      rowsReadOk: true,
      authorizedCampaignIds: [],
      knownExceptionIds: [],
      receiptCampaignIds: ['c1'],
      spend: { readOk: true, throughDate: THROUGH, rows: [] },
      sinceDate: SINCE,
      requiredThroughDate: THROUGH,
    })
    expect(res.verdict).toBe('violation')
    expect(res.unauthorizedActive).toEqual(['a2'])
  })

  it('unlisted ACTIVE ad => violation', () => {
    const rows = [...cleanAccountRows(), acctRow('ad', 'ad2', 'c1', 'ACTIVE')]
    const res = checkAccountBackstop({
      rows,
      rowsReadOk: true,
      authorizedCampaignIds: [],
      knownExceptionIds: [],
      receiptCampaignIds: ['c1'],
      spend: { readOk: true, throughDate: THROUGH, rows: [] },
      sinceDate: SINCE,
      requiredThroughDate: THROUGH,
    })
    expect(res.verdict).toBe('violation')
    expect(res.unauthorizedActive).toEqual(['ad2'])
  })

  it('ACTIVE adset under an authorized campaign => not flagged', () => {
    const rows = [...cleanAccountRows(), acctRow('adset', 'a2', 'c1', 'ACTIVE')]
    const res = checkAccountBackstop({
      rows,
      rowsReadOk: true,
      authorizedCampaignIds: ['c1'],
      knownExceptionIds: [],
      receiptCampaignIds: ['c1'],
      spend: { readOk: true, throughDate: THROUGH, rows: [] },
      sinceDate: SINCE,
      requiredThroughDate: THROUGH,
    })
    expect(res.verdict).toBe('ok')
    expect(res.unauthorizedActive).toEqual([])
  })

  it('ACTIVE adset in knownExceptionIds => not flagged', () => {
    const rows = [...cleanAccountRows(), acctRow('adset', 'a2', 'c1', 'ACTIVE')]
    const res = checkAccountBackstop({
      rows,
      rowsReadOk: true,
      authorizedCampaignIds: [],
      knownExceptionIds: ['a2'],
      receiptCampaignIds: ['c1'],
      spend: { readOk: true, throughDate: THROUGH, rows: [] },
      sinceDate: SINCE,
      requiredThroughDate: THROUGH,
    })
    expect(res.verdict).toBe('ok')
    expect(res.unauthorizedActive).toEqual([])
  })

  it('ACTIVE adset whose campaign_id is in knownExceptionIds => not flagged', () => {
    const rows = [...cleanAccountRows(), acctRow('adset', 'a2', 'c1', 'ACTIVE')]
    const res = checkAccountBackstop({
      rows,
      rowsReadOk: true,
      authorizedCampaignIds: [],
      knownExceptionIds: ['c1'],
      receiptCampaignIds: ['c1'],
      spend: { readOk: true, throughDate: THROUGH, rows: [] },
      sinceDate: SINCE,
      requiredThroughDate: THROUGH,
    })
    expect(res.verdict).toBe('ok')
    expect(res.unauthorizedActive).toEqual([])
  })

  it('uncovered spend => violation', () => {
    const res = checkAccountBackstop({
      rows: cleanAccountRows(),
      rowsReadOk: true,
      authorizedCampaignIds: [],
      knownExceptionIds: [],
      receiptCampaignIds: ['c1'],
      spend: { readOk: true, throughDate: THROUGH, rows: [acctSpend('a2', 'c2', '2026-10-05', 4.25)] },
      sinceDate: SINCE,
      requiredThroughDate: THROUGH,
    })
    expect(res.verdict).toBe('violation')
    expect(res.spendTotalUncovered).toBe(4.25)
  })

  it('covered spend ignored', () => {
    const res = checkAccountBackstop({
      rows: cleanAccountRows(),
      rowsReadOk: true,
      authorizedCampaignIds: ['c2'],
      knownExceptionIds: [],
      receiptCampaignIds: ['c1'],
      spend: { readOk: true, throughDate: THROUGH, rows: [acctSpend('a2', 'c2', '2026-10-05', 4.25)] },
      sinceDate: SINCE,
      requiredThroughDate: THROUGH,
    })
    expect(res.verdict).toBe('ok')
    expect(res.spendTotalUncovered).toBe(0)
  })

  it('spend before sinceDate ignored', () => {
    const res = checkAccountBackstop({
      rows: cleanAccountRows(),
      rowsReadOk: true,
      authorizedCampaignIds: [],
      knownExceptionIds: [],
      receiptCampaignIds: ['c1'],
      spend: { readOk: true, throughDate: THROUGH, rows: [acctSpend('a2', 'c2', '2026-10-01', 4.25)] },
      sinceDate: SINCE,
      requiredThroughDate: THROUGH,
    })
    expect(res.verdict).toBe('ok')
    expect(res.spendTotalUncovered).toBe(0)
  })

  it('PAUSED campaign not in receipt/known/authorized => unverified and in unaccountedPausedCampaigns', () => {
    const rows = [...cleanAccountRows(), acctRow('campaign', 'c2', 'c2', 'PAUSED')]
    const res = checkAccountBackstop({
      rows,
      rowsReadOk: true,
      authorizedCampaignIds: [],
      knownExceptionIds: [],
      receiptCampaignIds: ['c1'],
      spend: { readOk: true, throughDate: THROUGH, rows: [] },
      sinceDate: SINCE,
      requiredThroughDate: THROUGH,
    })
    expect(res.verdict).toBe('unverified')
    expect(res.unaccountedPausedCampaigns).toEqual(['c2'])
  })

  it('receiptCampaignIds null => finding text contains 草稿回执读不到', () => {
    const rows = [...cleanAccountRows(), acctRow('campaign', 'c2', 'c2', 'PAUSED')]
    const res = checkAccountBackstop({
      rows,
      rowsReadOk: true,
      authorizedCampaignIds: [],
      knownExceptionIds: [],
      receiptCampaignIds: null,
      spend: { readOk: true, throughDate: THROUGH, rows: [] },
      sinceDate: SINCE,
      requiredThroughDate: THROUGH,
    })
    expect(res.verdict).toBe('unverified')
    expect(res.findings.some((f) => f.includes('草稿回执读不到'))).toBe(true)
  })

  it('rowsReadOk false => unverified', () => {
    const res = checkAccountBackstop({
      rows: cleanAccountRows(),
      rowsReadOk: false,
      authorizedCampaignIds: [],
      knownExceptionIds: [],
      receiptCampaignIds: ['c1'],
      spend: { readOk: true, throughDate: THROUGH, rows: [] },
      sinceDate: SINCE,
      requiredThroughDate: THROUGH,
    })
    expect(res.verdict).toBe('unverified')
    expect(res.findings).toContain('官方账户读回没有全部成功，不能证明账户里没有被打开的东西')
  })

  it('spend readOk false => unverified', () => {
    const res = checkAccountBackstop({
      rows: cleanAccountRows(),
      rowsReadOk: true,
      authorizedCampaignIds: [],
      knownExceptionIds: [],
      receiptCampaignIds: ['c1'],
      spend: { readOk: false, throughDate: THROUGH, rows: [] },
      sinceDate: SINCE,
      requiredThroughDate: THROUGH,
    })
    expect(res.verdict).toBe('unverified')
    expect(res.findings).toContain('Meta 花费读回没有成功，不能证明花费为 0')
  })

  it('stale throughDate => unverified', () => {
    const res = checkAccountBackstop({
      rows: cleanAccountRows(),
      rowsReadOk: true,
      authorizedCampaignIds: [],
      knownExceptionIds: [],
      receiptCampaignIds: ['c1'],
      spend: { readOk: true, throughDate: '2026-10-01', rows: [] },
      sinceDate: SINCE,
      requiredThroughDate: THROUGH,
    })
    expect(res.verdict).toBe('unverified')
    expect(res.findings.some((f) => f.includes('早于需要的'))).toBe(true)
  })

  it('violation wins over unverified', () => {
    const rows = [...cleanAccountRows(), acctRow('adset', 'a2', 'c1', 'ACTIVE')]
    const res = checkAccountBackstop({
      rows,
      rowsReadOk: false,
      authorizedCampaignIds: [],
      knownExceptionIds: [],
      receiptCampaignIds: null,
      spend: { readOk: false, throughDate: THROUGH, rows: [] },
      sinceDate: SINCE,
      requiredThroughDate: THROUGH,
    })
    expect(res.verdict).toBe('violation')
  })
})
