/**
 * Kernel 的依赖包。
 *
 * 为什么用显式依赖注入而不是 `import { supabaseAdmin }`：
 *
 *   ① Kernel 是唯一的执行门面，它自己抓着 service-role 客户端，
 *      「谁在什么授权下写了什么」就退化成「进程里任何地方都能写」；
 *   ② 授权闸、幂等、重试、死信这些东西**必须能被测试真正跑一遍**，
 *      而不是把「闸有没有生效」寄托在生产库上；
 *   ③ registry / capabilities 也进 deps，是为了让测试能用合成动作
 *      去验证 retry / dead_letter / 成本超支这些路径，
 *      而不必往生产注册表里塞一个假动作。
 *
 * 🔴 注意这不是「随便传个 capability 就能执行」的口子：
 *    执行前 Gateway 仍然会把授权事实从 append-only 决策表里重读一遍再比对，
 *    而架构测试保证生产代码里没有第二个地方能造出 AuthorizedExecutionContext。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ActionRun, CapabilityImplementation } from './types'
import type { EnvelopeFacts, EnvelopeRequest } from './autonomy-envelope'
import type { ActionRegistry } from './registry'
import { getRun } from './store'

export interface KernelDeps {
  readonly supabase: SupabaseClient
  readonly registry: ActionRegistry
  /** action_key → capability 实现。查不到 = CAPABILITY_NOT_IMPLEMENTED，不是「跳过」。 */
  readonly capabilities: Readonly<Record<string, CapabilityImplementation>>
  /** 这台机器的身份，进 claimed_by / consumed_by，用来查「是谁跑的」。 */
  readonly workerId: string
  /**
   * 运行所有权的租约时长（秒）。
   *
   * 🔴 这个数字决定「进程崩了之后多久别人能接手」。
   *    太短：还活着的 owner 会被误接管（两个人同时推进同一件事，
   *    最终靠 kernel_begin_authorized_run 那道原子闸兜底，但会白跑一趟授权）；
   *    太长：崩溃后这件事被冻住的时间就有多长。
   *    默认 5 分钟 —— 当前唯一上线的能力是纯内部组装，秒级完成。
   */
  readonly leaseSeconds: number
  /**
   * 这个 Kernel 实例的租约身份前缀。
   *
   * 🔴 为什么不能直接用 workerId：workerId 是**机器**的身份
   *    （`kernel@<instance>`），同一个进程里两个并发调用共用同一个值。
   *    租约的 owner 要回答的是「**谁在推进这一次**」——
   *    同进程的两个并发调用是两个 owner，不是同一个。
   *    用机器身份当 owner，两边都会被当成「自己续租」而同时放行，
   *    租约那道锁就等于没有（实测：四路并发提交会签出四份授权）。
   *
   *    进程重启后这个前缀也会变（带一次性 nonce）—— 崩溃前的那份租约
   *    必须**等它自己过期**才能被接管，这是唯一诚实的判据：
   *    我们分不清「旧进程崩了」和「旧进程还活着只是慢」。
   */
  readonly ownerId: string
  /**
   * 受限自治信封的**事实来源**（spec 2026-09-24 §3 G5）。
   *
   * 🔴 Kernel 刻意不认识广告表。信封要的六项事实（改动前预算、账户合计、
   *    日上限、距上次变动小时数、学习期、实验数）全部由域层实现去读
   *    （`capabilities/ads/envelope-facts.ts`），Kernel 只认这个接口。
   *
   * 🔴 **缺这个解析器 = 拒绝**，不是「跳过信封检查」。声明成 bounded 的动作
   *    没人能告诉 Kernel 真实预算是多少时，唯一诚实的答案是不做。
   *    所以它是可选字段，但 authorize / gateway 在 bounded 路径上缺它就 deny。
   */
  readonly resolveEnvelopeFacts?: EnvelopeFactsResolver
  now(): Date
  /** 重试之间的等待。测试里换成不等，生产里就是真等。 */
  sleep(ms: number): Promise<void>
  requireRun(runId: string): Promise<ActionRun>
}

export interface KernelDepsInit {
  supabase: SupabaseClient
  registry: ActionRegistry
  capabilities: Readonly<Record<string, CapabilityImplementation>>
  workerId?: string
  leaseSeconds?: number
  /** 测试里固定它，用来造「另一个进程」。 */
  ownerId?: string
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
  /** 见 `KernelDeps.resolveEnvelopeFacts`。不给 = bounded 动作一律拒。 */
  resolveEnvelopeFacts?: EnvelopeFactsResolver
}

/**
 * 解析某一次 run 的信封事实。
 *
 * `at` 说明这是哪一层在问：授权层用当下最新快照，执行层用 `kernel_pre`
 * （碰 provider 之前刚抓的那一份）。两层各算一次，事实来源不同，都必须过。
 *
 * 返回 `{ unavailable }` = 读不到 → 调用方 deny，**不得当作通过**。
 */
export type EnvelopeFactsResolver = (ctx: {
  clientId: string
  actionKey: string
  input: Record<string, unknown>
  at: 'authorize' | 'pre_provider'
  runId: string
}) => Promise<
  | { readonly request: EnvelopeRequest; readonly facts: EnvelopeFacts }
  | { readonly unavailable: string }
>

/** 进程内一次性的随机后缀 —— 重启之后不会跟崩溃前那份租约撞上。 */
function bootNonce(): string {
  return Math.random().toString(36).slice(2, 10)
}

export function createKernelDeps(init: KernelDepsInit): KernelDeps {
  const deps: KernelDeps = {
    supabase: init.supabase,
    registry: init.registry,
    capabilities: init.capabilities,
    workerId: init.workerId ?? `kernel@${process.env.RENDER_INSTANCE_ID ?? 'local'}`,
    leaseSeconds: init.leaseSeconds ?? 300,
    ownerId: init.ownerId ?? `${init.workerId ?? 'kernel'}@${bootNonce()}`,
    now: init.now ?? (() => new Date()),
    sleep: init.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms))),
    /**
     * 🔴 **这一行以前漏了**（子牙 2026-09-27 审 WP3.1b 抓到）。
     *
     *    `KernelDepsInit` 从一开始就声明了这个字段、`KernelDeps` 也声明了、注释还写着
     *    「不给 = bounded 动作一律拒」—— 但这个工厂的对象字面量里没有它，
     *    所以调用方认认真真传进来的解析器被**静默丢掉**。
     *
     *    后果是闭合的、而且是「全拒」不是「偶尔拒」：
     *      · `registry-ads.ts` 六个 ActionKey 全是 `approval: { mode: 'bounded' }`
     *      · `authorize.ts` 在 bounded 路径上缺解析器就 `outside_autonomy_envelope` deny
     *      · 于是每一条广告动作都拿回 denied，Meta 一个字节都不动
     *
     *    这跟本文件下方 `createKernel` 那句注释（`leaseSeconds` / `ownerId` 以前
     *    「接了不转发」）是**同一类 bug**：**「参数类型收了它」和「行为真的变了」是两件事**。
     *    架构测试现在盯着「生产 Kernel 工厂产出的 `deps.resolveEnvelopeFacts` 非空」。
     */
    resolveEnvelopeFacts: init.resolveEnvelopeFacts,
    async requireRun(runId: string) {
      const run = await getRun(init.supabase, runId)
      if (!run) throw new Error(`[kernel] 找不到执行实例 ${runId}`)
      return run
    },
  }
  return deps
}
