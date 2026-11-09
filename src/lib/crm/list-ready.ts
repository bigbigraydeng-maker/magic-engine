/**
 * 「全部客人」页只想让客人表先出来：同一页上不影响客人表的请求（悬浮按钮摘要、
 * 付款页签探针、付款要催）排到客人表第一次加载完之后再发，不跟它抢同一台服务器。
 *
 * 只在「声明了要等客人表」的页面里生效：其它页面没人声明，`afterCrmListReady`
 * 当场执行，行为跟以前完全一样。客人表一直没回来（失败/超时）时，等满
 * `FALLBACK_MS` 也会照常发出去，不会因为客人表出事就永远不发。
 */

const FALLBACK_MS = 4000

let expecting = false
let ready = false
const waiting = new Set<() => void>()

/** 页面挂载时声明「我有一张要先出来的客人表」；返回的函数在页面卸载时调用。 */
export function expectCrmList(): () => void {
  expecting = true
  ready = false
  return () => {
    expecting = false
    ready = false
  }
}

/** 客人表第一次加载结束（成功或失败都算）时调用；之后的调用无效。 */
export function markCrmListReady(): void {
  if (!expecting || ready) return
  ready = true
  for (const fire of [...waiting]) fire()
}

/** 客人表出来之后再执行 `run`。返回取消函数（组件卸载时调用）。 */
export function afterCrmListReady(run: () => void, fallbackMs: number = FALLBACK_MS): () => void {
  if (!expecting || ready) {
    run()
    return () => {}
  }
  let done = false
  const fire = () => {
    if (done) return
    done = true
    waiting.delete(fire)
    window.clearTimeout(timer)
    run()
  }
  const timer = window.setTimeout(fire, fallbackMs)
  waiting.add(fire)
  return () => {
    done = true
    waiting.delete(fire)
    window.clearTimeout(timer)
  }
}
