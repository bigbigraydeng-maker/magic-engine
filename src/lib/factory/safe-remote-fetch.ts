// 探活外链时的 SSRF 防护 —— 逐跳校验，不许自动跟随跳转。
//
// 为什么需要：探活用 `redirect: 'follow'` 时，只校验初始 URL 是不够的。
// 有后台权限的人可以提交一个公开 HTTPS 地址，让它 302 到
// `http://169.254.169.254/...`（云厂商元数据服务）或任何内网地址，
// 服务器就会替他去访问那些他自己够不着的东西，并把结果的状态/头暴露回来。
//
// 做法：`redirect: 'manual'`，自己一跳一跳走，每跳都重新校验协议与解析出的 IP。
//
// ⚠️ 残留风险（已知，未在此层解决）：DNS rebinding —— 校验时解析到公网 IP、
//    实际连接时 TTL 过期又解析到内网。彻底堵住要在 socket 层固定 IP 连接
//    （自定义 agent + lookup 钩子）。当前实现把「一次跳转就绕过全部校验」
//    收敛成「必须赢一次 DNS 竞态」，是显著收紧，不是完全免疫。

import { lookup } from 'dns/promises'
import net from 'net'

const MAX_HOPS = 5

/** 私网 / 环回 / 链路本地 / 保留段 —— 一律不许连。 */
export function isBlockedAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number)
    if (a === 10) return true // 10.0.0.0/8
    if (a === 127) return true // 环回
    if (a === 0) return true // 0.0.0.0/8
    if (a === 169 && b === 254) return true // 链路本地，含 169.254.169.254 元数据
    if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
    if (a === 192 && b === 168) return true // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 CGNAT
    if (a >= 224) return true // 组播与保留
    return false
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase()
    if (v === '::1' || v === '::') return true
    // IPv4-mapped（::ffff:10.0.0.1）要按其 v4 段判，否则是个绕过口子
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v)
    if (mapped) return isBlockedAddress(mapped[1])
    if (v.startsWith('fe80')) return true // 链路本地
    const head = parseInt(v.slice(0, 2), 16)
    if ((head & 0xfe) === 0xfc) return true // fc00::/7 唯一本地地址
    return false
  }
  return true // 解析不出来的一律当危险
}

/** 这一跳能不能走：协议必须是 http(s)，解析出的每个 IP 都不在禁用段，且（若给了
 *  allowedHosts）主机名在白名单里——每一跳都查，不是只查最终地址：跳转可能从一个
 *  白名单域名转到别处（Creatomate 结果下载用，spec §4.4/§6.1，只信任官方域名）。 */
async function assertHopAllowed(u: URL, allowedHosts?: readonly string[]): Promise<string | null> {
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return '这个链接的协议不支持 — 用普通的 http/https 分享链接'
  }
  if (allowedHosts && !allowedHosts.includes(u.hostname)) {
    return `这个链接不在信任的域名列表里（${u.hostname}）`
  }
  let addrs: { address: string }[]
  try {
    addrs = await lookup(u.hostname, { all: true })
  } catch {
    return '这个链接的域名解析不了 — 确认地址没打错'
  }
  if (addrs.length === 0 || addrs.some((a) => isBlockedAddress(a.address))) {
    return '这个链接指向内部地址，不能用 — 换一个公开的分享链接'
  }
  return null
}

export interface SafeHeadResult {
  ok: boolean
  /** ok=false 时给人看的话 */
  error?: string
  /** 最终落地的 URL（跟完跳转后） */
  finalUrl?: string
  status?: number
  contentType?: string | null
}

/**
 * 安全地探一下这个链接是不是真能下到东西。
 * 只取前 1KB（Range），不下整个文件。
 *
 * @param allowedHosts 给了就额外校验每一跳的主机名必须在这个列表里（不给 = 不限制，
 *   维持原有行为，向后兼容既有调用方）。
 */
export async function safeProbeRemoteFile(
  rawUrl: string,
  timeoutMs = 20000,
  allowedHosts?: readonly string[],
): Promise<SafeHeadResult> {
  let current: URL
  try {
    current = new URL(rawUrl)
  } catch {
    return { ok: false, error: '这不像一个链接' }
  }

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const blocked = await assertHopAllowed(current, allowedHosts)
    if (blocked) return { ok: false, error: blocked }

    let res: Response
    try {
      res = await fetch(current.toString(), {
        headers: { Range: 'bytes=0-1023' },
        redirect: 'manual', // 🔴 自己跟，每跳都要重新校验
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch {
      return { ok: false, error: '打不开这个链接 — 确认链接没过期、并且设成「知道链接的人都能看」' }
    }

    // 3xx：跟下一跳（跟之前会在循环顶端重新校验）
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) return { ok: false, error: '这个链接跳转不完整 — 换一个直接指向视频的链接' }
      try {
        current = new URL(loc, current) // 相对跳转也要能解
      } catch {
        return { ok: false, error: '这个链接的跳转地址无效' }
      }
      continue
    }

    return {
      ok: res.ok || res.status === 206,
      error: res.ok || res.status === 206
        ? undefined
        : '打不开这个链接 — 确认链接没过期、并且设成「知道链接的人都能看」',
      finalUrl: current.toString(),
      status: res.status,
      contentType: res.headers.get('content-type'),
    }
  }

  return { ok: false, error: '这个链接跳转太多次了 — 换一个直接指向视频的链接' }
}
