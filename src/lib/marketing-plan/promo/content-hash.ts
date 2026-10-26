import { stableStringify } from '../plan-guard'
import type { PromoSpec } from './spec'

/**
 * 推广结构的内容指纹：同样的内容永远同一个值，改了任何一处金额 / 受众 / 素材 / 日期 / 目标就变。
 * 序列化复用 plan-guard 的 stableStringify（键排序、数组保序），和「推广结构是否被改动」用同一把尺。
 * 剔除 checks（客户端可写、保存时被清空、判定不参与）与 gate_snapshot（服务端留底，不属于被批准的内容）。
 *
 * 还剔除经营判断卡里的「剩余座位」三项（子牙 2026-10-18 复审必改项 1）：
 * 座位数是天天变的事实，不是「这笔钱该不该批」的内容。把它算进指纹的话，
 * 客户今天报一个新座位数，整份计划的人工核实记录就全部作废、硬门一起变红，
 * 而计划一旦批准内容就锁死、座位数反而再也改不了。
 */
const VOLATILE_BUSINESS_CASE_KEYS = ['seats_remaining', 'seats_confirmed', 'seats_as_of'] as const

/** 去掉卡里会常变、又不影响「该不该批」的字段。 */
function stripVolatile(spec: PromoSpec): PromoSpec {
  return {
    ...spec,
    phases: spec.phases.map(phase => {
      if (phase.business_case === undefined) return phase
      const kept: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(phase.business_case)) {
        if ((VOLATILE_BUSINESS_CASE_KEYS as readonly string[]).includes(key)) continue
        kept[key] = value
      }
      return { ...phase, business_case: kept as PromoSpec['phases'][number]['business_case'] }
    }),
  }
}

export function promoContentHash(spec: PromoSpec): string {
  // 用 Object.entries 过滤，避免解构出未使用变量触发 lint 报错。
  const content: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(stripVolatile(spec))) {
    if (key === 'checks' || key === 'gate_snapshot') continue
    content[key] = value
  }
  return sha256Hex(stableStringify(content)).slice(0, 16)
}

/**
 * 纯 JS 的 SHA-256（只给字符串用，UTF-8）。
 * 为什么不用 node:crypto：批准记录组件在浏览器里也要算指纹，浏览器打包不认 node:crypto（构建会失败）。
 */
function sha256Hex(message: string): string {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]
  const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
  const bytes = Array.from(new TextEncoder().encode(message))
  const bitLen = bytes.length * 8
  bytes.push(0x80)
  while (bytes.length % 64 !== 56) bytes.push(0)
  const hi = Math.floor(bitLen / 0x100000000)
  const lo = bitLen >>> 0
  for (const w of [hi, lo]) bytes.push((w >>> 24) & 0xff, (w >>> 16) & 0xff, (w >>> 8) & 0xff, w & 0xff)

  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n))
  const w = new Array<number>(64)
  for (let off = 0; off < bytes.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = ((bytes[off + 4 * i] << 24) | (bytes[off + 4 * i + 1] << 16) | (bytes[off + 4 * i + 2] << 8) | bytes[off + 4 * i + 3]) >>> 0
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, h] = H
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)
      const ch = (e & f) ^ (~e & g)
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)
      const maj = (a & b) ^ (a & c) ^ (b & c)
      const t2 = (S0 + maj) >>> 0
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0
  }
  return H.map(x => x.toString(16).padStart(8, '0')).join('')
}

/** 仅供测试：对照标准向量确认实现正确。 */
export const __sha256HexForTest = sha256Hex
