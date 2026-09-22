/**
 * CTS 人工维护的 Google Sheet（FB 即时表单留资记录）→ me_sale_outcomes 分类逻辑。
 *
 * L4 客户配置：列位置、阶段判断、黑名单词、这张表自己的格式怪癖（`p:` 前缀）
 * 全部封在这一个文件里，不进 `src/lib/google-sheets/`（那是通用连接器，不该
 * 认识"阶段Stage在哪一列"这种 CTS 专属事实）。
 *
 * 实测过的真实表结构（2026-09-13，跟最初任务描述的列字母有出入，以这里为准）：
 *
 *   Sheet1（Facebook 即时表单原始导出，真正的时间戳和最新备注在这里）
 *     B  created_time      FB 表单提交时间（ISO8601 带时区）
 *     N  email
 *     O  full_name
 *     P  phone_number      格式 `p:+64...`
 *     R  员工跟进记录       自由文本
 *
 *   CRM管理（人工维护的跟踪视图，阶段判断在这里；N 列是 Sheet1!R 某次的静态
 *            拷贝、不是实时公式，所以黑名单词检查优先读 Sheet1，不读这里）
 *     A  进线日期           只有日期，没有时间
 *     C  电话               同样 `p:+64...` 格式
 *     E  兴趣Tour           不是最初说的 F 列；常见占位符"❓还在犹豫-看全部"不是真团名
 *     G  阶段Stage          '4-已订金' / '5-已出行归来' 才算成交；实测 1599 行只有 1 行填了
 *     H  阶段更新日          实测 100% 空白，没有可用的成交日期
 *
 * 两个 tab 没有共享的稳定行 ID，靠电话号码关联（两边格式一致）。
 */

import { normalisePhone, normaliseEmail } from '@/lib/crm/identity'

// ── 原始行 ──────────────────────────────────────────────────────────────────

export interface Sheet1LeadRow {
  createdTime: string | null
  email: string | null
  fullName: string | null
  phoneRaw: string | null
  followUpNotes: string | null
}

export interface CrmManagementRow {
  entryDate: string | null
  name: string | null
  phoneRaw: string | null
  email: string | null
  tourInterest: string | null
  stage: string | null
  /** H 列。实测 2026-09-13 全表 100% 空白，但列本身是真实存在的，留着以防以后有人开始填。 */
  stageUpdatedDate: string | null
}

/** Sheet1 实测列下标（0-based）：B=1, N=13, O=14, P=15, R=17。 */
export function parseSheet1Row(cells: string[]): Sheet1LeadRow {
  const at = (i: number) => (cells[i]?.trim() ? cells[i].trim() : null)
  return {
    createdTime: at(1),
    email: at(13),
    fullName: at(14),
    phoneRaw: at(15),
    followUpNotes: at(17),
  }
}

/** CRM管理 实测列下标（0-based）：A=0, B=1, C=2, D=3, E=4, G=6, H=7。 */
export function parseCrmManagementRow(cells: string[]): CrmManagementRow {
  const at = (i: number) => (cells[i]?.trim() ? cells[i].trim() : null)
  return {
    entryDate: at(0),
    name: at(1),
    phoneRaw: at(2),
    email: at(3),
    tourInterest: at(4),
    stage: at(6),
    stageUpdatedDate: at(7),
  }
}

// ── 清洗 ────────────────────────────────────────────────────────────────────

/**
 * 这张表的电话格式清洗——复用 `crm/identity.ts` 里已经为同一个数据源（Meta 即时
 * 表单）写好的 `normalisePhone`：它本来就认识 `p:` 前缀、本地格式、00 国际前缀
 * 这几种脏写法。不在这里另起一套。
 *
 * 只有解析结果是 `+64` 开头才算"人在新西兰"（PM 的合格线索判据 1）。
 */
export function ctsPhoneE164(raw: string | null): string | null {
  const e164 = normalisePhone(raw, 'NZ')
  return e164 && e164.startsWith('+64') ? e164 : null
}

/** 团名占位符——不是真团，成交金额查价时要跳过，别拿它去查官网价格。 */
const TOUR_PLACEHOLDER_VALUES = new Set(['❓还在犹豫-看全部', '未确定', ''])

export function isRealTourName(tourInterest: string | null): tourInterest is string {
  return !!tourInterest && !TOUR_PLACEHOLDER_VALUES.has(tourInterest.trim())
}

/** PM 拍板的两条排除词，大小写不敏感子串匹配。 */
const EXCLUDE_NOTE_PATTERNS = [/wrong number/i, /not interested/i]

export function notesExcludeLead(notes: string | null): boolean {
  if (!notes) return false
  return EXCLUDE_NOTE_PATTERNS.some((re) => re.test(notes))
}

/**
 * CRM管理 的日期列是 `DD/MM/YYYY`（AU/NZ 惯例，实测样例 `14/06/2026`）。
 *
 * 🔴 不能扔给 `new Date(str)` 直接解析——JS 对 "14/06/2026" 这种格式按
 * MM/DD/YYYY 理解（月份 14 不存在，日 >12 的会解析成 Invalid Date；日 ≤12
 * 的会把月和日读反，静默生成一个错的日期，没有任何报错）。显式按 DD/MM/YYYY
 * 拆开更安全。
 */
export function parseNzDdMmYyyy(raw: string): Date | null {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return null
  const [, dd, mm, yyyy] = m
  const day = Number(dd)
  const month = Number(mm)
  const year = Number(yyyy)
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const date = new Date(Date.UTC(year, month - 1, day, 12))
  // UTC 构造器对超出当月天数的日子（如 31/04）会自动进位到下个月——那不是
  // "看不懂"，是"没有这一天"，必须挡住，否则会把错误日期悄悄当成合法值发出去。
  if (date.getUTCMonth() !== month - 1) return null
  return date
}

/**
 * Google Sheets 对没被设成"纯文本"格式的日期单元格，`UNFORMATTED_VALUE` 读出来
 * 是一个数字（从 1899-12-30 起的天数），不是字符串——这张表新旧行格式不统一：
 * 老行是人手打的 "DD/MM/YYYY" 文本，2026-09 起新增的行是原生日期格式。**实测
 * 发现**（不是猜的）：2026-09-12/13 那几行的"进线日期"读出来是 `46276`/`46277`
 * 这样的数字，换算正是 2026-09-12/13——用文本正则解析会判定"看不懂"，把当天
 * 最新的咨询全部漏掉，而这些恰恰是唯一还落在 Meta 7 天窗口内、真正有用的记录。
 */
export function parseSheetsSerialDate(raw: string): Date | null {
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const serial = Number(trimmed)
  if (!Number.isFinite(serial) || serial <= 0) return null
  const utcDays = Math.floor(serial - 25569) // 1899-12-30 → 1970-01-01 的天数差
  const date = new Date(utcDays * 86_400_000)
  return Number.isNaN(date.getTime()) ? null : date
}

/** 两种日期格式都要认：老行的 "DD/MM/YYYY" 文本，新行的 Sheets 原生日期序列号。 */
export function parseSheetDateCell(raw: string): Date | null {
  return parseNzDdMmYyyy(raw) ?? parseSheetsSerialDate(raw)
}

/** '4-已订金' / '5-已出行归来' → 算成交；其余（含空白）都不算。 */
export function stageIsPurchase(stage: string | null): boolean {
  if (!stage) return false
  const trimmed = stage.trim()
  return trimmed.startsWith('4') || trimmed.startsWith('5')
}

// ── 分类结果 ────────────────────────────────────────────────────────────────

export interface QualifiedLead {
  kind: 'qualified_lead'
  phoneE164: string
  email: string | null
  fullName: string | null
  /** ISO8601。优先 Sheet1 的精确提交时间，其次 CRM管理 的进线日期（补中午）。 */
  occurredAt: string
  /** true = 用的是"进线日期"顶的（只有日期没有时间），不是 FB 的精确提交时间。 */
  occurredAtIsDateOnly: boolean
}

export interface PurchaseMissingDate {
  kind: 'purchase_missing_date'
  phoneE164: string
  tourInterest: string | null
  /** 人话原因，直接进人工任务队列的 what 字段。 */
  reason: string
}

export interface PurchaseCandidate {
  kind: 'purchase_candidate'
  phoneE164: string
  email: string | null
  fullName: string | null
  tourInterest: string
  occurredAt: string
}

export interface ExcludedRow {
  kind: 'excluded'
  reason: 'no_qualifying_phone' | 'excluded_by_notes' | 'no_usable_date'
}

export type ClassifiedRow = QualifiedLead | PurchaseMissingDate | PurchaseCandidate | ExcludedRow

/**
 * 一个人的分类——按 CRM管理 的电话找到对应的 Sheet1 行（可能找不到），
 * 阶段优先于黑名单词判断（PM 规则：阶段=4/5 先算成交，不受合格线索那两条约束）。
 */
export function classifyCtsCrmPerson(
  crmRow: CrmManagementRow,
  matchedSheet1Row: Sheet1LeadRow | null,
): ClassifiedRow {
  const phoneE164 = ctsPhoneE164(crmRow.phoneRaw) ?? ctsPhoneE164(matchedSheet1Row?.phoneRaw ?? null)

  // 员工跟进记录优先读 Sheet1（实时），CRM管理!N 是某次的静态拷贝，会滞后。
  const notes = matchedSheet1Row?.followUpNotes ?? null

  if (stageIsPurchase(crmRow.stage)) {
    if (!phoneE164) {
      return { kind: 'excluded', reason: 'no_qualifying_phone' }
    }
    if (!isRealTourName(crmRow.tourInterest)) {
      return {
        kind: 'purchase_missing_date',
        phoneE164,
        tourInterest: crmRow.tourInterest,
        reason: '阶段标了已订金/已出行，但兴趣Tour是占位符或空白，查不出是哪个团、也就查不出价格',
      }
    }
    // 🔴 阶段更新日实测 100% 空白，没有真实成交日期时不拿"进线日期"顶替——
    //    那是首次联系日，不是到账日，编一个日期发给 Meta 等于告诉它错误的事件
    //    时间。宁可搁置成人工任务，等人补真实日期。这一列一旦以后有人开始填，
    //    这里会自动开始正常出成交记录，不用改代码。
    if (!crmRow.stageUpdatedDate) {
      return {
        kind: 'purchase_missing_date',
        phoneE164,
        tourInterest: crmRow.tourInterest,
        reason: '阶段标了已订金/已出行，但表格里"阶段更新日"是空的，没有真实成交日期，需要人工补一个',
      }
    }
    const stageDate = parseSheetDateCell(crmRow.stageUpdatedDate)
    if (!stageDate) {
      return {
        kind: 'purchase_missing_date',
        phoneE164,
        tourInterest: crmRow.tourInterest,
        reason: `"阶段更新日"里的值看不懂（${crmRow.stageUpdatedDate}），需要人工核实`,
      }
    }
    return {
      kind: 'purchase_candidate',
      phoneE164,
      email: normaliseEmail(matchedSheet1Row?.email ?? crmRow.email),
      fullName: matchedSheet1Row?.fullName ?? crmRow.name,
      tourInterest: crmRow.tourInterest,
      occurredAt: stageDate.toISOString(),
    }
  }

  if (!phoneE164) {
    return { kind: 'excluded', reason: 'no_qualifying_phone' }
  }
  if (notesExcludeLead(notes)) {
    return { kind: 'excluded', reason: 'excluded_by_notes' }
  }

  const email = normaliseEmail(matchedSheet1Row?.email ?? crmRow.email)
  const fullName = matchedSheet1Row?.fullName ?? crmRow.name

  if (matchedSheet1Row?.createdTime) {
    return {
      kind: 'qualified_lead',
      phoneE164,
      email,
      fullName,
      occurredAt: new Date(matchedSheet1Row.createdTime).toISOString(),
      occurredAtIsDateOnly: false,
    }
  }
  if (crmRow.entryDate) {
    const parsed = parseSheetDateCell(crmRow.entryDate)
    if (parsed) {
      return {
        kind: 'qualified_lead',
        phoneE164,
        email,
        fullName,
        occurredAt: parsed.toISOString(),
        occurredAtIsDateOnly: true,
      }
    }
  }
  // 两边都没有可用日期——极少见（entryDate 实测 100% 有值），保守起见排除掉，
  // 不猜一个"现在"当作发生时间。
  return { kind: 'excluded', reason: 'no_usable_date' }
}

/** 幂等键——见文件顶注释；lead 不带团名（同一个人算一次有效咨询），purchase 带团名（不同团各算一次）。 */
export function ctsSourceRef(phoneE164: string, outcomeKind: 'lead' | 'purchase', tourInterest?: string): string {
  const suffix = outcomeKind === 'purchase' ? `purchase:${tourInterest ?? ''}` : 'lead'
  return `${phoneE164}:${suffix}`
}
