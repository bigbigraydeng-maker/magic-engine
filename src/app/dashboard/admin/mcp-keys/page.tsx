'use client'

/**
 * /dashboard/admin/mcp-keys — FDE cross-client Admin MCP key management.
 *
 * Phase 34 / P34-P3.7. INTERNAL admin-only (middleware guards /dashboard/admin/*;
 * the /api/admin/mcp-keys routes re-check requireAdmin). Issue / list / revoke
 * admin keys + emergency kill-switch.
 *
 * ⚠️ Admin keys are cross-client (一把看所有客户). Treat as core credentials.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

interface AdminKeyRow {
  id: string
  name: string
  key_prefix: string
  owner_email: string
  ip_allowlist: string[]
  expires_at: string
  last_used_at: string | null
  created_by_email: string | null
  revoked_at: string | null
  created_at: string
}

interface IssuedKey {
  id: string
  name: string
  key_prefix: string
  plaintext: string
}

type State = { phase: 'loading' } | { phase: 'error'; message: string } | { phase: 'ready'; keys: AdminKeyRow[] }

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
}

export default function AdminMcpKeysPage() {
  const [state, setState] = useState<State>({ phase: 'loading' })
  const [name, setName] = useState('')
  const [ipList, setIpList] = useState('')
  const [issuing, setIssuing] = useState(false)
  const [issueErr, setIssueErr] = useState<string | null>(null)
  const [reveal, setReveal] = useState<IssuedKey | null>(null)
  const [copied, setCopied] = useState(false)
  const issuingRef = useRef(false)
  const revokingRef = useRef<string | null>(null)

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const res = await fetch('/api/admin/mcp-keys')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { keys } = (await res.json()) as { keys?: AdminKeyRow[] }
      setState({ phase: 'ready', keys: keys ?? [] })
    } catch (err) {
      setState({ phase: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleIssue = async () => {
    if (issuingRef.current) return
    const n = name.trim()
    if (!n) return
    if (!confirm(
      '你正在颁发一把【跨所有客户】的管理员钥匙,可读取全部客户数据。\n确定继续?',
    )) return
    issuingRef.current = true
    setIssuing(true)
    setIssueErr(null)
    try {
      const ip_allowlist = ipList.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)
      const res = await fetch('/api/admin/mcp-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: n, ip_allowlist }),
      })
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(error ?? `HTTP ${res.status}`)
      }
      const { key } = (await res.json()) as { key: IssuedKey }
      setReveal(key)
      setName(''); setIpList('')
      await load()
    } catch (err) {
      setIssueErr(err instanceof Error ? err.message : String(err))
    } finally {
      issuingRef.current = false
      setIssuing(false)
    }
  }

  const handleRevoke = async (row: AdminKeyRow) => {
    if (revokingRef.current === row.id) return
    if (!confirm(`吊销管理员钥匙 "${row.name}" (${row.key_prefix}…)?客户端将立即断连,不可恢复。`)) return
    revokingRef.current = row.id
    try {
      const res = await fetch(`/api/admin/mcp-keys/${row.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      await load()
    } catch (err) {
      alert(`吊销失败:${err instanceof Error ? err.message : String(err)}`)
    } finally {
      revokingRef.current = null
    }
  }

  const handleKillSwitch = async () => {
    const typed = prompt('🚨 紧急吊销【所有】管理员钥匙。此操作让全部 admin key 立即失效。\n输入 REVOKE-ALL 确认:')
    if (typed !== 'REVOKE-ALL') return
    try {
      const res = await fetch('/api/admin/mcp-keys/revoke-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'REVOKE-ALL' }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { rows_stamped } = (await res.json()) as { rows_stamped: number }
      alert(`已紧急吊销所有管理员钥匙(${rows_stamped} 把)。`)
      await load()
    } catch (err) {
      alert(`Kill-switch 失败:${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const copyPlaintext = async () => {
    if (!reveal) return
    try { await navigator.clipboard.writeText(reveal.plaintext); setCopied(true) }
    catch { setIssueErr('剪贴板访问被拒,请手动复制文本框') }
  }

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="font-display text-2xl font-bold tracking-tight text-me-charcoal/90">MCP 管理员钥匙</h1>
      <p className="text-sm text-me-charcoal/55 mt-1">
        跨客户管理员钥匙(<code>me_admin_</code>)。一把钥匙可在你自己的 AI(Claude Code / Codex / Desktop)里查询【所有客户】数据。仅 Admin/FDE 可见。
      </p>

      {/* Kill-switch 红条 */}
      <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border-2 border-red-300 bg-red-50 p-4">
        <div className="text-sm text-red-800">
          <strong>🚨 紧急情况</strong>(钥匙泄漏 / 笔记本被偷):一键吊销所有管理员钥匙,立即全部失效。
        </div>
        <button onClick={handleKillSwitch}
          className="shrink-0 rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-700">
          紧急吊销全部
        </button>
      </div>

      {/* 一次性明文 */}
      {reveal && (
        <div className="mt-5 rounded-lg border-2 border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-black text-amber-900">🔑 新管理员钥匙:{reveal.name}</p>
          <p className="mt-1 text-xs text-amber-800"><strong>唯一一次显示,关闭后无法再看。</strong>立即复制并安全保存。</p>
          <textarea readOnly value={reveal.plaintext} onFocus={(e) => e.currentTarget.select()}
            rows={2} className="mt-3 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 font-mono text-xs" />
          <div className="mt-2 flex gap-2">
            <button onClick={copyPlaintext} className="rounded-lg bg-amber-600 px-3 py-1 text-xs font-bold text-white hover:bg-amber-700">
              {copied ? '✓ 已复制' : '复制'}
            </button>
            <button onClick={() => { setReveal(null); setCopied(false) }} className="rounded-lg border border-amber-400 bg-white px-3 py-1 text-xs font-bold text-amber-800">
              我已保存,关闭
            </button>
          </div>
        </div>
      )}

      {/* 颁发 */}
      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-4">
        <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">颁发新管理员钥匙</p>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={80}
          placeholder='钥匙名(如 "老雷-laptop")'
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
        <textarea value={ipList} onChange={(e) => setIpList(e.target.value)} rows={2}
          placeholder="IP 白名单(可选,每行一个 CIDR,如 203.0.113.0/24)— 留空=不限,建议 24h 内补上"
          className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-1.5 font-mono text-xs" />
        {!ipList.trim() && (
          <p className="mt-1 text-xs text-red-600">⚠ 未限制 IP — 钥匙泄漏后果加剧,建议尽快补上 CIDR。</p>
        )}
        <div className="mt-2">
          <button onClick={handleIssue} disabled={issuing || !name.trim()}
            className="rounded-lg bg-cyan-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-cyan-700 disabled:bg-slate-300">
            {issuing ? '生成中…' : '生成管理员钥匙'}
          </button>
          {issueErr && <span className="ml-3 text-xs text-red-600">⚠ {issueErr}</span>}
        </div>
        <p className="mt-2 text-xs text-slate-400">有效期默认 90 天(最长 180 天)。</p>
      </div>

      {/* 列表 */}
      <div className="mt-6">
        {state.phase === 'loading' && <p className="text-sm text-slate-400">加载中…</p>}
        {state.phase === 'error' && (
          state.message.includes('403')
            ? <p className="text-sm text-slate-600">仅 Admin 可管理 MCP 管理员钥匙。</p>
            : <p className="text-sm text-red-600">加载失败:{state.message}</p>
        )}
        {state.phase === 'ready' && (state.keys.length === 0
          ? <p className="text-sm text-slate-400">尚未颁发任何管理员钥匙。</p>
          : (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
              {state.keys.map((row) => {
                const revoked = row.revoked_at !== null
                const dleft = daysUntil(row.expires_at)
                const expired = dleft <= 0
                return (
                  <li key={row.id} className={`flex items-center justify-between gap-3 p-3 ${revoked || expired ? 'opacity-60' : ''}`}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-bold text-slate-800">{row.name}</span>
                        {revoked ? <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600">● 已吊销</span>
                          : expired ? <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-bold text-orange-700">● 已过期</span>
                          : <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">● 活跃</span>}
                        {!revoked && !expired && row.ip_allowlist.length === 0 && (
                          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">⚠ 无 IP 限制</span>
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
                        <code className="font-mono">{row.key_prefix}…</code>
                        <span>归属 {row.owner_email}</span>
                        <span>{revoked ? '已吊销' : expired ? '已过期' : `${dleft} 天后过期`}</span>
                        <span>最后用 {row.last_used_at ? new Date(row.last_used_at).toLocaleString() : '从未'}</span>
                      </div>
                    </div>
                    {!revoked && (
                      <button onClick={() => handleRevoke(row)}
                        className="shrink-0 rounded-lg border border-red-200 bg-white px-3 py-1 text-xs font-bold text-red-600 hover:bg-red-50">
                        吊销
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          ))}
      </div>
    </div>
  )
}
