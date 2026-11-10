import { describe, expect, it } from 'vitest'
import {
  META_LEADS_RUNS_PER_DAY,
  META_LEADS_SYNC_SCHEDULE,
  estimateMetaLeadsGraphReads,
} from '../leads-sync-schedule'

describe('meta lead sync schedule', () => {
  it('runs at minute 25 and minute 55, 48 times a day', () => {
    expect(META_LEADS_SYNC_SCHEDULE).toBe('25,55 * * * *')
    expect(META_LEADS_RUNS_PER_DAY).toBe(48)
  })

  it('counts one form list, one lead page, and one account read', () => {
    expect(estimateMetaLeadsGraphReads({
      clientsWithPage: 1,
      formsPerClient: 1,
      pagesPerForm: 1,
      adAccounts: 1,
    })).toEqual({ perRun: 3, perHour: 6, perDay: 144 })
  })

  it('counts a field fallback as a second walk of the same lead pages', () => {
    expect(estimateMetaLeadsGraphReads({
      clientsWithPage: 1,
      formsPerClient: 1,
      pagesPerForm: 1,
      adAccounts: 1,
      fieldFallback: true,
    })).toEqual({ perRun: 4, perHour: 8, perDay: 192 })
  })

  it('treats a bad count as zero', () => {
    expect(estimateMetaLeadsGraphReads({
      clientsWithPage: -1,
      formsPerClient: Number.NaN,
      pagesPerForm: 1.9,
      adAccounts: 0,
    })).toEqual({ perRun: 0, perHour: 0, perDay: 0 })
  })
})
