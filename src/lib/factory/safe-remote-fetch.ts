// 探活/下载外链时的 SSRF 防护 —— 逐跳校验，不许自动跟随跳转。
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

/**
 * 把一个合法 IPv6 地址串展开成 8 组十六进制(处理 `::` 压缩)。展开不了(格式怪)返回 null。
 * 只用来识别 IPv4-mapped(::ffff:0:0/96)的压缩十六进制写法——点分尾巴(::ffff:10.0.0.1)
 * 走另一条正则，这个函数不处理带点的字符串。
 */
function expandIPv6Groups(addr: string): string[] | null {
  if (addr.includes('.')) return null
  const parts = addr.split('::')
  if (parts.length > 2) return null
  if (parts.length === 1) {
    const groups = addr.split(':')
    return groups.length === 8 ? groups : null
  }
  const head = parts[0].length ? parts[0].split(':') : []
  const tail = parts[1].length ? parts[1].split(':') : []
  const missing = 8 - head.length - tail.length
  if (missing < 0) return null
  return [...head, ...Array(missing).fill('0'), ...tail]
}

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
    // IPv4-mapped 要按其 v4 段判，否则是个绕过口子(Codex 复审两轮抓出同一处的两种写法)：
    // ① 点分尾巴 ::ffff:10.0.0.1
    const mappedDotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v)
    if (mappedDotted) return isBlockedAddress(mappedDotted[1])
    // ② 压缩十六进制尾巴 ::ffff:a9fe:a9fe(= 169.254.169.254)——DNS 完全可以直接
    //    返回这种写法，攻击者控制的 AAAA 记录不用赢 DNS 竞态，第一版只认①会放行。
    const groups = expandIPv6Groups(v)
    if (groups) {
      const prefixIsZero = groups.slice(0, 5).every((g) => g === '' || /^0+$/.test(g))
      if (prefixIsZero && groups[5] === 'ffff') {
        const hi = parseInt(groups[6], 16)
        const lo = parseInt(groups[7], 16)
        if (!Number.isNaN(hi) && !Number.isNaN(lo)) {
          const mappedV4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`
          return isBlockedAddress(mappedV4)
        }
      }
    }
    if (v.startsWith('fe80')) return true // 链路本地
    const head = parseInt(v.slice(0, 2), 16)
    if ((head & 0xfe) === 0xfc) return true // fc00::/7 唯一本地地址
    return false
  }
  return true // 解析不出来的一律当危险
}

/** 这一跳能不能走：协议必须是 http(s)，且解析出的每个 IP 都不在禁用段。 */
async function assertHopAllowed(u: URL): Promise<string | null> {
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return '这个链接的协议不支持 — 用普通的 http/https 分享链接'
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
 */
export async function safeProbeRemoteFile(rawUrl: string, timeoutMs = 20000): Promise<SafeHeadResult> {
  let current: URL
  try {
    current = new URL(rawUrl)
  } catch {
    return { ok: false, error: '这不像一个链接' }
  }

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const blocked = await assertHopAllowed(current)
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

export interface SafeDownloadResult {
  ok: boolean
  error?: string
}

/** 手机原始录像的合理上限 —— 拦得住无限/伪造响应把 worker 磁盘写爆，同时不误伤正常长录像。 */
export const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024 // 2GB

/**
 * 安全地把外链内容整个下载到本地文件 —— 跟 safeProbeRemoteFile 同一套逐跳校验，
 * 但这次是真下载整个文件，不是只探前 1KB。
 *
 * 🔴 为什么 safeProbeRemoteFile 探活通过了还不够、下载时必须重新校验：
 * 探活和下载是两次独立的 HTTP 请求。恶意服务器完全可以让探活那次老实返回一段视频头，
 * 等真正下载(通常在几分钟后，任务排队之后)时改成跳转到内网地址——两次请求之间
 * 的窗口足够让攻击者"先给你看真的，再给你换成假的"(TOCTOU)。下载必须自己重新
 * 做一遍逐跳校验，不能信任"提交时探过活了"这件事。
 *
 * 🔴 为什么不能只信 Content-Length 就放心下载(Codex 复审)：chunked 响应可以不带这个头，
 * 恶意/失控响应也可以谎报。真正可信的只有"实际收了多少字节"，所以按流累计、
 * 超过硬上限立刻中断，不写完整个文件。worker 是串行处理队列的单容器，
 * 一次失控下载能把磁盘写爆、拖垮后面所有客户的做片任务。
 */
export async function safeDownloadRemoteFile(
  rawUrl: string,
  dest: string,
  timeoutMs = 20 * 60 * 1000,
  maxBytes = MAX_DOWNLOAD_BYTES,
): Promise<SafeDownloadResult> {
  const { createWriteStream } = await import('node:fs')

  let current: URL
  try {
    current = new URL(rawUrl)
  } catch {
    return { ok: false, error: '这不像一个链接' }
  }

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const blocked = await assertHopAllowed(current)
    if (blocked) return { ok: false, error: blocked }

    let res: Response
    try {
      res = await fetch(current.toString(), {
        redirect: 'manual', // 🔴 自己跟，每跳都要重新校验 —— 理由见函数头注释
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch {
      return { ok: false, error: '下载失败 — 链接打不开或已过期' }
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) return { ok: false, error: '这个链接跳转不完整' }
      try {
        current = new URL(loc, current)
      } catch {
        return { ok: false, error: '这个链接的跳转地址无效' }
      }
      continue
    }

    if (!res.ok || !res.body) return { ok: false, error: `下载失败 ${res.status}` }

    const ws = createWriteStream(dest)
    // 🔴 必须显式监听 'error'(Codex 复审)：磁盘写满/句柄失效这类错误，WriteStream
    // 会额外单独发一个 error 事件，不只是走 write() 回调。EventEmitter 上没人监听
    // 的 error 事件会被 Node 当未捕获异常直接终止整个进程——worker 是常驻服务，
    // 一次某个客户的下载写盘出错会连带炸掉所有客户的做片队列。挂上监听器只是为了
    // 不让它崩，真正的错误处理是下面循环里每次写完都检查这个变量。
    let streamErr: Error | null = null
    ws.on('error', (e: Error) => { streamErr = e })
    const reader = (res.body as ReadableStream<Uint8Array>).getReader()
    let received = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.byteLength
        if (received > maxBytes) {
          throw new Error(`文件超过 ${Math.round(maxBytes / 1024 / 1024)}MB 上限，已中断下载`)
        }
        await new Promise<void>((resolve, reject) => {
          ws.write(Buffer.from(value), (err) => (err ? reject(err) : resolve()))
        })
        if (streamErr) throw streamErr
      }
      if (streamErr) throw streamErr
      await new Promise<void>((resolve, reject) => {
        ws.end((err?: Error | null) => (err ? reject(err) : resolve()))
      })
      if (streamErr) throw streamErr
    } catch (e) {
      ws.destroy()
      return { ok: false, error: e instanceof Error ? e.message : '下载失败 — 写盘出错' }
    }
    return { ok: true }
  }

  return { ok: false, error: '这个链接跳转太多次了' }
}
