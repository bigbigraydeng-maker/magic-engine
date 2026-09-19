/**
 * 按 clientId 查表分发到该客户的 Verifier policy——F2（issue #1585）的编排层
 * 只调用这个查表函数，自己不认识任何具体客户。
 *
 * 子牙复审（issue #1585，2026-09-15）指出：这张查表原来写在 Inngest 函数文件
 * 里（编排层），把"哪个客户用哪份 policy"这个 policy 层决策泄漏进了本该
 * client-agnostic 的共享 runtime——对照 F1（`conversation-inbound-autoack.ts`）
 * 特意绕开 `if (clientId === CTS_ID)` 改走行业特征匹配的做法，这里应该同样
 * 下沉。放在这里之后，加第二个客户只需要在这个文件里加一行，Inngest 函数本身
 * 不用碰（CLAUDE.md 铁律 0 的快速自检：明天换成一个悉尼地产客户，这段 shared
 * code 要不要改——不改）。
 *
 * fail-closed：查不到这个客户的 policy 就是"没有闸门"，不是"放行"——见
 * `resolveVerifierPolicy` 的调用方应该怎么处理 `null`（当作 block，不是 skip）。
 */

import { verifyCtsReply, CTS_CLIENT_ID, type CtsVerifierContext } from './cts'
import type { VerifierResult } from '../framework'

export type VerifierPolicyContext = CtsVerifierContext

const VERIFIER_POLICIES: Record<string, (ctx: VerifierPolicyContext) => VerifierResult> = {
  [CTS_CLIENT_ID]: verifyCtsReply,
}

/** 查不到这个客户的 policy 时返回 `null`（不是抛错）——调用方决定"没有闸门"该怎么处理。 */
export function resolveVerifierPolicy(
  clientId: string,
): ((ctx: VerifierPolicyContext) => VerifierResult) | null {
  return VERIFIER_POLICIES[clientId] ?? null
}
