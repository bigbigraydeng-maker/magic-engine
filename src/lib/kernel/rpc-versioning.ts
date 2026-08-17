/**
 * 版本化 RPC 的 **fail closed** 闸。
 *
 * 数据库和代码是分开上线的。新代码依赖的那个 `_v2` 函数，在「代码先部署、
 * migration 还没 apply」的窗口里**不存在** —— 这时唯一正确的行为是**停下**，
 * 不是退回历史入口。历史入口今天仍然可调用，所以退回去不会报错，
 * 会**静默成功**打在缺了新保证的旧实现上；报错会让整条链停下，
 * 降级会让它继续往下走，后者危险得多。
 *
 * 🔴 从 `store.ts` 拆出来是因为那个文件到了 822 行 > 铁律的 800。
 *    拆的是**文件位置，不是判据**。
 */

import { KernelRpcMissingError } from './errors'

/**
 * 「这个函数在库里不存在」——**只认函数缺失**，不认缺表、不认连接失败。
 *
 * 🔴 判得宽一点点都会变成安全问题：这个判定决定这次失败被答成 503（「这套东西
 *    还没打开，去 apply migration」）还是 500（「有 bug，去查日志」）。
 *    把网络抖动、超时、权限不足也算进来，真正的故障就会被描述成「没 apply」，
 *    运维照着去 apply 也修不好，而监控上只看到一条无害的 503。
 *    PG 报缺函数是 `42883`，PostgREST 的 schema cache 找不到是 `PGRST202`。
 */
export function missingRpcCode(error: { code?: string; message?: string } | null): string | null {
  if (!error) return null
  if (error.code === '42883' || error.code === 'PGRST202') return error.code
  if (
    /function\s+[^\n]{1,200}?\s+does not exist|could not find the function\b/i.test(
      error.message ?? '',
    )
  ) {
    // 文案兜底命中但没给码时，按 PG 那个码归一 —— 上层只认码。
    return error.code ?? '42883'
  }
  return null
}

/**
 * 版本化 RPC 不存在 ⇒ **当场抛错，绝不回退到没有新保证的历史入口。**
 *
 * 🔴 抛出的必须带**机器可读的码**（见 `KernelRpcMissingError`）：
 *    这里明明已经认出了 `42883`/`PGRST202`，抛出去时把码丢掉的话，
 *    接口层再也认不出来，只能答 `500 internal_error`，
 *    而这条路**声明过**它答 `503 kernel_not_provisioned`。
 *    对运维那是两条完全不同的指令。
 */
export function failClosedIfRpcMissing(
  rpc: string,
  error: { code?: string; message?: string } | null,
  ctx: { why: string; neverFallBackTo: string },
): void {
  const code = missingRpcCode(error)
  if (code === null) return
  throw new KernelRpcMissingError({
    rpc,
    code,
    message:
      `[kernel/store] ${rpc} 在这个数据库里还不存在（${code}）。${ctx.why}，` +
      `这里 fail closed —— 绝不退回没有新保证的 ${ctx.neverFallBackTo}。请先 apply 对应 migration。`,
    cause: error,
  })
}
