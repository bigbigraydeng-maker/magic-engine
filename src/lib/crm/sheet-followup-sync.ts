/**
 * 把 CTS 那张表格里「员工跟进记录」那一列，接进 CRM 的触点表。
 *
 * ## 为什么必须有这个（PM 2026-09-24 当面指出）
 *
 * CTS 的工作方式是：员工挨个打电话，打不通就在表格上留一句。这句话**从来没有
 * 进过 ME**。我们每天确实在读这张表（`conversions/cts-crm-sheet-sync-run`），
 * 但只取「谁成交了」那几列喂广告回传，跟进记录一个字都没落库。
 *
 * 后果是整套 CRM 对「有没有人跟过这个客人」的判断是错的。实测（2026-09-24）：
 * 系统认定「没人回」的 331 个人里，**224 个表格上白纸黑字写着跟进记录**
 * （voice message / wrong number / 明天五点回电…）。照这个名单去提醒，
 * 一半是噪音 —— 正是 2026-09-03 那封「客人来信没人回」被 PM 叫停的死法。
 *
 * 电话触点最后一次写入是 **2026-07-26**，而且是一次性导入（287 条）。
 * 之后两个月员工一直在打电话、一直在记，系统一条都没看见。
 *
 * ## 四条纪律
 *
 * 1. 🔴 **只认人，不建人。** 匹配不上既有联系人的行**跳过并计数**，绝不凭空
 *    建客户。这张表的行本来就是 Meta 表单线索，建人是 `crm/meta-lead` 的活
 *    （三孤岛方案的板桥红线：最大的翻车方式不是接不进来，是把干净表弄脏）。
 * 2. 🔴 **幂等靠 `source_ref`。** 键是 `<表格里的 lead id>|note`——按**行**不按人：
 *    同一个人填过两次表就是两行、两条记录，各自独立。按邮箱做键会让第二次
 *    留资的跟进记录盖掉第一次的，而「最近一次留资之后有没有人跟」正是
 *    `lead-followup-due` 的判据。
 * 3. 🔴 **不覆盖已有的。** 2026-07 那次一次性导入用的是 `<邮箱>|note` 这个旧键，
 *    而且带着 AI 解析出来的中文摘要。同一通电话不能既留旧行又插新行，所以
 *    插入前按「同一个人 + 同一句原话」再挡一道（`skippedAlreadyImported`）。
 *    代价：员工**改写**一条旧记录我们看不到（第一版写的那句为准）。
 *    对「有没有人跟过」这个判断无影响，先这样，别为它上版本历史。
 * 4. 🔴 **时间是近似的，必须标出来。** 表格不记「什么时候打的这通电话」，
 *    唯一真实的时间戳是这条线索的进线时间。所以 `occurred_at` 用进线时间 +
 *    `metadata.time_is_approximate = true`（跟 2026-07 那次导入同一个约定），
 *    **不编一个看起来更合理的时间**（铁律 8）。
 *
 * 跟进记录在 R 列还是 S 列由 `conversions/cts-crm-sheet-sync` 的
 * `ctsNoteColumnIndex` 判——全仓唯一那份判据，别在这里另写一套。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { readSheetValues } from '@/lib/google-sheets/client'
import { fetchAll } from '@/lib/supabase-paginate'
import { normaliseEmail, normalisePhone } from './identity'
import { classifyNote } from './note-parser'
import { ctsNoteColumnIndex } from '@/lib/conversions/cts-crm-sheet-sync'

/** 跟 2026-07 那次一次性导入同一个来源名 —— 它们是同一件事的两个阶段。 */
export const SHEET_FOLLOWUP_SOURCE = 'sheet_followup'

/**
 * 哪个客户有这么一张「员工跟进记录」表格。
 *
 * ⚠️ 这是 **client-specific 配置**，不是平台规则：目前只有 CTS 这么干。
 * 放在一个有名字的地方，好过散在编排层里。等第二个客户也要接，再考虑
 * 挪进 `clients` 表 + Settings UI（现在做那个是为一个客户建一套配置系统）。
 *
 * 表格 id 跟 `conversions/cts-crm-sheet-sync-run` 里那份是同一张表 —— 那条线
 * 读它取成交，这条线读它取跟进记录，各取所需，不互相依赖。
 */
export const CLIENT_FOLLOWUP_SHEETS: Readonly<Record<string, string>> = {
  // CTS Tours NZ
  'c0000000-0000-0000-0000-000000000000': '1vISaVkVkcQMSaR6Jo7xdmym6Ed5eE-q9025snYWYDVA',
}

/** 表格第一行是表头，数据从第 2 行开始。 */
const FIRST_DATA_ROW = 2

/** 员工把 Facebook 后台链接也粘在记录列里过 —— 那不是跟进记录。 */
function isNote(v: string): boolean {
  const t = v.trim()
  return t.length > 0 && !/^https?:\/\//i.test(t)
}

/** 表格里的一条「有人跟过」。 */
export interface SheetNote {
  /** 表格真实行号，用来判 R/S 列，也写进 metadata 方便回查 */
  sheetRow: number
  /** A 列，Meta 给的 lead id，形如 `l:168750…`。幂等键就用它 */
  leadId: string | null
  /** B 列进线时间，ISO；这是我们唯一有的真实时间戳 */
  createdTime: string | null
  email: string | null
  phoneRaw: string | null
  /** 员工写的原话，逐字保留 */
  note: string
}

/**
 * 从原始表格行里挑出「有跟进记录」的那些。纯函数。
 *
 * @param rawRows `Sheet1!A2:Z` 读回来的二维数组（下标 0 = 表格第 2 行）
 */
export function pickSheetNotes(rawRows: string[][]): SheetNote[] {
  const out: SheetNote[] = []
  rawRows.forEach((cells, i) => {
    const sheetRow = i + FIRST_DATA_ROW
    const raw = String(cells[ctsNoteColumnIndex(sheetRow)] ?? '')
    if (!isNote(raw)) return
    const at = (n: number) => {
      const v = String(cells[n] ?? '').trim()
      return v || null
    }
    out.push({
      sheetRow,
      leadId: at(0),
      createdTime: at(1),
      email: at(13),
      phoneRaw: at(15),
      note: raw.trim(),
    })
  })
  return out
}

/** 幂等键。按**行**不按人 —— 见文件头第 2 条。 */
export function sheetNoteSourceRef(n: SheetNote): string | null {
  if (n.leadId) return `${n.leadId}|note`
  // 没有 lead id 的行退回「邮箱 + 行号」，仍然一行一个键。
  const email = normaliseEmail(n.email)
  return email ? `${email}|row${n.sheetRow}|note` : null
}

export interface SheetFollowupSyncSummary {
  /** 表格总行数 */
  sheetRows: number
  /** 其中有跟进记录的行 */
  withNote: number
  /** 真的写进去了几条 */
  inserted: number
  /** 这个键已经写过了 */
  skippedExisting: number
  /** 2026-07 那次旧导入已经有同一句话了（见文件头第 3 条） */
  skippedAlreadyImported: number
  /** 电话邮箱都不成形，认不出是谁 */
  skippedNoIdentity: number
  /** 认得出联系方式，但库里没有这个人 —— 只认人不建人，如实计数 */
  skippedContactNotFound: number
  /** 逐条出错跳过的 */
  failed: number
  /** 预演：只算不写 */
  dryRun: boolean
  errors: string[]
}

interface IdentityRow {
  contact_id: string
  kind: string
  value: string
}

interface ExistingTouchRow {
  contact_id: string
  source_ref: string | null
  raw: string | null
}

function emptySummary(dryRun: boolean): SheetFollowupSyncSummary {
  return {
    sheetRows: 0, withNote: 0, inserted: 0,
    skippedExisting: 0, skippedAlreadyImported: 0,
    skippedNoIdentity: 0, skippedContactNotFound: 0,
    failed: 0, dryRun, errors: [],
  }
}

export interface SheetFollowupSyncOptions {
  clientId: string
  spreadsheetId: string
  /** 只算不写。上线前先跑这个看数字。 */
  dryRun?: boolean
  readSheet?: typeof readSheetValues
}

/**
 * 跑一趟同步。**永不抛异常** —— 这一趟失败不该把调用它的那条流水线带崩，
 * 失败原因原样进 `errors`，由调用方记进回执。
 */
export async function syncSheetFollowupNotes(
  supabase: SupabaseClient,
  opts: SheetFollowupSyncOptions,
): Promise<SheetFollowupSyncSummary> {
  const { clientId, spreadsheetId } = opts
  const dryRun = opts.dryRun === true
  const summary = emptySummary(dryRun)
  const readSheet = opts.readSheet ?? readSheetValues

  let rawRows: string[][]
  try {
    rawRows = await readSheet(clientId, spreadsheetId, 'Sheet1!A2:Z')
  } catch (err) {
    summary.errors.push(`读表格失败: ${err instanceof Error ? err.message : String(err)}`)
    return summary
  }
  summary.sheetRows = rawRows.length

  const notes = pickSheetNotes(rawRows)
  summary.withNote = notes.length
  if (notes.length === 0) return summary

  // 认人：一次把用得上的身份全捞进内存，不逐条查库。
  const wanted = new Set<string>()
  for (const n of notes) {
    const ph = normalisePhone(n.phoneRaw, 'NZ')
    const em = normaliseEmail(n.email)
    if (ph) wanted.add(ph)
    if (em) wanted.add(em)
  }
  let identities: IdentityRow[]
  let existing: ExistingTouchRow[]
  try {
    ;[identities, existing] = await Promise.all([
      fetchAll<IdentityRow>((from, to) =>
        supabase.from('contact_identities')
          .select('contact_id, kind, value')
          .eq('client_id', clientId)
          .order('id', { ascending: true })
          .range(from, to),
      ),
      fetchAll<ExistingTouchRow>((from, to) =>
        supabase.from('contact_touchpoints')
          .select('contact_id, source_ref, raw')
          .eq('client_id', clientId)
          .eq('source', SHEET_FOLLOWUP_SOURCE)
          .order('id', { ascending: true })
          .range(from, to),
      ),
    ])
  } catch (err) {
    summary.errors.push(`读库失败: ${err instanceof Error ? err.message : String(err)}`)
    return summary
  }

  const contactByValue = new Map<string, string>()
  for (const i of identities) contactByValue.set(i.value, i.contact_id)
  const seenRefs = new Set(existing.map((e) => e.source_ref).filter((v): v is string => !!v))
  // 「同一个人 + 同一句原话」已经在库里了 —— 挡住 2026-07 那次旧键导入的重复。
  const seenPersonNote = new Set(existing.map((e) => `${e.contact_id}::${(e.raw ?? '').trim()}`))

  for (const n of notes) {
    try {
      const sourceRef = sheetNoteSourceRef(n)
      const ph = normalisePhone(n.phoneRaw, 'NZ')
      const em = normaliseEmail(n.email)
      if (!sourceRef || (!ph && !em)) {
        summary.skippedNoIdentity++
        continue
      }
      if (seenRefs.has(sourceRef)) {
        summary.skippedExisting++
        continue
      }
      const contactId = (ph && contactByValue.get(ph)) || (em && contactByValue.get(em)) || null
      if (!contactId) {
        summary.skippedContactNotFound++
        continue
      }
      if (seenPersonNote.has(`${contactId}::${n.note}`)) {
        summary.skippedAlreadyImported++
        continue
      }

      const verdict = classifyNote(n.note)
      const occurredAt = n.createdTime && !Number.isNaN(Date.parse(n.createdTime))
        ? new Date(n.createdTime).toISOString()
        : null
      if (!occurredAt) {
        // 没有任何真实时间戳就不写 —— 编一个会污染「他等了多久」。
        summary.skippedNoIdentity++
        continue
      }

      if (dryRun) {
        summary.inserted++
        seenRefs.add(sourceRef)
        seenPersonNote.add(`${contactId}::${n.note}`)
        continue
      }

      const { error } = await supabase.from('contact_touchpoints').upsert(
        {
          client_id: clientId,
          contact_id: contactId,
          channel: 'phone',
          direction: 'outbound',
          occurred_at: occurredAt,
          raw: n.note,
          source: SHEET_FOLLOWUP_SOURCE,
          source_ref: sourceRef,
          metadata: {
            outcome: verdict.outcome,
            do_not_contact: verdict.do_not_contact,
            imported_from: 'sheet_员工跟进记录',
            sheet_row: n.sheetRow,
            // 🔴 表格不记打电话的时间，这里用的是进线时间。见文件头第 4 条。
            time_is_approximate: true,
            timestamp_basis: 'lead_created_time',
          },
        },
        { onConflict: 'client_id,source,source_ref', ignoreDuplicates: true },
      )
      if (error) {
        summary.failed++
        summary.errors.push(`第 ${n.sheetRow} 行写入失败: ${error.message}`)
        continue
      }
      summary.inserted++
      seenRefs.add(sourceRef)
      seenPersonNote.add(`${contactId}::${n.note}`)
    } catch (err) {
      summary.failed++
      summary.errors.push(`第 ${n.sheetRow} 行整体失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return summary
}
