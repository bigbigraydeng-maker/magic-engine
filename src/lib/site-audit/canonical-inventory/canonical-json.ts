/**
 * Magic Engine 2.0 · 台账层自己的稳定序列化器（Issue #960）
 *
 * 签名原文必须是**确定性**的：同一份内容永远序列化成同一个字节串，否则
 * 「重算 digest 跟签名比对」这件事本身就不成立 —— 键顺序换一下就验不过，
 * 而那看起来像被篡改，不像序列化不稳。
 *
 * 规则（冻结，改任何一条都必须升 `INVENTORY_ENVELOPE_VERSION`）：
 *   - 对象键按码点排序；
 *   - 数组**保序**（顺序本身是内容的一部分：候选的字典序决定撞车主候选）；
 *   - 对象里值为 `undefined` 的键**剔除**（`{a:1,b:undefined}` 与 `{a:1}` 同一份原文）；
 *   - `null` **显式保留**（`error: null` 与「没有 error 这个键」不是一回事）。
 *
 * 🔴 **不复用 `@/lib/kernel/idempotency#canonicalJson`。** 那个模块的导出与
 *    `ActionDefinition` / `KernelError` 绑在一起，site-audit 采集层反向依赖执行内核
 *    是错的方向，架构守卫也明令禁止。为几行代码引入那条依赖不划算。
 */

/**
 * 确定性 JSON 序列化。
 *
 * 顶层 `undefined` 序列化成 `null` —— 与 `JSON.stringify` 对数组元素的处理一致，
 * 且签名原文永远不会是空串（空串会让「没签」和「签了空内容」长得一样）。
 */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') return serialiseObject(value as Record<string, unknown>)
  return JSON.stringify(value)
}

/**
 * 只认普通对象与数组。
 *
 * 🔴 `Date` / `Map` / `Set` / 类实例走 `Object.entries` 全都得到 `{}` ——
 *    两个不同时刻的 `Date` 会序列化成同一份原文，进而拿到**同一个 digest**。
 *    编辑者利用不了（`JSON.parse` 产不出这些值），但序列化器在自己的定义域上
 *    不该有歧义：静默塌成 `{}` 是「悄悄丢内容」，跟这一层要证明的东西正好相反。
 *    宁可当场抛。
 */
function assertPlainContainer(value: object): void {
  const proto = Object.getPrototypeOf(value)
  if (proto === Object.prototype || proto === Array.prototype || proto === null) return
  throw new TypeError(
    `canonicalJson 只接受普通对象 / 数组 / 原始值，收到的是 ${value.constructor?.name ?? '未知类型'} —— ` +
      '它会被序列化成 {}，两份不同内容会拿到同一个 digest',
  )
}

function serialiseObject(value: Record<string, unknown>): string {
  assertPlainContainer(value)
  const entries = Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => compareStrings(a, b))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
}

/**
 * 按码点比较。
 *
 * 🔴 不用 `localeCompare` —— 它随运行时 locale 变，序列化就不再确定，
 *    同一份内容在两台机器上能得到两个 digest。
 */
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
