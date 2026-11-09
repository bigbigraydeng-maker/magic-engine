/**
 * 读接口（/api/clients/[id]/crm/auto-letters，类型见 @/lib/messaging/letters/types）
 * → 页面自己的数据形状（./types）。纯函数，不碰网络。
 *
 * 读接口是「倒计时信」专用的（按团、出发日、几个月分组），页面是通用的看板；
 * 「对象」那一列的文字、两个面板的标题和说明，都在这里按接口的意思拼好再交给页面。
 */

import type {
  AutoLetterDetail,
  AutoLettersList,
  LetterRow as ApiLetterRow,
  LetterStatus as ApiLetterStatus,
  RecipientRow as ApiRecipientRow,
} from '@/lib/messaging/letters/types'
import { COUNTDOWN_CADENCE } from '@/lib/messaging/letters/cadence'
import { bodyTextToBlocks } from './body-blocks'
import { formatShortDate } from './format'
import type {
  AutoSendOverview,
  LetterContent,
  LetterDetail,
  LetterSection,
  LetterStatus,
  LetterSummary,
  OpenInfo,
  RecipientRow,
} from './types'

const FIRST_NAME_RE = /\{\{\s*first_name\s*\}\}/g

/** 「3月11日团 · 3个月信」；每周信写「每周信」。 */
export function audienceLabelOf(row: ApiLetterRow): string {
  const { departOn, monthsLeft } = row.audience
  const cadence = monthsLeft === null ? '每周信' : `${monthsLeft}个月信`
  return `${formatShortDate(departOn)}团 · ${cadence}`
}

/** 接口的「草稿」里分两种：稿子已经在 ME 里（草稿）、信还没写（计划中）。 */
export function viewStatusOf(status: ApiLetterStatus, subject: string | null): LetterStatus {
  if (status === 'draft') return subject === null ? 'planned' : 'draft'
  return status
}

export function summaryOf(row: ApiLetterRow): LetterSummary {
  return {
    letterId: row.letterKey,
    sendDate: row.sendDate === '' ? null : row.sendDate,
    audienceLabel: audienceLabelOf(row),
    title: row.subject,
    status: viewStatusOf(row.status, row.subject),
    recipientCount: row.counts.recipients,
    sentCount: row.counts.sent,
    blockedCount: row.counts.blocked,
    failedCount: row.counts.failed,
    rehearsalCount: row.counts.rehearsal,
  }
}

function depositSection(rows: ApiLetterRow[]): LetterSection {
  return {
    key: 'deposit',
    kind: 'trigger',
    title: '交了定金就自动发的信',
    note: null,
    footnote: `只有订的时候离出发超过 ${COUNTDOWN_CADENCE.firstMonth} 个月的客人会收到；订得晚的客人直接进当月那一批。`,
    letters: rows.map((row) => ({ ...summaryOf(row), whenLabel: '定金确认后' })),
  }
}

function scheduledSection(rows: ApiLetterRow[], total: number): LetterSection {
  return {
    key: 'scheduled',
    kind: 'scheduled',
    title: '按期发送的信',
    note: '每月第一个周三；最后一个月每周三',
    footnote: `共 ${total} 个不同的信，这里先列最近两批；往后的批次到时间再出现。`,
    letters: rows.map(summaryOf),
  }
}

export function mapAutoLettersList(api: AutoLettersList): AutoSendOverview {
  const sections: LetterSection[] = []
  if (api.depositLetters.length > 0) sections.push(depositSection(api.depositLetters))
  if (api.scheduledLetters.length > 0) sections.push(scheduledSection(api.scheduledLetters, api.totalDistinctLetters))
  return {
    nextBatch: api.nextBatch && {
      sendDate: api.nextBatch.sendDate,
      letterCount: api.nextBatch.letterCount,
      recipientCount: api.nextBatch.recipientCount,
      status: api.nextBatch.phase,
    },
    sections,
    ...(api.notices && api.notices.length > 0 ? { notices: api.notices } : {}),
  }
}

function engagementOf(row: ApiRecipientRow): RecipientRow['engagement'] {
  if (row.clicked === true) return 'clicked'
  if (row.opened === true) return 'opened'
  return null
}

function recipientOf(row: ApiRecipientRow): RecipientRow {
  return {
    contactId: row.contactId,
    displayName: row.displayName,
    seats: row.seats,
    status: row.status,
    reasonText: row.reasonText,
    reasonCode: null,
    reasonDetail: null,
    engagement: engagementOf(row),
  }
}

function contentOf(letter: AutoLetterDetail['letter']): LetterContent | null {
  const { subject, previewText, bodyText, sampleFirstName } = letter
  if (subject === null && previewText === null && bodyText === null) return null
  const filled = bodyText === null ? null : bodyText.replace(FIRST_NAME_RE, sampleFirstName)
  return { title: subject, previewText, body: bodyTextToBlocks(filled), sampleFirstName }
}

function openInfoOf(api: AutoLetterDetail): OpenInfo {
  const summary = api.mailchimpSummary
  return summary ? { kind: 'per_recipient', openedPeople: summary.opened, clickedPeople: summary.clicked } : { kind: 'none' }
}

export function mapAutoLetterDetail(api: AutoLetterDetail): LetterDetail {
  return {
    summary: summaryOf(api.letter),
    content: contentOf(api.letter),
    recipients: api.recipients.map(recipientOf),
    openInfo: openInfoOf(api),
  }
}
