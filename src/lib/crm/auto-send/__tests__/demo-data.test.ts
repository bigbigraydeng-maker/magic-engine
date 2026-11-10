import { describe, expect, it } from 'vitest'
import { DEMO_DETAILS, DEMO_OVERVIEW, createDemoAdapter } from '../demo-data'
import type { AutoSendAdapter } from '../adapter'
import type { LetterDetail, LetterSummary, RecipientStatus } from '../types'

const ALL_SUMMARIES: LetterSummary[] = DEMO_OVERVIEW.sections.flatMap((section) => section.letters)

function detailFor(letterId: string): LetterDetail {
  const detail = DEMO_DETAILS[letterId]
  if (!detail) throw new Error(`missing demo detail for ${letterId}`)
  return detail
}

function countStatus(detail: LetterDetail, status: RecipientStatus): number {
  return detail.recipients.filter((recipient) => recipient.status === status).length
}

describe('demo data: overview and details never drift apart', () => {
  it('has one detail per overview letter, reusing the very same summary object', () => {
    expect(Object.keys(DEMO_DETAILS)).toHaveLength(ALL_SUMMARIES.length)
    for (const summary of ALL_SUMMARIES) {
      const detail = DEMO_DETAILS[summary.letterId]
      expect(detail).toBeDefined()
      expect(detail?.summary).toBe(summary)
    }
  })

  it('keeps recipient counts consistent with each summary', () => {
    for (const summary of ALL_SUMMARIES) {
      const detail = detailFor(summary.letterId)
      expect(detail.recipients).toHaveLength(summary.recipientCount)
      if (summary.sentCount !== null) {
        expect(countStatus(detail, 'sent')).toBe(summary.sentCount)
      }
      if (summary.blockedCount !== null) {
        expect(countStatus(detail, 'blocked')).toBe(summary.blockedCount)
      }
      if (summary.failedCount !== null) {
        expect(countStatus(detail, 'failed')).toBe(summary.failedCount)
      }
      expect(countStatus(detail, 'rehearsal')).toBe(summary.rehearsalCount)
    }
  })

  it('never counts rehearsal recipients as already sent', () => {
    for (const summary of ALL_SUMMARIES) {
      if (summary.sentCount === null) continue
      expect(summary.sentCount + summary.rehearsalCount).toBeLessThanOrEqual(summary.recipientCount)
    }
  })
})

describe('demo data: open information', () => {
  it('matches the L1 open numbers to what the recipients say', () => {
    const detail = detailFor('demo-l1')
    const { openInfo, recipients } = detail
    expect(openInfo).toEqual({ kind: 'per_recipient', openedPeople: 6, clickedPeople: 2, fromMailchimp: true })
    if (openInfo.kind !== 'per_recipient') throw new Error('expected per_recipient open info')
    const openedPeople = recipients.filter(
      (recipient) => recipient.engagement === 'opened' || recipient.engagement === 'clicked',
    ).length
    const clickedPeople = recipients.filter((recipient) => recipient.engagement === 'clicked').length
    expect(openedPeople).toBe(openInfo.openedPeople)
    expect(clickedPeople).toBe(openInfo.clickedPeople)
  })

  it('reports no open numbers at all for the letter sent by ME (it does not record opens)', () => {
    const detail = detailFor('demo-l2')
    expect(detail.openInfo).toEqual({ kind: 'none' })
    expect(detail.summary.openedCount).toBeNull()
    for (const recipient of detail.recipients) {
      expect(recipient.engagement).toBeNull()
    }
  })

  it('the list number for the Mailchimp letter is the same as its detail says', () => {
    const detail = detailFor('demo-l1')
    if (detail.openInfo.kind !== 'per_recipient') throw new Error('expected per_recipient open info')
    expect(detail.summary.openedCount).toBe(detail.openInfo.openedPeople)
  })
})

describe('demo data: panels and groups', () => {
  const byId = new Map(ALL_SUMMARIES.map((summary) => [summary.letterId, summary]))

  it('lists the letters whose day has passed in their own panel, newest first, after the upcoming ones', () => {
    expect(DEMO_OVERVIEW.sections.map((section) => section.key)).toEqual(['trigger', 'scheduled', 'past'])
    const past = DEMO_OVERVIEW.sections[2]
    expect(past.letters.map((letter) => letter.letterId)).toEqual(['demo-l2', 'demo-l1'])
    const upcoming = DEMO_OVERVIEW.sections[1].letters
    expect(upcoming.every((letter) => (letter.sendDate ?? '') >= '2026-12-02')).toBe(true)
    expect(past.letters.every((letter) => (letter.sendDate ?? '') < '2026-12-02')).toBe(true)
  })

  it('every group points at letters that exist, oldest first', () => {
    expect(DEMO_OVERVIEW.groups.length).toBeGreaterThan(0)
    for (const group of DEMO_OVERVIEW.groups) {
      const dates = group.letterIds.map((id) => {
        const letter = byId.get(id)
        if (!letter) throw new Error(`group ${group.groupId} points at a missing letter ${id}`)
        return letter.sendDate ?? ''
      })
      expect([...dates].sort()).toEqual(dates)
    }
  })

  it('the group numbers agree with the letters they list', () => {
    for (const group of DEMO_OVERVIEW.groups) {
      const letters = group.letterIds.map((id) => byId.get(id) as LetterSummary)
      const sent = letters.filter((letter) => letter.status === 'sent')
      expect(group.lettersSent).toBe(sent.length)
      expect(group.lettersAhead).toBe(letters.filter((letter) => letter.status !== 'sent').length)
      const last = sent[sent.length - 1]
      if (last === undefined) {
        expect(group.lastSent).toBeNull()
      } else {
        expect(group.lastSent).toMatchObject({
          letterId: last.letterId,
          sentCount: last.sentCount,
          blockedCount: last.blockedCount,
          failedCount: last.failedCount,
          openedCount: last.openedCount,
        })
      }
      const next = letters.find((letter) => letter.status !== 'sent')
      expect(group.next?.letterId).toBe(next?.letterId)
    }
  })
})

describe('demo data: next batch', () => {
  it('matches the letters sent on the next batch date', () => {
    const nextBatch = DEMO_OVERVIEW.nextBatch
    if (!nextBatch) throw new Error('expected a next batch')
    const letters = ALL_SUMMARIES.filter((summary) => summary.sendDate === nextBatch.sendDate)
    expect(letters).toHaveLength(nextBatch.letterCount)
    const recipientCount = letters.reduce((sum, summary) => sum + summary.recipientCount, 0)
    expect(recipientCount).toBe(nextBatch.recipientCount)
  })
})

describe('demo data: invented guests only', () => {
  it('uses demo guest names and contains no email addresses', () => {
    for (const detail of Object.values(DEMO_DETAILS)) {
      for (const recipient of detail.recipients) {
        if (recipient.displayName === null) continue
        expect(recipient.displayName.startsWith('Demo Guest ')).toBe(true)
      }
    }
    expect(JSON.stringify(DEMO_DETAILS)).not.toContain('@')
    expect(JSON.stringify(DEMO_OVERVIEW)).not.toContain('@')
  })
})

describe('demo adapter', () => {
  it('resolves the overview and a known letter', async () => {
    const adapter: AutoSendAdapter = createDemoAdapter()
    await expect(adapter.loadOverview()).resolves.toBe(DEMO_OVERVIEW)
    await expect(adapter.loadLetterDetail('demo-l1')).resolves.toBe(DEMO_DETAILS['demo-l1'])
  })

  it('rejects an unknown letter with the demo message', async () => {
    const adapter: AutoSendAdapter = createDemoAdapter()
    await expect(adapter.loadLetterDetail('nope')).rejects.toThrow('示例里没有这封信')
  })

  it('never answers with an inherited object key such as constructor or __proto__', async () => {
    const adapter: AutoSendAdapter = createDemoAdapter()
    await expect(adapter.loadLetterDetail('constructor')).rejects.toThrow('示例里没有这封信')
    await expect(adapter.loadLetterDetail('__proto__')).rejects.toThrow('示例里没有这封信')
  })
})
