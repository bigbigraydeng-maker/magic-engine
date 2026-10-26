import { supabaseAdmin } from '@/lib/supabase'
import type { TailorMadeBrochure } from './brochure-types'
import {
  buildQuoteRef,
  createBlankItinerary,
  type TailorMadeItinerary,
  type TailorMadeRecord,
  type TailorMadeStatus,
  type TailorMadeSummary,
} from './types'

/**
 * tailor_made_itineraries 表的读写。服务端专用（service_role）。
 *
 * ⚠️ 租户隔离靠代码，不靠 RLS：本表 RLS 只挡匿名，service_role 直接绕过。
 * 因此**每一个查询都必须带 client_id**，包括按 id 取单条 —— 否则 A 客户
 * 猜到 B 客户的行程 uuid 就能读到别人的报价单。调用方还须先过
 * requireDashboardClientAccess(clientId)。
 *
 * 建表 SQL：supabase/migrations/20260728115948_tailor_made_itineraries.sql
 */

const TABLE = 'tailor_made_itineraries'
const SUMMARY_COLUMNS =
  'id, client_id, quote_ref, end_client_name, trip_title, status, consultant_name, consultant_email, sent_at, created_at, updated_at'

export async function listItineraries(
  clientId: string,
  includeArchived = false,
): Promise<TailorMadeSummary[]> {
  let query = supabaseAdmin
    .from(TABLE)
    .select(SUMMARY_COLUMNS)
    .eq('client_id', clientId)
    .order('updated_at', { ascending: false })

  if (!includeArchived) query = query.neq('status', 'archived')

  const { data, error } = await query
  if (error) throw new Error(`读取行程单列表失败：${error.message}`)
  return (data ?? []) as unknown as TailorMadeSummary[]
}

export async function getItinerary(
  clientId: string,
  id: string,
): Promise<TailorMadeRecord | null> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('*')
    .eq('client_id', clientId)
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(`读取行程单失败：${error.message}`)
  return (data as TailorMadeRecord) ?? null
}

/**
 * 该客户当年的下一个报价编号。
 *
 * 取当年最大序号 +1。并发下有撞号可能，但 (client_id, quote_ref) 上有唯一约束
 * 会挡住，且实际只有个位数顾问在用 —— 不值得为此上一张序列表。
 */
export async function nextQuoteRef(clientId: string): Promise<string> {
  const year = new Date().getFullYear()
  const prefix = `CTS-${year}-`

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('quote_ref')
    .eq('client_id', clientId)
    .like('quote_ref', `${prefix}%`)
    .order('quote_ref', { ascending: false })
    .limit(1)

  if (error) throw new Error(`生成报价编号失败：${error.message}`)

  const last = data?.[0]?.quote_ref as string | undefined
  const lastSeq = last ? parseInt(last.slice(prefix.length), 10) : 0
  return buildQuoteRef(year, (Number.isFinite(lastSeq) ? lastSeq : 0) + 1)
}

/**
 * 新建。传 source 则以它为蓝本复制（tailor-made 大部分新单都是老单改出来的），
 * 但终端客户信息和报价号不继承 —— 复制过来的客户名发错人是最尴尬的事故。
 */
export async function createItinerary(
  clientId: string,
  source?: TailorMadeItinerary,
): Promise<TailorMadeRecord> {
  const quoteRef = await nextQuoteRef(clientId)

  const payload: TailorMadeItinerary = source
    ? {
        ...structuredClone(source),
        meta: { ...structuredClone(source.meta), quoteRef },
        client: { name: '', travellers: source.client.travellers },
      }
    : createBlankItinerary(quoteRef)

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .insert({
      client_id: clientId,
      quote_ref: quoteRef,
      end_client_name: payload.client.name,
      trip_title: payload.trip.title,
      status: 'draft' satisfies TailorMadeStatus,
      payload,
      consultant_name: payload.meta.consultant.name || null,
      consultant_email: payload.meta.consultant.email || null,
    })
    .select('*')
    .single()

  if (error) throw new Error(`新建行程单失败：${error.message}`)
  return data as TailorMadeRecord
}

/**
 * @param opts.expectedUpdatedAt 传了就是条件写：只在库里当前 updated_at 跟这个
 *   值一致时才真的落这次更新——单条 UPDATE 语句里的 `.eq('updated_at', ...)`，
 *   不是「先读再判断再写」，中间没有能被别的写入插进来的空隙。
 *
 *   给 import/extract 后台任务回存草稿这类场景用：任务跑的时候用户可能已经
 *   手动存过新版本，这时候条件不匹配、UPDATE 影响 0 行，返回 null——调用方
 *   把这当成「跳过，不是失败」处理，不能覆盖用户更新的内容。
 *
 * 不传这个 option 时行为不变：无条件更新，找不到行直接抛错（原来 .single()
 * 在 0 行时也是走这条路）。
 */
export async function saveItinerary(
  clientId: string,
  id: string,
  payload: TailorMadeItinerary,
  status?: TailorMadeStatus,
): Promise<TailorMadeRecord>
export async function saveItinerary(
  clientId: string,
  id: string,
  payload: TailorMadeItinerary,
  status: TailorMadeStatus | undefined,
  opts: { expectedUpdatedAt: string },
): Promise<TailorMadeRecord | null>
export async function saveItinerary(
  clientId: string,
  id: string,
  payload: TailorMadeItinerary,
  status?: TailorMadeStatus,
  opts?: { expectedUpdatedAt?: string },
): Promise<TailorMadeRecord | null> {
  const patch: Record<string, unknown> = {
    // 列表页字段跟着 payload 走，保持一致
    quote_ref: payload.meta.quoteRef,
    end_client_name: payload.client.name,
    trip_title: payload.trip.title,
    payload,
    consultant_name: payload.meta.consultant.name || null,
    consultant_email: payload.meta.consultant.email || null,
  }
  if (status) patch.status = status
  if (status === 'sent') patch.sent_at = new Date().toISOString()

  let query = supabaseAdmin.from(TABLE).update(patch).eq('client_id', clientId).eq('id', id)
  if (opts?.expectedUpdatedAt !== undefined) query = query.eq('updated_at', opts.expectedUpdatedAt)

  const { data, error } = await query.select('*')
  if (error) throw new Error(`保存行程单失败：${error.message}`)

  const record = (data?.[0] as TailorMadeRecord | undefined) ?? null
  if (!record && opts?.expectedUpdatedAt === undefined) {
    throw new Error('保存行程单失败：未找到对应行程单')
  }
  return record
}

/**
 * 保存画册。
 *
 * 画册与行程单是同一行上的两个 payload，分开写：顾问在画册标签页里改图改文案时，
 * 不该把行程单那一份也重写一遍 —— 两边同时打开时后写的会盖掉先写的。
 */
export async function saveBrochure(
  clientId: string,
  id: string,
  brochure: TailorMadeBrochure,
): Promise<TailorMadeRecord> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update({ brochure })
    .eq('client_id', clientId)
    .eq('id', id)
    .select('*')
    .single()

  if (error) throw new Error(`保存画册失败：${error.message}`)
  return data as TailorMadeRecord
}

/** 删除画册（保留行程单）。null 表示这份报价单没有画册。 */
export async function clearBrochure(clientId: string, id: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from(TABLE)
    .update({ brochure: null })
    .eq('client_id', clientId)
    .eq('id', id)

  if (error) throw new Error(`删除画册失败：${error.message}`)
}

export async function deleteItinerary(clientId: string, id: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from(TABLE)
    .delete()
    .eq('client_id', clientId)
    .eq('id', id)

  if (error) throw new Error(`删除行程单失败：${error.message}`)
}
