import type { LedgerEntry, LedgerStatus } from '@/lib/ledger/types'
import type { BoardIssue, PointState, SkillCard, SkillCardError } from './types'

export interface BoardInput {
  cards: SkillCard[]
  errors: SkillCardError[]
  ledgerEntries: LedgerEntry[]
  rulebookText: string
  digestText: string
  /** YYYY-MM-DD, NZ date */
  today: string
  /** 台账里解析失败的文件：必须显示，不能让「找不到交接卡」盖住真实原因 */
  ledgerErrors?: { file: string; reason: string }[]
}

export type BoardGroupKey = 'learning' | 'pm_decision' | 'verifying' | 'adopted' | 'passed' | 'already_in_me'

export interface BoardItem {
  /** '' for orphan handoff items */
  cardId: string
  cardTitle: string
  key: string
  text: string
  /** null for orphan handoff items */
  state: PointState | null
  note: string | null
  rule: string | null
  handoff: string | null
  /** e.g. '74 号' or '106 号和 74 号'; '' when unknown */
  owner: string
  verifyBy: string | null
  ledgerStatus: LedgerStatus | null
  overdue: boolean
  /** verifying point whose ledger entry is already verified: 「验完待写入规则」 */
  verifiedPending: boolean
  /** ledger handoff card that no point references */
  orphan: boolean
}

export interface BoardCounts {
  /** learning + pm_decision */
  learning: number
  pmDecision: number
  verifying: number
  passed: number
  adopted: number
  alreadyInMe: number
}

export interface Board {
  /** non-null = whole page must show only this red error */
  fatal: string | null
  groups: Record<BoardGroupKey, BoardItem[]>
  counts: BoardCounts
  issues: BoardIssue[]
  /** cards with no / broken 机器索引 */
  unorganized: SkillCardError[]
  /** 读到并解析成功的学习笔记张数，页面显示给 PM 核对 */
  cardCount: number
}

export const RULE_ID_RE = /^(RL|S|C|E|B)-\d+$/

const OWNER_RE = /交\s*(\d+)\s*号(?:和\s*(\d+)\s*号)?/

export function ownerFromTitle(title: string): string {
  const m = OWNER_RE.exec(title)
  if (!m) return ''
  const a = m[1]
  const b = m[2]
  if (b) return `${a} 号和 ${b} 号`
  return `${a} 号`
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 规则手册里以该编号开头的所有表格行（同一编号可能出现在多处） */
export function findRuleRows(rulebookText: string, ruleId: string): string[] {
  const re = new RegExp('^\\|\\s*(?:\\*\\*)?' + escapeRegExp(ruleId) + '(?![0-9A-Za-z])')
  return rulebookText.split('\n').filter((line) => re.test(line))
}

export function findRuleRow(rulebookText: string, ruleId: string): string | null {
  return findRuleRows(rulebookText, ruleId)[0] ?? null
}

/** 规则行里是否写了本卡文件名（整名匹配，-foo 不得命中 -foo-bar） */
export function rowMentionsCard(row: string, cardId: string): boolean {
  return new RegExp(escapeRegExp(cardId) + '(?:\\.md)?(?![0-9A-Za-z-])').test(row)
}

export function digestTags(digestText: string): Set<string> {
  const tags = new Set<string>()
  const re = /\[([^\]\n]+)\]/g
  let m: RegExpExecArray | null = re.exec(digestText)
  while (m !== null) {
    const inner = m[1].trim()
    if (inner) tags.add(inner)
    for (const part of inner.split('/')) {
      const p = part.trim()
      if (p) tags.add(p)
    }
    m = re.exec(digestText)
  }
  return tags
}

function emptyGroups(): Record<BoardGroupKey, BoardItem[]> {
  return {
    learning: [],
    pm_decision: [],
    verifying: [],
    adopted: [],
    passed: [],
    already_in_me: [],
  }
}

function zeroCounts(): BoardCounts {
  return { learning: 0, pmDecision: 0, verifying: 0, passed: 0, adopted: 0, alreadyInMe: 0 }
}

function fatalBoard(message: string, errors: SkillCardError[]): Board {
  return { fatal: message, groups: emptyGroups(), counts: zeroCounts(), issues: [], unorganized: errors, cardCount: 0 }
}

function groupOf(state: PointState): BoardGroupKey | null {
  switch (state) {
    case 'learning':
      return 'learning'
    case 'pm_decision':
      return 'pm_decision'
    case 'verifying':
      return 'verifying'
    case 'adopted':
      return 'adopted'
    case 'not_applicable':
    case 'tried_failed':
    case 'cannot_check':
      return 'passed'
    case 'already_in_me':
      return 'already_in_me'
    case 'merged':
      return null
  }
}

function baseItem(card: SkillCard, point: SkillCard['points'][number]): BoardItem {
  return {
    cardId: card.id,
    cardTitle: card.title,
    key: point.key,
    text: point.text,
    state: point.state,
    note: point.note,
    rule: point.rule,
    handoff: point.handoff,
    owner: '',
    verifyBy: null,
    ledgerStatus: null,
    overdue: false,
    verifiedPending: false,
    orphan: false,
  }
}

function isOverdue(entry: LedgerEntry, today: string): boolean {
  if (entry.status !== 'decided' && entry.status !== 'done') return false
  return entry.verifyBy !== null && entry.verifyBy < today
}

function checkVerifying(
  card: SkillCard,
  point: SkillCard['points'][number],
  item: BoardItem,
  ledger: Map<string, LedgerEntry>,
  today: string,
  issues: BoardIssue[],
): void {
  const handoff = point.handoff
  if (!handoff) return
  const entry = ledger.get(handoff)
  if (!entry) {
    issues.push({ level: 'error', cardId: card.id, pointKey: point.key, message: '交接卡在台账里找不到：' + handoff })
    return
  }
  item.owner = ownerFromTitle(entry.title)
  item.verifyBy = entry.verifyBy
  item.ledgerStatus = entry.status
  if (entry.status === 'decided' || entry.status === 'done') {
    item.overdue = isOverdue(entry, today)
  } else if (entry.status === 'verified') {
    item.verifiedPending = true
  } else if (entry.status === 'failed') {
    issues.push({
      level: 'error',
      cardId: card.id,
      pointKey: point.key,
      message: '台账已判不成立，这个点应改成 tried_failed',
    })
  }
}

function checkTriedFailed(
  card: SkillCard,
  point: SkillCard['points'][number],
  item: BoardItem,
  ledger: Map<string, LedgerEntry>,
  issues: BoardIssue[],
): void {
  const handoff = point.handoff
  if (!handoff) return
  const entry = ledger.get(handoff)
  if (!entry) {
    issues.push({ level: 'error', cardId: card.id, pointKey: point.key, message: '交接卡在台账里找不到：' + handoff })
    return
  }
  item.owner = ownerFromTitle(entry.title)
  item.verifyBy = entry.verifyBy
  item.ledgerStatus = entry.status
  if (entry.status !== 'failed') {
    issues.push({
      level: 'error',
      cardId: card.id,
      pointKey: point.key,
      message: '台账没判「不成立」（failed），不能算「试过不成立」',
    })
  }
}

function checkAdopted(
  card: SkillCard,
  point: SkillCard['points'][number],
  rulebookText: string,
  issues: BoardIssue[],
): void {
  const rule = point.rule
  if (!rule || !RULE_ID_RE.test(rule)) {
    issues.push({
      level: 'error',
      cardId: card.id,
      pointKey: point.key,
      message: '已合并进 ME 必须写规则手册编号（如 C-18）',
    })
    return
  }
  const rows = findRuleRows(rulebookText, rule)
  if (rows.length === 0) {
    issues.push({ level: 'error', cardId: card.id, pointKey: point.key, message: `规则手册里找不到 ${rule}` })
    return
  }
  if (!rows.some((row) => rowMentionsCard(row, card.id))) {
    issues.push({
      level: 'error',
      cardId: card.id,
      pointKey: point.key,
      message: `规则 ${rule} 那一行没写本卡文件名，不能算学会了`,
    })
  }
}

function checkAlreadyInMe(
  card: SkillCard,
  point: SkillCard['points'][number],
  rulebookText: string,
  tags: Set<string>,
  issues: BoardIssue[],
): void {
  const rule = point.rule
  if (!rule) return
  if (RULE_ID_RE.test(rule)) {
    if (findRuleRow(rulebookText, rule) === null) {
      issues.push({ level: 'error', cardId: card.id, pointKey: point.key, message: `规则手册里找不到 ${rule}` })
    }
    return
  }
  if (!tags.has(rule)) {
    issues.push({
      level: 'error',
      cardId: card.id,
      pointKey: point.key,
      message: `规则摘要里没有「${rule}」这个标签`,
    })
  }
}

function checkMerged(
  card: SkillCard,
  point: SkillCard['points'][number],
  allKeys: Set<string>,
  issues: BoardIssue[],
): void {
  const target = point.mergedInto
  if (!target) return
  if (!allKeys.has(target)) {
    issues.push({ level: 'error', cardId: card.id, pointKey: point.key, message: '合并指向的点不存在：' + target })
  }
}

function correctionWarnings(cards: SkillCard[], issues: BoardIssue[]): void {
  for (const card of cards) {
    if (!card.hasCorrection) continue
    const hasNote = card.points.some((p) => p.note !== null && p.note.includes('复核更正后'))
    if (!hasNote) {
      issues.push({
        level: 'warning',
        cardId: card.id,
        pointKey: null,
        message: '卡里有「复核更正」，但没有一个点注明「复核更正后」，请确认索引是按更正后的结论整理的',
      })
    }
  }
}

/** 没有任何点引用的交接卡：在验的进「待验证」，台账判失败的进「pass」 */
function orphanItems(
  ledgerEntries: LedgerEntry[],
  referenced: Set<string>,
  today: string,
): BoardItem[] {
  const items: BoardItem[] = []
  for (const entry of ledgerEntries) {
    if (!entry.id.includes('skill-handoff')) continue
    if (referenced.has(entry.id)) continue
    items.push({
      cardId: '',
      cardTitle: '',
      key: entry.id,
      text: entry.title,
      state: null,
      note: null,
      rule: null,
      handoff: entry.id,
      owner: ownerFromTitle(entry.title),
      verifyBy: entry.verifyBy,
      ledgerStatus: entry.status,
      overdue: isOverdue(entry, today),
      verifiedPending: entry.status === 'verified',
      orphan: true,
    })
  }
  return items
}

function countGroups(groups: Record<BoardGroupKey, BoardItem[]>): BoardCounts {
  return {
    learning: groups.learning.length + groups.pm_decision.length,
    pmDecision: groups.pm_decision.length,
    verifying: groups.verifying.length,
    passed: groups.passed.length,
    adopted: groups.adopted.length,
    alreadyInMe: groups.already_in_me.length,
  }
}

interface CheckContext {
  ledger: Map<string, LedgerEntry>
  tags: Set<string>
  allKeys: Set<string>
  issues: BoardIssue[]
  input: BoardInput
}

/** 按 state 做一致性校验；merged 不进任何分组，返回 null */
function checkPoint(card: SkillCard, point: SkillCard['points'][number], ctx: CheckContext): BoardItem | null {
  if (point.state === 'merged') {
    checkMerged(card, point, ctx.allKeys, ctx.issues)
    return null
  }
  const item = baseItem(card, point)
  const { input, issues } = ctx
  if (point.state === 'verifying') checkVerifying(card, point, item, ctx.ledger, input.today, issues)
  if (point.state === 'tried_failed') checkTriedFailed(card, point, item, ctx.ledger, issues)
  if (point.state === 'adopted') checkAdopted(card, point, input.rulebookText, issues)
  if (point.state === 'already_in_me') checkAlreadyInMe(card, point, input.rulebookText, ctx.tags, issues)
  return item
}

export function buildBoard(input: BoardInput): Board {
  if (input.cards.length === 0) {
    return fatalBoard('一张能读的技能卡都没有（目录为空或全部解析失败），页面不显示数字以免误导', input.errors)
  }
  if (input.rulebookText.trim() === '') {
    return fatalBoard('广告规则手册读不到或为空，没法核对「已合并进 ME」', input.errors)
  }

  const ledger = new Map<string, LedgerEntry>()
  for (const entry of input.ledgerEntries) ledger.set(entry.id, entry)

  const tags = digestTags(input.digestText)
  const groups = emptyGroups()
  const issues: BoardIssue[] = []

  const allKeys = new Set<string>()
  for (const card of input.cards) {
    for (const point of card.points) allKeys.add(`${card.id}#${point.key}`)
  }

  const referenced = new Set<string>()
  const ctx: CheckContext = { ledger, tags, allKeys, issues, input }
  for (const card of input.cards) {
    for (const point of card.points) {
      if (point.handoff) referenced.add(point.handoff)
      const item = checkPoint(card, point, ctx)
      const group = groupOf(point.state)
      if (item !== null && group !== null) groups[group].push(item)
    }
  }

  correctionWarnings(input.cards, issues)

  const orphans = orphanItems(input.ledgerEntries, referenced, input.today)
  for (const item of orphans) {
    if (item.ledgerStatus === 'failed') groups.passed.push(item)
    else groups.verifying.push(item)
  }
  for (const err of input.ledgerErrors ?? []) {
    issues.push({ level: 'error', cardId: '', pointKey: null, message: `台账文件读不出：${err.file}（${err.reason}）` })
  }

  return {
    fatal: null,
    groups,
    counts: countGroups(groups),
    issues,
    unorganized: input.errors,
    cardCount: input.cards.length,
  }
}
