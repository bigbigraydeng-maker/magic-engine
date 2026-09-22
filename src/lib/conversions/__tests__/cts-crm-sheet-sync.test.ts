import { describe, it, expect } from 'vitest'
import {
  ctsPhoneE164,
  isRealTourName,
  notesExcludeLead,
  stageIsPurchase,
  classifyCtsCrmPerson,
  ctsSourceRef,
  parseSheet1Row,
  parseCrmManagementRow,
  parseNzDdMmYyyy,
  parseSheetsSerialDate,
  parseSheetDateCell,
  type CrmManagementRow,
  type Sheet1LeadRow,
} from '../cts-crm-sheet-sync'

function crmRow(overrides: Partial<CrmManagementRow> = {}): CrmManagementRow {
  return {
    entryDate: '14/06/2026',
    name: 'Jane Doe',
    phoneRaw: 'p:+6421363598',
    email: null,
    tourInterest: 'Best of China 15D',
    stage: null,
    stageUpdatedDate: null,
    ...overrides,
  }
}

function sheet1Row(overrides: Partial<Sheet1LeadRow> = {}): Sheet1LeadRow {
  return {
    createdTime: '2026-06-14T02:39:49-05:00',
    email: 'jane@example.com',
    fullName: 'Jane Doe',
    phoneRaw: 'p:+6421363598',
    followUpNotes: null,
    ...overrides,
  }
}

describe('ctsPhoneE164', () => {
  it('strips the CTS sheet p: prefix and accepts a NZ number', () => {
    expect(ctsPhoneE164('p:+6421363598')).toBe('+6421363598')
  })
  it('rejects non-NZ international numbers', () => {
    expect(ctsPhoneE164('p:+61412345678')).toBeNull()
  })
  it('returns null for empty/garbage values', () => {
    expect(ctsPhoneE164('')).toBeNull()
    expect(ctsPhoneE164('\\')).toBeNull()
    expect(ctsPhoneE164(null)).toBeNull()
  })
})

describe('isRealTourName', () => {
  it('rejects the known placeholder and blank values', () => {
    expect(isRealTourName('❓还在犹豫-看全部')).toBe(false)
    expect(isRealTourName('未确定')).toBe(false)
    expect(isRealTourName('')).toBe(false)
    expect(isRealTourName(null)).toBe(false)
  })
  it('accepts a real tour name', () => {
    expect(isRealTourName('Best of China 15D')).toBe(true)
  })
})

describe('notesExcludeLead', () => {
  it('matches case-insensitively as a substring', () => {
    expect(notesExcludeLead('Wrong Number, do not call again')).toBe(true)
    expect(notesExcludeLead('customer said NOT INTERESTED right now')).toBe(true)
  })
  it('does not exclude ordinary notes', () => {
    expect(notesExcludeLead('voice mail left, will retry tomorrow')).toBe(false)
    expect(notesExcludeLead(null)).toBe(false)
  })
})

describe('stageIsPurchase', () => {
  it('accepts stage 4 and 5 by prefix', () => {
    expect(stageIsPurchase('4-已订金')).toBe(true)
    expect(stageIsPurchase('5-已出行归来')).toBe(true)
  })
  it('rejects other stages and blank', () => {
    expect(stageIsPurchase('1-新Lead待首联')).toBe(false)
    expect(stageIsPurchase('')).toBe(false)
    expect(stageIsPurchase(null)).toBe(false)
  })
})

describe('classifyCtsCrmPerson — lead path', () => {
  it('prefers Sheet1 created_time as occurredAt when a match exists', () => {
    const result = classifyCtsCrmPerson(crmRow(), sheet1Row())
    expect(result.kind).toBe('qualified_lead')
    if (result.kind === 'qualified_lead') {
      expect(result.occurredAt).toBe(new Date('2026-06-14T02:39:49-05:00').toISOString())
      expect(result.occurredAtIsDateOnly).toBe(false)
    }
  })

  it('falls back to CRM管理 entryDate when there is no Sheet1 match', () => {
    const result = classifyCtsCrmPerson(crmRow(), null)
    expect(result.kind).toBe('qualified_lead')
    if (result.kind === 'qualified_lead') {
      expect(result.occurredAtIsDateOnly).toBe(true)
      // entryDate '14/06/2026' 是 DD/MM/YYYY —— 14 号，不是 6 月的第 14 天误读成别的。
      expect(result.occurredAt.startsWith('2026-06-14')).toBe(true)
    }
  })

  it('still classifies as a qualified lead when entryDate is a Sheets native-date serial number (2026-09 regression)', () => {
    // 实测：2026-09-12 起新增的行，entryDate 读出来是 '46277' 而不是 'DD/MM/YYYY' 文本。
    // 这条曾经会落进下面的"两边都没有可用日期"分支，把当天最新的咨询错判成 excluded。
    const result = classifyCtsCrmPerson(crmRow({ entryDate: '46277' }), null)
    expect(result.kind).toBe('qualified_lead')
    if (result.kind === 'qualified_lead') {
      expect(result.occurredAt.startsWith('2026-09-12')).toBe(true)
    }
  })

  it('excludes on notes read from Sheet1 (the live source), not the stale CRM管理 copy', () => {
    // CRM管理!N 拷贝里还是干净的备注（滞后），但 Sheet1!R 已经被标了 wrong number。
    const result = classifyCtsCrmPerson(
      crmRow(),
      sheet1Row({ followUpNotes: 'wrong number' }),
    )
    expect(result).toEqual({ kind: 'excluded', reason: 'excluded_by_notes' })
  })

  it('excludes when phone does not qualify (not +64)', () => {
    const result = classifyCtsCrmPerson(
      crmRow({ phoneRaw: 'p:+61412345678' }),
      sheet1Row({ phoneRaw: 'p:+61412345678' }),
    )
    expect(result).toEqual({ kind: 'excluded', reason: 'no_qualifying_phone' })
  })
})

describe('classifyCtsCrmPerson — purchase path', () => {
  it('takes priority over the lead exclusion rules (stage wins even with bad notes)', () => {
    const result = classifyCtsCrmPerson(
      crmRow({ stage: '4-已订金', stageUpdatedDate: '01/07/2026' }),
      sheet1Row({ followUpNotes: 'wrong number' }),
    )
    expect(result.kind).toBe('purchase_candidate')
  })

  it('holds for manual review when stageUpdatedDate is blank (the real-world default today)', () => {
    const result = classifyCtsCrmPerson(crmRow({ stage: '4-已订金' }), sheet1Row())
    expect(result.kind).toBe('purchase_missing_date')
  })

  it('holds for manual review when the tour is a placeholder (no product to price)', () => {
    const result = classifyCtsCrmPerson(
      crmRow({ stage: '5-已出行归来', stageUpdatedDate: '01/07/2026', tourInterest: '❓还在犹豫-看全部' }),
      sheet1Row(),
    )
    expect(result.kind).toBe('purchase_missing_date')
  })

  it('resolves a real occurredAt once stageUpdatedDate is present', () => {
    const result = classifyCtsCrmPerson(
      crmRow({ stage: '4-已订金', stageUpdatedDate: '01/07/2026' }),
      sheet1Row(),
    )
    expect(result.kind).toBe('purchase_candidate')
    if (result.kind === 'purchase_candidate') {
      // stageUpdatedDate '01/07/2026' 是 DD/MM/YYYY —— 7 月 1 号。
      expect(result.occurredAt.startsWith('2026-07-01')).toBe(true)
      expect(result.tourInterest).toBe('Best of China 15D')
    }
  })

  it('resolves occurredAt when stageUpdatedDate is a Sheets native-date serial number (2026-09 regression)', () => {
    const result = classifyCtsCrmPerson(
      crmRow({ stage: '4-已订金', stageUpdatedDate: '46277' }),
      sheet1Row(),
    )
    expect(result.kind).toBe('purchase_candidate')
    if (result.kind === 'purchase_candidate') {
      expect(result.occurredAt.startsWith('2026-09-12')).toBe(true)
    }
  })

  it('holds for manual review when stageUpdatedDate is unparseable garbage', () => {
    const result = classifyCtsCrmPerson(
      crmRow({ stage: '4-已订金', stageUpdatedDate: 'sometime in July' }),
      sheet1Row(),
    )
    expect(result.kind).toBe('purchase_missing_date')
  })
})

describe('parseNzDdMmYyyy', () => {
  it('reads DD/MM/YYYY, not MM/DD/YYYY — day 14 must not be misread as a month', async () => {
    const d = parseNzDdMmYyyy('14/06/2026')
    expect(d?.getUTCFullYear()).toBe(2026)
    expect(d?.getUTCMonth()).toBe(5) // June, 0-indexed
    expect(d?.getUTCDate()).toBe(14)
  })

  it('rejects a day that does not exist in that month instead of silently rolling over', async () => {
    expect(parseNzDdMmYyyy('31/04/2026')).toBeNull() // April has 30 days
  })

  it('rejects garbage and out-of-range values', async () => {
    expect(parseNzDdMmYyyy('sometime in July')).toBeNull()
    expect(parseNzDdMmYyyy('32/01/2026')).toBeNull()
    expect(parseNzDdMmYyyy('01/13/2026')).toBeNull()
  })
})

describe('parseSheetsSerialDate — Google Sheets native date cells', () => {
  it('converts a real serial value found in production (2026-09-12/13 rows) correctly', () => {
    // 实测：CRM管理 表 2026-09-12 新增的行，"进线日期" UNFORMATTED_VALUE 读出来是这个数字。
    const d = parseSheetsSerialDate('46277')
    expect(d?.toISOString().slice(0, 10)).toBe('2026-09-12')
  })

  it('rejects non-numeric strings (falls through to the DD/MM/YYYY parser instead)', () => {
    expect(parseSheetsSerialDate('14/06/2026')).toBeNull()
    expect(parseSheetsSerialDate('sometime in July')).toBeNull()
  })

  it('rejects zero and negative values', () => {
    expect(parseSheetsSerialDate('0')).toBeNull()
    expect(parseSheetsSerialDate('-5')).toBeNull()
  })
})

describe('parseSheetDateCell — accepts either format the sheet actually uses', () => {
  it('parses old text-format rows', () => {
    expect(parseSheetDateCell('14/06/2026')?.toISOString().slice(0, 10)).toBe('2026-06-14')
  })

  it('parses new native-date rows (the 2026-09 regression this was written to catch)', () => {
    expect(parseSheetDateCell('46277')?.toISOString().slice(0, 10)).toBe('2026-09-12')
  })

  it('returns null for neither format', () => {
    expect(parseSheetDateCell('sometime in July')).toBeNull()
  })
})

describe('ctsSourceRef — idempotency key', () => {
  it('lead key has no tour suffix (one qualified-lead fact per person)', () => {
    expect(ctsSourceRef('+6421363598', 'lead')).toBe('+6421363598:lead')
  })

  it('purchase key includes the tour so a second purchase of a different tour is not swallowed', () => {
    const key1 = ctsSourceRef('+6421363598', 'purchase', 'Best of China 15D')
    const key2 = ctsSourceRef('+6421363598', 'purchase', 'Silk Road 18D')
    expect(key1).not.toBe(key2)
  })
})

describe('parseSheet1Row / parseCrmManagementRow — real column layout', () => {
  it('reads Sheet1 columns B/N/O/P/R by index', () => {
    const cells = new Array(20).fill('')
    cells[1] = '2026-06-14T02:39:49-05:00' // B created_time
    cells[13] = 'jane@example.com' // N email
    cells[14] = 'Jane Doe' // O full_name
    cells[15] = 'p:+6421363598' // P phone_number
    cells[17] = 'voice mail' // R 员工跟进记录
    expect(parseSheet1Row(cells)).toEqual({
      createdTime: '2026-06-14T02:39:49-05:00',
      email: 'jane@example.com',
      fullName: 'Jane Doe',
      phoneRaw: 'p:+6421363598',
      followUpNotes: 'voice mail',
    })
  })

  it('reads CRM管理 columns A/B/C/D/E/G/H by index', () => {
    const cells = new Array(19).fill('')
    cells[0] = '14/06/2026' // A 进线日期
    cells[1] = 'Jane Doe' // B 姓名
    cells[2] = 'p:+6421363598' // C 电话
    cells[3] = 'jane@example.com' // D Email
    cells[4] = 'Best of China 15D' // E 兴趣Tour
    cells[6] = '4-已订金' // G 阶段Stage
    cells[7] = '15/07/2026' // H 阶段更新日
    expect(parseCrmManagementRow(cells)).toEqual({
      entryDate: '14/06/2026',
      name: 'Jane Doe',
      phoneRaw: 'p:+6421363598',
      email: 'jane@example.com',
      tourInterest: 'Best of China 15D',
      stage: '4-已订金',
      stageUpdatedDate: '15/07/2026',
    })
  })
})
