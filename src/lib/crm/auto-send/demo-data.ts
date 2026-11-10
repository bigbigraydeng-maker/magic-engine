/**
 * Synthetic demo data for the read-only 「自动发信」 page.
 *
 * Everything here is invented: letters, guest names, seats and results. It is only loaded when a
 * person clicks 「看示例」, and the page labels the whole view as sample data. No real people,
 * no email addresses, no phone numbers, no company or tour names.
 *
 * Each LetterSummary object (T1, L1..L12) is built once and referenced by BOTH the overview and the
 * details, so the two views can never drift apart.
 */

import type { AutoSendAdapter } from './adapter'
import type {
  AutoSendOverview,
  BodyBlock,
  LetterContent,
  LetterDetail,
  LetterSection,
  LetterSummary,
  RecipientRow,
  RecipientStatus,
  TourGroupSummary,
} from './types'

/* ------------------------------------------------------------------ helpers */

const SEATS: ReadonlyArray<number | null> = [2, 1, 4, 2, 2, 1, null, 2, 1, 2]

interface Guest {
  contactId: string
  displayName: string
}

/** One invented guest. n = 1 -> 'demo-contact-01' / 'Demo Guest 01'. */
function guest(n: number): Guest {
  const padded = String(n).padStart(2, '0')
  return { contactId: `demo-contact-${padded}`, displayName: `Demo Guest ${padded}` }
}

function range(start: number, end: number): number[] {
  const numbers: number[] = []
  for (let n = start; n <= end; n += 1) numbers.push(n)
  return numbers
}

interface RecipientSpec {
  status: RecipientStatus
  reasonCode?: string | null
  reasonDetail?: string | null
  /** Plain-language reason, as the read interface would already have translated it. */
  reasonText?: string | null
  engagement?: 'opened' | 'clicked' | null
}

/** Builds the recipient rows of one letter; seats follow the position inside that letter. */
function makeRecipients(
  numbers: readonly number[],
  spec: (n: number) => RecipientSpec,
): RecipientRow[] {
  return numbers.map((n, index) => {
    const who = guest(n)
    const extra = spec(n)
    return {
      contactId: who.contactId,
      displayName: who.displayName,
      seats: SEATS[index % SEATS.length] ?? null,
      status: extra.status,
      reasonCode: extra.reasonCode ?? null,
      reasonDetail: extra.reasonDetail ?? null,
      ...(extra.reasonText ? { reasonText: extra.reasonText } : {}),
      engagement: extra.engagement ?? null,
    }
  })
}

function heading(text: string): BodyBlock {
  return { kind: 'heading', text }
}

function paragraph(text: string): BodyBlock {
  return { kind: 'paragraph', text }
}

function bullet(text: string): BodyBlock {
  return { kind: 'bullet', text }
}

/* ---------------------------------------------------------------- summaries */

const T1: LetterSummary = {
  letterId: 'demo-t1',
  sendDate: null,
  whenLabel: '定金确认后',
  audienceLabel: '订得早的客人',
  title: null,
  status: 'not_enabled',
  recipientCount: 0,
  sentCount: null,
  blockedCount: null,
  failedCount: null,
  unknownCount: 0,
  rehearsalCount: 0,
  openedCount: null,
}

const L1: LetterSummary = {
  letterId: 'demo-l1',
  sendDate: '2026-10-07',
  audienceLabel: '示例团甲 · 4个月信',
  title: 'Sample letter: how the weather looks on your route',
  status: 'sent',
  recipientCount: 10,
  sentCount: 8,
  blockedCount: 1,
  failedCount: 1,
  unknownCount: 0,
  rehearsalCount: 0,
  openedCount: 6,
}

const L2: LetterSummary = {
  letterId: 'demo-l2',
  sendDate: '2026-11-04',
  audienceLabel: '示例团乙 · 3个月信',
  title: 'Sample letter: thank you for booking',
  status: 'sent',
  recipientCount: 5,
  sentCount: 4,
  blockedCount: 1,
  failedCount: 0,
  unknownCount: 0,
  rehearsalCount: 0,
  openedCount: null,
}

const L3: LetterSummary = {
  letterId: 'demo-l3',
  sendDate: '2026-12-02',
  audienceLabel: '示例团甲 · 3个月信',
  title: 'Sample letter: what March will feel like',
  status: 'draft',
  recipientCount: 10,
  sentCount: null,
  blockedCount: null,
  failedCount: null,
  unknownCount: 0,
  rehearsalCount: 0,
  openedCount: null,
}

const L4: LetterSummary = {
  letterId: 'demo-l4',
  sendDate: '2026-12-02',
  audienceLabel: '示例团乙 · 3个月信',
  title: 'Sample letter: what March will feel like',
  status: 'draft',
  recipientCount: 1,
  sentCount: null,
  blockedCount: null,
  failedCount: null,
  unknownCount: 0,
  rehearsalCount: 0,
  openedCount: null,
}

const L5: LetterSummary = {
  letterId: 'demo-l5',
  sendDate: '2026-12-02',
  audienceLabel: '示例团丙 · 5个月信',
  title: 'Sample letter: what May will feel like',
  status: 'draft',
  recipientCount: 5,
  sentCount: null,
  blockedCount: null,
  failedCount: null,
  unknownCount: 0,
  rehearsalCount: 0,
  openedCount: null,
}

const L6: LetterSummary = {
  letterId: 'demo-l6',
  sendDate: '2026-12-02',
  audienceLabel: '示例团丁 · 5个月信',
  title: 'Sample letter: what May will feel like',
  status: 'awaiting_release',
  recipientCount: 5,
  sentCount: null,
  blockedCount: null,
  failedCount: null,
  unknownCount: 0,
  rehearsalCount: 5,
  openedCount: null,
}

const L7: LetterSummary = {
  letterId: 'demo-l7',
  sendDate: '2027-01-06',
  audienceLabel: '示例团甲 · 2个月信',
  title: null,
  status: 'planned',
  recipientCount: 10,
  sentCount: null,
  blockedCount: null,
  failedCount: null,
  unknownCount: 0,
  rehearsalCount: 0,
  openedCount: null,
}

const L8: LetterSummary = {
  letterId: 'demo-l8',
  sendDate: '2027-01-06',
  audienceLabel: '示例团乙 · 2个月信',
  title: null,
  status: 'planned',
  recipientCount: 1,
  sentCount: null,
  blockedCount: null,
  failedCount: null,
  unknownCount: 0,
  rehearsalCount: 0,
  openedCount: null,
}

const L9: LetterSummary = {
  letterId: 'demo-l9',
  sendDate: '2027-01-06',
  audienceLabel: '示例团丙 · 4个月信',
  title: null,
  status: 'planned',
  recipientCount: 5,
  sentCount: null,
  blockedCount: null,
  failedCount: null,
  unknownCount: 0,
  rehearsalCount: 0,
  openedCount: null,
}

const L10: LetterSummary = {
  letterId: 'demo-l10',
  sendDate: '2027-01-06',
  audienceLabel: '示例团丁 · 4个月信',
  title: null,
  status: 'planned',
  recipientCount: 5,
  sentCount: null,
  blockedCount: null,
  failedCount: null,
  unknownCount: 0,
  rehearsalCount: 0,
  openedCount: null,
}

/** A past batch where nobody got the letter: 3 blocked by the sending rules, 2 failed. */
const L11: LetterSummary = {
  letterId: 'demo-l11',
  sendDate: '2026-11-04',
  audienceLabel: '示例团丙 · 6个月信',
  title: 'Sample letter: welcome aboard',
  status: 'not_sent',
  recipientCount: 5,
  sentCount: 0,
  blockedCount: 3,
  failedCount: 2,
  unknownCount: 0,
  rehearsalCount: 0,
  openedCount: null,
}

/** A past batch with no confirmed delivery, but four results still unknown (the letters may well have arrived). */
const L12: LetterSummary = {
  letterId: 'demo-l12',
  sendDate: '2026-11-04',
  audienceLabel: '示例团丁 · 6个月信',
  title: 'Sample letter: welcome aboard',
  status: 'unknown',
  recipientCount: 5,
  sentCount: 0,
  blockedCount: 1,
  failedCount: 0,
  unknownCount: 4,
  rehearsalCount: 0,
  openedCount: null,
}

/* ----------------------------------------------------------------- contents */

const L1_CONTENT: LetterContent = {
  title: L1.title,
  previewText: 'The weather on your route and one thing to do at home.',
  body: [
    heading('What the weather is like'),
    paragraph('Hi {first_name}, here is a short sample note about the weather on your route.'),
    bullet('City one: cool mornings, mild afternoons.'),
    bullet('City two: some rain, bring a light jacket.'),
    paragraph('Pack layers and comfortable shoes.'),
    heading('Good to know'),
    paragraph('This is invented sample text for the demo page.'),
    paragraph('One thing to do at home: check your passport dates.'),
    paragraph('Warm regards, The Sample Team'),
  ],
}

const L2_CONTENT: LetterContent = {
  title: L2.title,
  previewText: 'A short thank-you and what happens next.',
  body: [
    paragraph('Hi {first_name},'),
    paragraph('Thank you for booking with us. This is invented sample text.'),
    heading('What happens next'),
    bullet('We will write once a month.'),
    bullet('Every letter is checked before it goes out.'),
    paragraph('Warm regards, The Sample Team'),
  ],
}

/** Same text for L11 and L12 (they share the same title). */
const WELCOME_CONTENT: LetterContent = {
  title: L11.title,
  previewText: 'A short welcome and what to expect.',
  body: [
    paragraph('Hi {first_name},'),
    paragraph('Welcome aboard. This is invented sample text.'),
    heading('What to expect'),
    bullet('We will write once a month.'),
    paragraph('Warm regards, The Sample Team'),
  ],
}

/** Same text for L3 and L4 (they share the same title). */
const MARCH_CONTENT: LetterContent = {
  title: L3.title,
  previewText: 'The weather on your route, the time difference, and one thing to do at home.',
  body: [
    paragraph('Hi {first_name},'),
    paragraph('This is invented sample text about what March will feel like.'),
    heading('What March will feel like'),
    bullet('City one: around 1°C and 13°C.'),
    bullet('City two: around 4°C and 16°C.'),
    paragraph('Take a warm jacket and comfortable shoes.'),
    heading('Good to know'),
    paragraph('Sample note about the time difference.'),
    heading('One thing to do at home'),
    paragraph('Sample suggestion for the demo.'),
    paragraph('Warm regards, The Sample Team'),
  ],
}

/** Same text for L5 and L6 (they share the same title). */
const MAY_CONTENT: LetterContent = {
  title: L5.title,
  previewText: 'What to expect in May and one thing to do at home.',
  body: [
    paragraph('Hi {first_name},'),
    paragraph('This is invented sample text about what May will feel like.'),
    heading('What May will feel like'),
    bullet('City one: warm days, cool evenings.'),
    bullet('City two: a few showers.'),
    paragraph('Pack light clothes and a thin rain jacket.'),
    heading('One thing to do at home'),
    paragraph('Sample suggestion for the demo.'),
    paragraph('Warm regards, The Sample Team'),
  ],
}

/* --------------------------------------------------------------- recipients */

function l1Spec(n: number): RecipientSpec {
  if (n <= 2) return { status: 'sent', engagement: 'clicked' }
  if (n <= 6) return { status: 'sent', engagement: 'opened' }
  if (n <= 8) return { status: 'sent' }
  if (n === 9) {
    return { status: 'blocked', reasonCode: 'frequency_cap', reasonDetail: '最近 7 天已收了 2 封' }
  }
  return { status: 'failed', reasonCode: 'bounced', reasonDetail: '地址无效' }
}

function l2Spec(n: number): RecipientSpec {
  if (n === 14) return { status: 'blocked', reasonCode: 'mailchimp_suppressed' }
  return { status: 'sent' }
}

function l11Spec(n: number): RecipientSpec {
  if (n <= 18) return { status: 'blocked', reasonCode: 'frequency_full' }
  return { status: 'failed', reasonCode: 'bounced', reasonDetail: '地址无效' }
}

function l12Spec(n: number): RecipientSpec {
  if (n === 21) return { status: 'blocked', reasonCode: 'dnc' }
  return { status: 'unknown', reasonCode: 'unknown_outcome', reasonText: '发送结果不明，等人核对' }
}

function pendingSpec(): RecipientSpec {
  return { status: 'pending' }
}

function rehearsalSpec(): RecipientSpec {
  return { status: 'rehearsal' }
}

const T1_RECIPIENTS: RecipientRow[] = []

const L1_RECIPIENTS: RecipientRow[] = makeRecipients(range(1, 10), l1Spec)
const L2_RECIPIENTS: RecipientRow[] = makeRecipients(range(11, 15), l2Spec)
const L3_RECIPIENTS: RecipientRow[] = makeRecipients(range(1, 10), pendingSpec)
const L4_RECIPIENTS: RecipientRow[] = makeRecipients(range(11, 11), pendingSpec)
const L5_RECIPIENTS: RecipientRow[] = makeRecipients(range(16, 20), pendingSpec)
const L6_RECIPIENTS: RecipientRow[] = makeRecipients(range(21, 25), rehearsalSpec)
const L7_RECIPIENTS: RecipientRow[] = makeRecipients(range(1, 10), pendingSpec)
const L8_RECIPIENTS: RecipientRow[] = makeRecipients(range(11, 11), pendingSpec)
const L9_RECIPIENTS: RecipientRow[] = makeRecipients(range(16, 20), pendingSpec)
const L10_RECIPIENTS: RecipientRow[] = makeRecipients(range(21, 25), pendingSpec)
const L11_RECIPIENTS: RecipientRow[] = makeRecipients(range(16, 20), l11Spec)
const L12_RECIPIENTS: RecipientRow[] = makeRecipients(range(21, 25), l12Spec)

/* ----------------------------------------------------------------- sections */

const TRIGGER_SECTION: LetterSection = {
  key: 'trigger',
  kind: 'trigger',
  title: '交了定金就自动发的信',
  note: null,
  footnote: '示例说明：这类信只发给「订得早」的客人；订得晚的客人直接进当月那一批。',
  letters: [T1],
}

const SCHEDULED_SECTION: LetterSection = {
  key: 'scheduled',
  kind: 'scheduled',
  title: '按期发送的信',
  note: '示例：每月第一个周三；最后一个月每周三',
  footnote: '共 8 个不同的信，这里先列最近两批；往后的批次到时间再出现。（示例数据）',
  letters: [L3, L4, L5, L6, L7, L8, L9, L10],
}

/** 已经过了发信日、系统里有记录的信，新的在前（和真实数据的列法一样）。 */
const PAST_SECTION: LetterSection = {
  key: 'past',
  kind: 'scheduled',
  title: '已过发信日的信',
  note: '系统里有发送记录或提交记录的',
  footnote:
    '这里只列最近几批。发信日已经过了、却还是「草稿」或「等你放行」的，说明这一批没有发出去；没有记录的日子不列。（示例数据）',
  letters: [L2, L11, L12, L1],
}

/* ------------------------------------------------------------------- groups */

/** 「最近一封已发」那一格：直接取这封信的数字，和列表里永远一致。 */
function lastSentOf(letter: LetterSummary): NonNullable<TourGroupSummary['lastSent']> {
  return {
    letterId: letter.letterId,
    sendDate: letter.sendDate ?? '',
    recipientCount: letter.recipientCount,
    sentCount: letter.sentCount ?? 0,
    blockedCount: letter.blockedCount ?? 0,
    failedCount: letter.failedCount ?? 0,
    unknownCount: letter.unknownCount,
    openedCount: letter.openedCount,
  }
}

function nextOf(letter: LetterSummary): NonNullable<TourGroupSummary['next']> {
  return { letterId: letter.letterId, sendDate: letter.sendDate ?? '', status: letter.status }
}

const GROUP_A: TourGroupSummary = {
  groupId: 'demo-group-a',
  tourName: '示例团甲',
  departOn: '2027-03-11',
  recipientCount: 10,
  lettersSent: 1,
  lettersAhead: 2,
  lettersOverdue: 0,
  lettersUnknown: 0,
  lastSent: lastSentOf(L1),
  next: nextOf(L3),
  letterIds: [L1.letterId, L3.letterId, L7.letterId],
}

const GROUP_B: TourGroupSummary = {
  groupId: 'demo-group-b',
  tourName: '示例团乙',
  departOn: '2027-03-18',
  recipientCount: 5,
  lettersSent: 1,
  lettersAhead: 2,
  lettersOverdue: 0,
  lettersUnknown: 0,
  lastSent: lastSentOf(L2),
  next: nextOf(L4),
  letterIds: [L2.letterId, L4.letterId, L8.letterId],
}

const GROUP_C: TourGroupSummary = {
  groupId: 'demo-group-c',
  tourName: '示例团丙',
  departOn: '2027-05-08',
  recipientCount: 5,
  lettersSent: 0,
  lettersAhead: 2,
  lettersOverdue: 1,
  lettersUnknown: 0,
  lastSent: null,
  next: nextOf(L5),
  letterIds: [L11.letterId, L5.letterId, L9.letterId],
}

const GROUP_D: TourGroupSummary = {
  groupId: 'demo-group-d',
  tourName: '示例团丁',
  departOn: '2027-05-13',
  recipientCount: 5,
  lettersSent: 0,
  lettersAhead: 2,
  lettersOverdue: 0,
  lettersUnknown: 1,
  lastSent: null,
  next: nextOf(L6),
  letterIds: [L12.letterId, L6.letterId, L10.letterId],
}

/* ------------------------------------------------------------------ exports */

export const DEMO_OVERVIEW: AutoSendOverview = {
  nextBatch: {
    sendDate: '2026-12-02',
    letterCount: 4,
    recipientCount: 21,
    status: 'draft',
  },
  sections: [TRIGGER_SECTION, SCHEDULED_SECTION, PAST_SECTION],
  groups: [GROUP_A, GROUP_B, GROUP_C, GROUP_D],
}

export const DEMO_DETAILS: Readonly<Record<string, LetterDetail>> = {
  'demo-t1': {
    summary: T1,
    content: null,
    recipients: T1_RECIPIENTS,
    openInfo: { kind: 'none' },
  },
  'demo-l1': {
    summary: L1,
    content: L1_CONTENT,
    recipients: L1_RECIPIENTS,
    openInfo: { kind: 'per_recipient', openedPeople: 6, clickedPeople: 2, fromMailchimp: true },
  },
  'demo-l2': {
    summary: L2,
    content: L2_CONTENT,
    recipients: L2_RECIPIENTS,
    // ME 自己发的信现在不记录打开：整列显示「—」。
    openInfo: { kind: 'none' },
  },
  'demo-l3': {
    summary: L3,
    content: MARCH_CONTENT,
    recipients: L3_RECIPIENTS,
    openInfo: { kind: 'none' },
  },
  'demo-l4': {
    summary: L4,
    content: MARCH_CONTENT,
    recipients: L4_RECIPIENTS,
    openInfo: { kind: 'none' },
  },
  'demo-l5': {
    summary: L5,
    content: MAY_CONTENT,
    recipients: L5_RECIPIENTS,
    openInfo: { kind: 'none' },
  },
  'demo-l6': {
    summary: L6,
    content: MAY_CONTENT,
    recipients: L6_RECIPIENTS,
    openInfo: { kind: 'none' },
  },
  'demo-l7': {
    summary: L7,
    content: null,
    recipients: L7_RECIPIENTS,
    openInfo: { kind: 'none' },
  },
  'demo-l8': {
    summary: L8,
    content: null,
    recipients: L8_RECIPIENTS,
    openInfo: { kind: 'none' },
  },
  'demo-l9': {
    summary: L9,
    content: null,
    recipients: L9_RECIPIENTS,
    openInfo: { kind: 'none' },
  },
  'demo-l10': {
    summary: L10,
    content: null,
    recipients: L10_RECIPIENTS,
    openInfo: { kind: 'none' },
  },
  'demo-l11': {
    summary: L11,
    content: WELCOME_CONTENT,
    recipients: L11_RECIPIENTS,
    openInfo: { kind: 'none' },
  },
  'demo-l12': {
    summary: L12,
    content: WELCOME_CONTENT,
    recipients: L12_RECIPIENTS,
    openInfo: { kind: 'none' },
  },
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs)
  })
}

/** Demo adapter: resolves the synthetic data after an optional delay, never touches a network. */
export function createDemoAdapter(delayMs = 0): AutoSendAdapter {
  return {
    loadOverview: async () => {
      await wait(delayMs)
      return DEMO_OVERVIEW
    },
    loadLetterDetail: async (letterId: string) => {
      await wait(delayMs)
      if (!Object.prototype.hasOwnProperty.call(DEMO_DETAILS, letterId)) throw new Error('示例里没有这封信')
      return DEMO_DETAILS[letterId]
    },
  }
}
