/** 按国际区号给号码标个「哪国号码」，让员工一眼判断客人在哪。认不出就返回 null，不猜。 */
const PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ['+852', '香港'],
  ['+886', '台湾'],
  ['+64', '新西兰'],
  ['+61', '澳大利亚'],
  ['+86', '中国大陆'],
  ['+65', '新加坡'],
  ['+60', '马来西亚'],
  ['+44', '英国'],
  ['+1', '美国/加拿大'],
]

export function phoneRegionLabel(phone: string | null | undefined): string | null {
  const p = (phone ?? '').replace(/[\s-]/g, '')
  if (!p.startsWith('+')) return null
  for (const [prefix, label] of PREFIXES) if (p.startsWith(prefix)) return label
  return null
}
