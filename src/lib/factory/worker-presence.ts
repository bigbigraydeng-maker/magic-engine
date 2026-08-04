/**
 * 出片工人还在不在。
 *
 * 出片这条线的装配环节跑在一台 Mac 上（Python + ffmpeg + piper + 品牌素材），
 * 队列协议本身是服务端的、跟机器无关（认领走 RPC、素材走签名链接、有心跳、
 * 交付时服务端复扫红线），但**没人跑工人的时候，工单就静静躺在队列里**。
 *
 * 🔴 这不是「工人坏了」——工人没开机是常态（合盖、出门、重启）。
 *    问题是**从外面看不出来**：队列里躺着活，看板上什么都没有，
 *    而「这周怎么没出片」要等人想起来问才发现。
 *
 * 判据故意做得保守：**只有队列里真的有活在等**的时候才报。
 * 没活的时候工人没开机完全正常，报了就是噪音 —— 误报成常态，告警就废了。
 */

/** 工单排队多久还没人认领算「没人干活」。给足合盖午休的余量。 */
export const QUEUE_STALE_HOURS = 6

export interface QueueSnapshot {
  /** 队列里等着的工单数（status='queued'） */
  queued: number
  /** 最老那单等了多久（小时）。队列空时传 null */
  oldestQueuedHours: number | null
  /** 任何工人最近一次心跳距今多久（小时）。从没有过心跳传 null */
  lastHeartbeatHours: number | null
}

export type WorkerPresence =
  | { idle: true }
  | {
      idle: false
      /** 给人看的一句话：等了多久、多久没人干活 */
      humanReason: string
    }

/**
 * 队列里有活但没人干 → 报。
 *
 * 两个数缺一不可：光看「有没有心跳」会在没活的时候天天误报；
 * 光看「队列长度」分不清是没人干还是正在干。
 */
export function judgeWorkerPresence(snap: QueueSnapshot): WorkerPresence {
  // 队列空 = 工人没开机也无所谓，不报
  if (snap.queued === 0) return { idle: true }

  // 有活，但最老的那单还没等够久 —— 可能工人正在跑别的单
  if (snap.oldestQueuedHours === null || snap.oldestQueuedHours < QUEUE_STALE_HOURS) {
    return { idle: true }
  }

  // 有活、等久了，再看有没有人在干
  const hb = snap.lastHeartbeatHours
  if (hb !== null && hb < QUEUE_STALE_HOURS) {
    // 有工人在动，只是这单还没轮到 —— 那是产能问题，不是「没人干活」
    return { idle: true }
  }

  const waited = snap.oldestQueuedHours.toFixed(0)
  const since =
    hb === null ? '从来没有工人连上来过' : `已经 ${hb.toFixed(0)} 小时没有工人动过`
  return {
    idle: false,
    humanReason: `${snap.queued} 个出片工单在排队，最老的等了 ${waited} 小时，${since}`,
  }
}
