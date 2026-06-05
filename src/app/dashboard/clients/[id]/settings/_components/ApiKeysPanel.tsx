'use client'

/**
 * ApiKeysPanel — FDE-managed MCP API keys for this client.
 *
 * Phase 34 / P34.2.3. Lets FDE issue keys to give clients access to
 * Magic Engine MCP tools from their own Claude. Plaintext is shown EXACTLY
 * ONCE in the one-time reveal box; once dismissed it's gone forever and
 * the client must be re-issued a new key.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

interface Props {
  clientId: string
}

interface ApiKeyRow {
  id: string
  name: string
  key_prefix: string
  scopes: string[]
  last_used_at: string | null
  revoked_at: string | null
  created_at: string
  created_by_email: string | null
}

interface IssuedKey {
  id: string
  name: string
  key_prefix: string
  plaintext: string
}

type PanelState =
  | { phase: 'loading' }
  | { phase: 'error';   message: string }
  | { phase: 'ready';   keys: ApiKeyRow[] }

const NAME_MAX = 80

export function ApiKeysPanel({ clientId }: Props) {
  const [state,       setState]       = useState<PanelState>({ phase: 'loading' })
  const [nameDraft,   setNameDraft]   = useState('')
  const [issuing,     setIssuing]     = useState(false)
  const [issueErr,    setIssueErr]    = useState<string | null>(null)
  const [reveal,      setReveal]      = useState<IssuedKey | null>(null)
  const [copied,      setCopied]      = useState(false)
  const [revokingId,  setRevokingId]  = useState<string | null>(null)
  const [revokeErr,   setRevokeErr]   = useState<string | null>(null)
  // useRef sync dedupe (魏征 R1): useState `issuing` doesn't update until the
  // next render — React 18 concurrent mode + back-to-back clicks (or touch +
  // click during hydration) can fire two POSTs before disabled kicks in.
  // The ref is checked/set synchronously on the FIRST line of handleIssue.
  const issuingRef                    = useRef(false)
  const revokingIdRef                 = useRef<string | null>(null)

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const res = await fetch(`/api/clients/${clientId}/api-keys`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { keys } = (await res.json()) as { keys?: ApiKeyRow[] }
      setState({ phase: 'ready', keys: keys ?? [] })
    } catch (err) {
      setState({
        phase: 'error',
        message: err instanceof Error ? err.message : String(err),
      })
    }
  }, [clientId])

  useEffect(() => { load() }, [load])

  const handleIssue = async () => {
    // Synchronous gate — must be first, before any await or setState.
    if (issuingRef.current) return
    const name = nameDraft.trim()
    if (!name) return
    issuingRef.current = true
    setIssuing(true)
    setIssueErr(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(error ?? `HTTP ${res.status}`)
      }
      const { key } = (await res.json()) as { key: IssuedKey }
      setReveal(key)               // plaintext lives ONLY in this local state
      setNameDraft('')
      await load()                 // refresh list to show the new key
    } catch (err) {
      setIssueErr(err instanceof Error ? err.message : String(err))
    } finally {
      issuingRef.current = false
      setIssuing(false)
    }
  }

  const handleRevoke = async (row: ApiKeyRow) => {
    if (revokingIdRef.current === row.id) return
    // Confirm BEFORE claiming the guard ref (Codex review): if confirm is
    // cancelled after setting the ref, the early return would never clear it
    // and all future revokes of this key would be silently ignored. The sync
    // confirm dialog blocks the thread, so a double-click still can't slip
    // past the line-107 guard while the dialog is open.
    if (!confirm(
      `吊销 "${row.name}" (${row.key_prefix}…) 后，客户的 Claude 将立即断连，不可恢复。\n\n确定吊销？`,
    )) return
    revokingIdRef.current = row.id
    setRevokingId(row.id)
    setRevokeErr(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/api-keys/${row.id}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(error ?? `HTTP ${res.status}`)
      }
      await load()
    } catch (err) {
      setRevokeErr(err instanceof Error ? err.message : String(err))
    } finally {
      revokingIdRef.current = null
      setRevokingId(null)
    }
  }

  const dismissReveal = () => {
    setReveal(null)              // plaintext leaves React state forever
    setCopied(false)
  }

  const copyPlaintext = async () => {
    if (!reveal) return
    try {
      await navigator.clipboard.writeText(reveal.plaintext)
      setCopied(true)
    } catch {
      // Non-secure context or browser denied clipboard access. Don't pretend
      // it worked — tell the FDE to copy from the textarea manually.
      setIssueErr('剪贴板访问被浏览器拒绝，请手动选中文本框复制 Key')
    }
  }

  if (state.phase === 'loading') {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-400">加载中...</p>
      </div>
    )
  }

  if (state.phase === 'error') {
    // 403 = client-viewer trying to read admin-only resource. Graceful
    // degrade with explanation rather than scary red box.
    if (state.message.includes('403') || state.message.toLowerCase().includes('forbidden')) {
      return (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-bold text-slate-600">仅 Admin/FDE 可管理 MCP Key</p>
          <p className="mt-1 text-xs text-slate-500">如需为该客户签发 API Key，请联系项目 Admin。</p>
        </div>
      )
    }
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4">
        <p className="text-sm font-bold text-red-700">加载失败</p>
        <p className="mt-1 text-xs text-red-600">{state.message}</p>
        <button
          onClick={load}
          className="mt-2 rounded-lg border border-red-300 bg-white px-3 py-1 text-xs font-bold text-red-700 hover:bg-red-100"
        >
          重试
        </button>
      </div>
    )
  }

  const keys = state.keys

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      {/* One-time plaintext reveal box (子牙 P34.2 坑1) */}
      {reveal && (
        <div className="mb-4 rounded-lg border-2 border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-black text-amber-900">
            🔑 新 Key 已生成：{reveal.name}
          </p>
          <p className="mt-1 text-xs text-amber-800">
            <strong>这是唯一一次显示完整 Key，关闭后无法再查看。</strong>
            请立即复制并安全交付给客户。
          </p>
          <textarea
            readOnly
            value={reveal.plaintext}
            onFocus={(e) => e.currentTarget.select()}
            className="mt-3 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 font-mono text-xs text-amber-900 focus:outline-none focus:ring-2 focus:ring-amber-200"
            rows={2}
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={copyPlaintext}
              className="rounded-lg bg-amber-600 px-3 py-1 text-xs font-bold text-white hover:bg-amber-700"
            >
              {copied ? '✓ 已复制' : '复制 Key'}
            </button>
            <button
              onClick={dismissReveal}
              className="rounded-lg border border-amber-400 bg-white px-3 py-1 text-xs font-bold text-amber-800 hover:bg-amber-100"
            >
              我已保存，关闭
            </button>
          </div>
        </div>
      )}

      {/* Issue new key */}
      <div className="mb-4 border-b border-slate-100 pb-4">
        <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">
          签发新 Key
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            placeholder='例如 "CTS 老板 Claude 桌面版"'
            maxLength={NAME_MAX}
            disabled={issuing}
            className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100"
          />
          <button
            onClick={handleIssue}
            disabled={issuing || !nameDraft.trim()}
            className="rounded-lg bg-cyan-600 px-4 py-1.5 text-sm font-bold text-white hover:bg-cyan-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {issuing ? '生成中…' : '生成 Key'}
          </button>
        </div>
        {issueErr && (
          <p className="mt-2 text-xs text-red-600">⚠ {issueErr}</p>
        )}
      </div>

      {/* Existing keys list */}
      {revokeErr && (
        <p className="mb-2 text-xs text-red-600">⚠ 吊销失败：{revokeErr}</p>
      )}

      {keys.length === 0 ? (
        <p className="text-sm text-slate-400">该客户尚未签发任何 MCP Key。</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {keys.map((row) => {
            const isRevoked = row.revoked_at !== null
            return (
              <li
                key={row.id}
                className={`flex items-center justify-between gap-3 py-3 ${isRevoked ? 'opacity-60' : ''}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-bold text-slate-800">
                      {row.name}
                    </span>
                    {isRevoked ? (
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                        ● 已吊销
                      </span>
                    ) : (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                        ● 活跃
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-3 text-xs text-slate-500">
                    <code className="font-mono">{row.key_prefix}…</code>
                    <span>·</span>
                    <span>
                      最后使用：{row.last_used_at
                        ? new Date(row.last_used_at).toLocaleString()
                        : '从未使用'}
                    </span>
                  </div>
                </div>
                {isRevoked ? (
                  <span className="shrink-0 text-xs text-slate-400">
                    {row.revoked_at && new Date(row.revoked_at).toLocaleDateString()} 吊销
                  </span>
                ) : (
                  <button
                    onClick={() => handleRevoke(row)}
                    disabled={revokingId === row.id}
                    className="shrink-0 rounded-lg border border-red-200 bg-white px-3 py-1 text-xs font-bold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-slate-400"
                  >
                    {revokingId === row.id ? '吊销中…' : '吊销'}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-400">
        客户用此 Key 在 MCP 兼容客户端（如 Claude Desktop）里只读查询本客户数据（排名/目标/执行进度/内容交付）。Key 只签发给本客户，不能查看其他客户的数据。
      </p>
    </div>
  )
}
