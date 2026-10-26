// 转公开动作的小型结构收窄工具(无依赖,供 guards 与平台端口共用,避免循环引用)。

/** 把 unknown 收窄成「普通对象」;数组、null、原始值一律返回 {}。 */
export function asRecord(v: unknown): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return {}
  return v as Record<string, unknown>
}

export function nonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}
