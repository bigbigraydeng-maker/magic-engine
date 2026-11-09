/**
 * 把一个联系人推进 / 改到另一个阶段，并留一条审计（谁、从哪档、改到哪档、为什么）。
 *
 * 从 `crm/contacts/[cid]/stage/route.ts` 抽出来的纯逻辑（2026-09-15，NAL「标已成交
 * →CAPI」设计评审要求）——那个 PATCH 路由的鉴权认的是浏览器 session cookie，服务端
 * 想在另一个端点（`nal-mark-won`）里"调用现有阶段推进逻辑"，不能对内发 HTTP 请求
 * 打那个路由（会因为没有 session cookie 直接 401），只能把逻辑本身抽成一个进程内
 * 直接调用的函数。PATCH 路由和新端点调用同一份逻辑，不会出现"路由改了这份逻辑没跟上"
 * 的漂移。
 *
 * 安全 / 稳定（跟原路由完全一致，行为没有变化）：
 *   IDOR   contact 必须属于传入的 clientId：WHERE id=contactId AND client_id=clientId。
 *   合法值  toStage 必须是「本客户」真实存在的 stage_key，否则拒绝——禁写任意字符串。
 *   幂等    current.stage === toStage → 直接返回 changed:false，不写重复 event（吸收双击）。
 *
 * 🔴 `changed:false` 只代表"阶段这一步没有新东西要记"，调用方（尤其 `nal-mark-won`）
 * 不能把它当成"这次操作失败/无效"——已经在目标阶段的联系人可能仍有新的业务要记
 * （比如同一个人的第二笔成交），阶段不用变不代表这次动作本身没有意义。
 *
 * `expectedFromStage`（可选，2026-09-28 CRM 重整 B2 加）：跟进团队一起翻同一份名单
 * （PM 2026-09-27 确认），两个人同时点开同一个客人、各自看到「现在：新线索」，
 * 一个先手改成「已联系」，另一个没刷新页面接着点「改成已成交」——旧写法会直接
 * 把「已联系」这一步覆盖掉，改阶段事件里凭空跳过一档，谁也不知道发生过什么。
 * 传了这个参数、且跟数据库里实际的 `from_stage` 不一致 → 返回 409，不落库、
 * 不写事件；不传（`undefined`）= 老行为，逐字不变（`nal-mark-won` 等既有调用方
 * 不受影响，它们调用时压根不传第 7 个参数）。
 *
 * 🔴 `null` 是一个真实存在的合法值，不是"没传"——`null` 表示"我看到这个人还没标
 * 过任何阶段"（新导入的客户，大家的「跟进到哪步」都空着是常态，见 all/page.tsx
 * 的提示文案）。这正是"两人一起翻同一份名单"最容易撞上的起点：都看到"还没标"，
 * 都想抢着标第一下。魏征 2026-09-28 复审 B2 实现时查出：路由层一度把
 * `expectedFromStage: null` 和"整个字段没传"都转成 `undefined`，于是对这批
 * 还没标过阶段的人，并发闸形同虚设——那正是这次要保护的场景，不能漏。
 * 判据因此只认"===undefined"才算没传，null 要照样触发检查。
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export type AdvanceStageResult =
  | { ok: true; stage: string; changed: boolean }
  | { ok: false; status: 404 | 400 | 500; error: string }
  | { ok: false; status: 409; error: string; actualStage: string | null }

export async function advanceContactStage(
  supabase: SupabaseClient,
  clientId: string,
  contactId: string,
  toStage: string,
  note: string | null,
  changedByEmail: string | null,
  expectedFromStage?: string | null,
): Promise<AdvanceStageResult> {
  // ── IDOR 闸：contact 必须属于 path client。同时拿当前 stage 做 from + 幂等判断。 ──
  const { data: contact, error: cErr } = await supabase
    .from('contacts')
    .select('id, stage')
    .eq('id', contactId)
    .eq('client_id', clientId)
    .maybeSingle()

  if (cErr) return { ok: false, status: 500, error: cErr.message }
  if (!contact) return { ok: false, status: 404, error: '联系人不存在' }

  // 并发闸：调用方声明了"我看到的是哪一档"，跟库里现在真实的不一致——
  // 说明别人已经先改过了，不能盲写覆盖。放在合法值闸之前：目标阶段合不合法
  // 跟"这个人是不是已经被别人动过"是两件独立的事，不该互相掩盖对方的报错。
  if (expectedFromStage !== undefined) {
    const actualStage = (contact as { stage: string | null }).stage ?? null
    if (actualStage !== expectedFromStage) {
      return {
        ok: false,
        status: 409,
        error: '这位客人的跟进阶段已经被别人改过了，刷新一下再改',
        actualStage,
      }
    }
  }

  // 合法值闸：toStage 必须是本客户真实存在的阶段。
  const { data: stageRow, error: sErr } = await supabase
    .from('client_pipeline_stages')
    .select('stage_key')
    .eq('client_id', clientId)
    .eq('stage_key', toStage)
    .maybeSingle()

  if (sErr) return { ok: false, status: 500, error: sErr.message }
  if (!stageRow) return { ok: false, status: 400, error: '这个阶段不存在' }

  const fromStage = (contact as { stage: string | null }).stage ?? null

  // 幂等：没变就不写 event。
  if (fromStage === toStage) {
    return { ok: true, stage: toStage, changed: false }
  }

  const nowIso = new Date().toISOString()

  /**
   * ⚠️ **先写这条变更记录，再改 contacts.stage —— 顺序不能倒过来**（Codex 复审 2026-08-15）。
   * 见原路由文件保留的完整历史说明；这里只搬运逻辑，不重新论证。
   */
  const { data: evt, error: evtErr } = await supabase
    .from('contact_stage_events')
    .insert({
      client_id: clientId,
      contact_id: contactId,
      from_stage: fromStage,
      to_stage: toStage,
      changed_by: changedByEmail,
      note,
    })
    .select('id')
    .single()

  if (evtErr) return { ok: false, status: 500, error: `改阶段失败: ${evtErr.message}` }

  const { error: updErr } = await supabase
    .from('contacts')
    .update({ stage: toStage, stage_updated_at: nowIso, updated_at: nowIso })
    .eq('id', contactId)
    .eq('client_id', clientId)

  if (updErr) {
    // 把刚写的那条记录撤掉（Codex 复审第四轮）——见原路由说明，撤不掉只记日志。
    const { error: rbErr } = await supabase
      .from('contact_stage_events')
      .delete()
      .eq('id', (evt as { id: string }).id)
      .eq('client_id', clientId)
    if (rbErr) {
      console.error('[advanceContactStage] 阶段没改成，撤回那条变更记录也失败了:', rbErr.message)
    }
    return { ok: false, status: 500, error: `改阶段失败: ${updErr.message}` }
  }

  return { ok: true, stage: toStage, changed: true }
}
