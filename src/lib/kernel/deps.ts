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
}

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
    async requireRun(runId: string) {
      const run = await getRun(init.supabase, runId)
      if (!run) throw new Error(`[kernel] 找不到执行实例 ${runId}`)
      return run
    },
  }
  return deps
}
