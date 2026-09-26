/**
 * WP3 R5 —— 「全部客人」页 view=priority 的纯装配函数。
 *
 * 输入：已经从库里取出来的 contacts / touchpoints / stage 配置 + 现在几点。
 * 输出：4 段 SectionResult + focus 命中信息。
 *
 * 不写 SQL、不调 supabase：调用方（路由）负责按 clientId + stage + q 过滤后
 * 喂进来。这样 (1) SQL 层的筛选跟 view=priority 无关，路由可以直接沿用已有
 * SELECT 逻辑；(2) 单元测试用假 row 就能跑，不用装 supabase 假件。
 *
 * BLOCKER-1（子牙+魏征三方设计审）：本函数只处理**筛选后**的子集。owner/
 * work_state/stage/q 这类筛选走 SQL；本函数不判「总人数是不是过大」，只处理
 * 拿到的这批。上层如果没做筛选、直接把 3000 人塞进来，也照跑，但慢——那是
 * 上层的策略问题，不是本函数的边界。
 *
 * 计算流水：contact-model 装形状 → segmentContact 打段 → list-sections 分桶。
 */

import { buildContactModel, type ContactRowLike, type StageMetaLike, type TouchpointRowLike } from './contact-model'
import { segmentContact } from './segments'
import {
  buildSections,
  type BuildOptions,
  type FocusResult,
  type RankedContact,
  type SectionKey,
  type SectionResult,
} from './list-sections'

export interface PriorityViewInput {
  contacts: ContactRowLike[]
  /** 混着不同 contact_id 的行；buildContactModel 内部按 contact_id 分桶。 */
  touchpoints: TouchpointRowLike[]
  stageMeta: Map<string, StageMetaLike>
  now: Date
  /** 段展开、翻页、focus。默认前两段展开、其余收起（见 list-sections）。 */
  perPage?: number
  open?: Partial<Record<SectionKey, boolean>>
  page?: Partial<Record<SectionKey, number>>
  focusContactId?: string
}

export interface PriorityViewOutput<T> {
  sections: SectionResult<T>[]
  focus: FocusResult
}

/**
 * @param extractRow 把（RankedContact + 原始行 + segmentContact 结果）折成响应行。
 * 由调用方定义响应形状——这一层不锁死。
 */
export function buildPriorityView<T>(
  input: PriorityViewInput,
  extractRow: (row: ContactRowLike, ranked: RankedContact) => T,
): PriorityViewOutput<T> {
  // 触点先按 contact_id 分桶，避免 buildContactModel 在每一个人身上重扫全量。
  const byContact = new Map<string, TouchpointRowLike[]>()
  for (const t of input.touchpoints) {
    const list = byContact.get(t.contact_id) ?? []
    list.push(t)
    byContact.set(t.contact_id, list)
  }

  // contactId → row + ranked，方便 buildSections 的 getRow 回读原始行。
  const byId = new Map<string, ContactRowLike>()
  const ranked: RankedContact[] = []
  for (const c of input.contacts) {
    byId.set(c.id, c)
    const tps = byContact.get(c.id) ?? []
    const model = buildContactModel(c, tps, input.stageMeta)
    const seg = segmentContact(model, input.now)
    ranked.push({
      contactId: c.id,
      seg,
      pinnedAt: (c as ContactRowLike & { pinned_at?: string | null }).pinned_at ?? null,
    })
  }

  const opts: BuildOptions<T> = {
    perPage: input.perPage,
    open: input.open,
    page: input.page,
    focusContactId: input.focusContactId,
    getRow: (r) => {
      const row = byId.get(r.contactId)
      if (!row) throw new Error(`buildPriorityView: contact ${r.contactId} vanished during grouping`)
      return extractRow(row, r)
    },
  }
  return buildSections(ranked, opts)
}
