/**
 * 从 cron 表达式推出「多久没跑就算逾期」（2026-08-03）。
 *
 * PM 要求：「如何能确保按时完成，如果不能完成需要有报错」。
 *
 * 现在的告警只报**跑失败**，不报**压根没跑** —— 而后者才是真正的杀手：
 *   · 工厂排产任务停摆 8 天，没有任何告警，因为它一次都没跑过（连失败记录都没有）
 *   · daily-cron-digest 自己也曾哑 51 天没人发现
 * 「没有消息」被当成了「一切正常」，实际上是「什么都没发生」。
 *
 * 这里只解析本仓 render.yaml 里实际用到的那几种写法，不做通用 cron 解析器 ——
 * 通用解析器要处理一堆我们根本不用的语法，多出来的每一条分支都是没测过的路。
 */

/** 解析不了的表达式返回 null —— 由调用方决定怎么办，不猜一个数字糊过去。 */
export function expectedIntervalHours(schedule: string): number | null {
  const s = schedule.trim()
  const parts = s.split(/\s+/)
  if (parts.length !== 5) return null
  const [min, hour, dom, , dow] = parts

  // */N * * * *  —— 每 N 分钟
  const everyNMin = min.match(/^\*\/(\d+)$/)
  if (everyNMin && hour === '*') return Number(everyNMin[1]) / 60

  // 0 */N * * *  —— 每 N 小时
  const everyNHour = hour.match(/^\*\/(\d+)$/)
  if (everyNHour) return Number(everyNHour[1])

  // N * * * *  —— 每小时第 N 分钟（messenger / meta-leads 用这个，避开整点拥堵）
  if (/^\d+$/.test(min) && hour === '*') return 1

  // 固定时刻：看星期字段决定是每天还是每周
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*') {
    if (dow === '*') return 24 // 每天
    // 0-4 / 1 / 0 这类：每周若干次。取最坏情况（一周一次）以免误报
    if (/^\d+(-\d+)?$/.test(dow)) {
      const range = dow.match(/^(\d+)-(\d+)$/)
      if (range) {
        const days = Number(range[2]) - Number(range[1]) + 1
        // 一周跑 days 次，但不是均匀分布（工作日跑周末不跑），最坏间隔按 7-days+1 天算
        return (7 - days + 1) * 24
      }
      return 7 * 24 // 每周一次
    }
  }

  return null
}

/**
 * 逾期判定的宽限倍数。
 *
 * 为什么要宽限：Render 的定时任务不保证准点，冷启动、部署、重试都会推迟几分钟。
 * 按理论间隔卡死会天天误报，而**天天误报等于没有告警** —— 真出事那天也被淹掉。
 */
const GRACE_MULTIPLIER = 2.5
/** 高频任务（每 10 分钟那类）按倍数算出来的窗口太短，给一个下限。 */
const MIN_GAP_HOURS = 1.5

export function overdueThresholdHours(schedule: string): number | null {
  const interval = expectedIntervalHours(schedule)
  if (interval === null) return null
  return Math.max(interval * GRACE_MULTIPLIER, MIN_GAP_HOURS)
}

export interface JobHealthInput {
  service: string
  jobName: string
  schedule: string
  /** 最近一次运行时间；从没跑过传 null。 */
  lastRunAt: Date | null
  /** 代码里有没有写运行记录。false = 这个任务天生查不出来。 */
  logsRuns: boolean
}

export type JobHealth =
  | { service: string; state: 'ok' }
  /** 从来没有过运行记录，而它本该会记 —— 多半是没触发（密钥没接上 / 服务没建）。 */
  | { service: string; state: 'never_ran'; detail: string }
  /** 超过宽限期没跑。 */
  | { service: string; state: 'overdue'; detail: string; hoursSince: number }
  /** 代码里没写运行记录 —— 不是它坏了，是我们看不见它。 */
  | { service: string; state: 'blind'; detail: string }
  /** 表达式解析不了，人工看一眼。 */
  | { service: string; state: 'unknown_schedule'; detail: string }

/**
 * 判定一个任务的健康状态。
 *
 * 🔴 `blind`（代码没写记录）单独成一类，**不能算成 ok**。
 *    把「看不见」当「没问题」正是工厂停摆 8 天没人发现的根因。
 */
export function judgeJob(input: JobHealthInput, now: Date): JobHealth {
  const { service, schedule, lastRunAt, logsRuns } = input

  if (!logsRuns) {
    return {
      service,
      state: 'blind',
      detail: '这个任务的代码里没有写运行记录，跑没跑都查不出来 —— 需要给它接上 startCronRun',
    }
  }

  const threshold = overdueThresholdHours(schedule)
  if (threshold === null) {
    return { service, state: 'unknown_schedule', detail: `看不懂的调度表达式：${schedule}` }
  }

  if (!lastRunAt) {
    return {
      service,
      state: 'never_ran',
      detail: '建好之后一次都没跑过 —— 多半是密钥没接上，或者服务没真的建出来',
    }
  }

  const hoursSince = (now.getTime() - lastRunAt.getTime()) / 3_600_000
  if (hoursSince > threshold) {
    return {
      service,
      state: 'overdue',
      hoursSince,
      detail: `按 ${schedule} 本该 ${threshold.toFixed(1)} 小时内跑一次，实际已经 ${hoursSince.toFixed(1)} 小时没动静`,
    }
  }

  return { service, state: 'ok' }
}

/** 只留有问题的 —— 健康的不占地方。 */
export function unhealthyJobs(inputs: JobHealthInput[], now: Date): JobHealth[] {
  return inputs.map((i) => judgeJob(i, now)).filter((h) => h.state !== 'ok')
}
