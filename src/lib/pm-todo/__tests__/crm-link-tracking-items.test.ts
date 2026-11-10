import { describe, expect, it } from 'vitest'
import { linkTrackingFindings } from '../crm-link-tracking-items'

// Design 2026-11-10 B2 §6.1 / §8 row 18.
describe('linkTrackingFindings', () => {
  it('5 tracked mails and not one click report → "tracking may be broken"', () => {
    expect(linkTrackingFindings([{ clientId: 'c1', trackedMails: 5, clickReports: 0, failedSends: 0 }])).toEqual([
      { clientId: 'c1', problem: 'no_clicks', trackedMails: 5 },
    ])
  })

  it('fewer mails, or any click report at all (even a scan), is fine', () => {
    expect(linkTrackingFindings([{ clientId: 'c1', trackedMails: 4, clickReports: 0, failedSends: 0 }])).toEqual([])
    expect(linkTrackingFindings([{ clientId: 'c1', trackedMails: 20, clickReports: 1, failedSends: 0 }])).toEqual([])
  })

  it('more than 3 sends whose tokens failed → a finding; 3 is not yet', () => {
    expect(linkTrackingFindings([{ clientId: 'c1', trackedMails: 0, clickReports: 0, failedSends: 4 }])).toEqual([
      { clientId: 'c1', problem: 'failed_sends', failedSends: 4 },
    ])
    expect(linkTrackingFindings([{ clientId: 'c1', trackedMails: 0, clickReports: 0, failedSends: 3 }])).toEqual([])
  })
})
