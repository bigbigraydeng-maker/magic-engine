/**
 * 「你刚才给谁打了电话」。
 *
 * ## 为什么需要这个
 *
 * 打电话的入口早就有了 —— 卡片上点号码，手机就拨出去。缺的是**回来那一段**：
 * 拨号之后浏览器被切走，回来时页面什么都没问，于是人转头去记 Excel。
 *
 * 线上数字说明这有多严重：CTS 的电话记录里 **287 条是从 Excel 表批量导进来的，
 * ME 自己记下的只有 3 条**。销售天天在打，系统几乎什么都没看到 ——
 * 而 CRM 分析的地基就是「谁在什么时候联系了谁、结果如何」。
 *
 * ## 为什么先不落库
 *
 * 最直觉的做法是「点号码就写一条触点」。**不能这么做**：那条触点会立刻让这个人
 * 从「还没搭上话」里消失（系统认为我们联系过了），而如果销售最后没记结果，
 * 这个人就静悄悄地掉出名单 —— 正是我们一路在防的那种失败。
 *
 * 所以这里只在浏览器里记一个「待办」，**拿到结果才写库**。代价是关掉标签页会丢，
 * 但那跟今天的状况一样（今天什么都不会留下），不会更糟。
 *
 * 存 localStorage 而不是 React state：拨号会把浏览器切到电话应用，回来时
 * 页面可能已经重载过了 —— 存在内存里等于白记。
 */

/** 一个人只可能刚打完一通电话，所以是单个值不是队列。 */
export interface PendingCall {
  contactId: string
  name: string
  phone: string
  /** 什么时候拨的（ISO）。太久之前的就不问了 —— 见 STALE_MS。 */
  dialledAt: string
}

/**
 * 超过这个时间就不再问「刚才那通怎么样」。
 *
 * 40 分钟：一通销售电话很少超过这个长度，而隔了大半天再弹出来问「刚才」，
 * 人已经想不起是哪一通了 —— 那时候问，只会得到一个随手乱点的答案，
 * 比不问更糟（假数据会进分批）。
 */
const STALE_MS = 40 * 60 * 1000

const KEY = 'me:crm:pending-call'

type Listener = () => void
const listeners = new Set<Listener>()

function read(): PendingCall | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as PendingCall
    if (!v?.contactId || !v?.dialledAt) return null
    // 太久了就当没有 —— 顺手清掉，别让它下次又冒出来。
    if (Date.now() - new Date(v.dialledAt).getTime() > STALE_MS) {
      window.localStorage.removeItem(KEY)
      return null
    }
    return v
  } catch {
    return null
  }
}

/** 快照要稳定：useSyncExternalStore 每次都拿到新对象会无限重渲染。 */
let cache: PendingCall | null = null
let cacheRaw: string | null = null
/**
 * 「缓存脏了，下次必须重读」。
 *
 * 单独一个标志位，**不能拿 `cacheRaw = null` 当这个信号** —— 清掉待办之后
 * localStorage 里读出来的也是 `null`，两个 null 一比相等，于是快照原样返回
 * 上一次的对象：待办明明清了，页面上那条「刚才那通怎么样」还挂着不走。
 * （2026-08-03 单测抓到的，写的时候完全没意识到。）
 */
let dirty = true

function snapshot(): PendingCall | null {
  if (typeof window === 'undefined') return null
  const raw = window.localStorage.getItem(KEY)
  if (dirty || raw !== cacheRaw) {
    cacheRaw = raw
    cache = read()
    dirty = false
  }
  return cache
}

function emit() {
  dirty = true
  listeners.forEach((l) => l())
}

export function subscribePendingCall(l: Listener): () => void {
  listeners.add(l)
  // 另一个标签页拨的号，这个标签页也该知道。
  if (typeof window !== 'undefined') window.addEventListener('storage', emit)
  return () => {
    listeners.delete(l)
    if (typeof window !== 'undefined' && listeners.size === 0) {
      window.removeEventListener('storage', emit)
    }
  }
}

export function getPendingCall(): PendingCall | null {
  return snapshot()
}

/** 服务端渲染时没有 localStorage —— 恒定返回 null，避免水合不一致。 */
export function getPendingCallServer(): PendingCall | null {
  return null
}

/** 点了电话号码。 */
export function markDialled(call: Omit<PendingCall, 'dialledAt'>): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...call, dialledAt: new Date().toISOString() }))
  } catch {
    // 隐私模式下 localStorage 会抛 —— 记不住就算了，不能让点号码这件事失败。
  }
  emit()
}

/**
 * 这个人的结果已经在别处记过了（抽屉里的「没打通」/「记一笔」）。
 *
 * 必须**认人**再清：抽屉里记的是 A，而待办是刚给 B 拨的号 —— 一刀清掉
 * 就把 B 那通电话弄丢了，而弄丢电话正是这整套东西要修的病。
 */
export function clearPendingCallFor(contactId: string): void {
  if (getPendingCall()?.contactId === contactId) clearPendingCall()
}

/** 结果记完了，或者人选择「不记了」。 */
export function clearPendingCall(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    // 同上
  }
  emit()
}
