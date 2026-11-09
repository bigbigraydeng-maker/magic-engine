import type { PlayKey } from '../play-vocabulary'
import type { Basis } from './types'

export type ReadState<T> =
  | { state: 'ok'; value: T }
  | { state: 'empty' }
  | { state: 'failed'; reason: string }

export interface EligibilityInput {
  play: PlayKey
  pageId: string | null
  pageToken: ReadState<true>
  scopes: ReadState<string[]>
  forms: ReadState<{ id: string; active: boolean }[]>
  accountStatus: number | null
  currencyKnown: boolean
  promotePages: ReadState<string[]>
  tokenSource: string | null
  accountId: string
}

const SNAPSHOT_SOURCE = '广告快照与 Meta 只读检查'
const CUSTOMER_SOURCE = '客户设置'
// 来源：发布 lead-form（即时表单）广告需要的 Meta 权限；这里不另列别的权限清单。
const REQUIRED_SCOPES = ['leads_retrieval', 'pages_manage_ads']

interface Collector {
  reasons: string[]
  basis: Basis[]
  notes: string[]
}

function addBasis(c: Collector, label: string, value: string, source: string): void {
  c.basis.push({ label, value, source, as_of: null })
}

function checkPage(i: EligibilityInput, c: Collector): void {
  const pageId = i.pageId
  if (pageId === null || pageId === '') {
    c.reasons.push('客户没配主页')
    return
  }
  if (i.pageToken.state !== 'ok') {
    const suffix = i.pageToken.state === 'failed' ? `（${i.pageToken.reason}）` : ''
    c.reasons.push(`拿不到这个主页的访问令牌${suffix}`)
  }
}

function checkScopes(i: EligibilityInput, c: Collector): void {
  const scopes = i.scopes
  if (scopes.state === 'failed') {
    c.reasons.push('读不到令牌权限')
    return
  }
  if (scopes.state === 'empty') {
    c.reasons.push('令牌权限读到 0 项，缺少 leads_retrieval、pages_manage_ads')
    return
  }
  const missing = REQUIRED_SCOPES.filter((s) => !scopes.value.includes(s))
  if (missing.length > 0) {
    c.reasons.push(`令牌缺少权限：${missing.join('、')}`)
  }
  addBasis(c, '令牌权限', scopes.value.join(','), SNAPSHOT_SOURCE)
}

function checkForms(i: EligibilityInput, c: Collector): void {
  const forms = i.forms
  if (forms.state === 'failed') {
    c.reasons.push('读不到表单列表')
    return
  }
  if (forms.state === 'empty') {
    c.reasons.push('读到 0 个表单——也可能是这个令牌看不到')
    return
  }
  const activeCount = forms.value.filter((f) => f.active === true).length
  if (activeCount === 0) {
    c.reasons.push('读到的表单都已停用')
    return
  }
  addBasis(c, '即时表单', `${activeCount} 个在用 / 共 ${forms.value.length} 个`, SNAPSHOT_SOURCE)
}

function checkLeadFormHarvest(i: EligibilityInput, c: Collector): void {
  if (i.play !== 'lead_form_harvest') return
  checkScopes(i, c)
  checkForms(i, c)
}

function checkAccountStatus(i: EligibilityInput, c: Collector): void {
  if (i.accountStatus === null) {
    c.reasons.push('读不到账户状态（没有快照）')
    return
  }
  if (i.accountStatus !== 1) {
    c.reasons.push(`账户状态码是 ${i.accountStatus}，不是 1（可投放）`)
    return
  }
  addBasis(c, '账户状态', '1（可投放）', SNAPSHOT_SOURCE)
}

function checkCurrency(i: EligibilityInput, c: Collector): void {
  if (i.currencyKnown === false) {
    c.reasons.push('读不到账户币种')
  }
}

function describePromotePages(i: EligibilityInput): string {
  const pp = i.promotePages
  if (pp.state === 'ok') {
    const contains = i.pageId !== null && i.pageId !== '' && pp.value.includes(i.pageId)
    return `读到 ${pp.value.length} 个${contains ? '，含该主页' : '，不含该主页'}`
  }
  if (pp.state === 'empty') return '读到 0 个'
  return `读不到（${pp.reason}）`
}

function recordPromotePages(i: EligibilityInput, c: Collector): void {
  const description = describePromotePages(i)
  addBasis(c, '可推广主页（仅供参考）', description, SNAPSHOT_SOURCE)
  const source = i.tokenSource ?? '未知'
  c.notes.push(
    `用的是「${source}」这把令牌读可推广主页：${description}（只作参考，不影响是否合格）`,
  )
}

function recordTokenAndAccount(i: EligibilityInput, c: Collector): void {
  addBasis(c, '令牌来源', `令牌来源=${i.tokenSource ?? '未知'}`, SNAPSHOT_SOURCE)
  addBasis(c, '广告账户', i.accountId, SNAPSHOT_SOURCE)
}

export function judgeEligibility(i: EligibilityInput): {
  eligible: boolean
  why_empty?: string
  basis: Basis[]
  notes: string[]
} {
  const c: Collector = { reasons: [], basis: [], notes: [] }

  checkPage(i, c)
  checkLeadFormHarvest(i, c)
  checkAccountStatus(i, c)
  checkCurrency(i, c)
  recordPromotePages(i, c)
  recordTokenAndAccount(i, c)

  const eligible = c.reasons.length === 0
  const result: {
    eligible: boolean
    why_empty?: string
    basis: Basis[]
    notes: string[]
  } = { eligible, basis: c.basis, notes: c.notes }
  if (!eligible) result.why_empty = c.reasons.join('；')
  return result
}
