'use client'

/**
 * CmsPanel — GitHub CMS Connector configuration UI.
 *
 * Rendered inside SettingsDrawer when the '🔗 网站连接' tab is active.
 *
 * Workflow:
 *  1. On mount, fetch current connection status from /api/clients/[id]/cms/status
 *  2. If not connected: show a form to enter repo details + GitHub PAT
 *  3. If connected: show status badge + repo info + Test/Disconnect buttons
 *
 * Security: the PAT is sent only in the POST /cms/connect body (HTTPS),
 * never stored in React state after the form submits, and never echoed back
 * in the status response (only the last-four hint is shown).
 */

import { useState, useEffect, useCallback } from 'react'
import type { CmsConnectionStatus } from '@/lib/cms/vocabulary'

interface Props {
  clientId: string
}

type PanelState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'disconnected' }
  | { phase: 'connected'; status: CmsConnectionStatus }

// ─── CmsPanel ────────────────────────────────────────────────────────────────

export function CmsPanel({ clientId }: Props) {
  const [state, setState]   = useState<PanelState>({ phase: 'loading' })
  const [formOpen, setFormOpen] = useState(false)

  // ── Fetch status ─────────────────────────────────────────────────────────
  const fetchStatus = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const res  = await fetch(`/api/clients/${clientId}/cms/status`, {
        headers: { Authorization: `Bearer ${process.env.NEXT_PUBLIC_INTERNAL_API_KEY ?? ''}` },
      })
      const json = await res.json() as { success: boolean; data: CmsConnectionStatus | null; error?: string }
      if (!json.success) throw new Error(json.error ?? 'Failed to load status')

      if (!json.data) {
        setState({ phase: 'disconnected' })
      } else {
        setState({ phase: 'connected', status: json.data })
      }
    } catch (err) {
      setState({ phase: 'error', message: err instanceof Error ? err.message : 'Load failed' })
    }
  }, [clientId])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  // ── Render ────────────────────────────────────────────────────────────────
  if (state.phase === 'loading') {
    return (
      <div className="flex items-center justify-center py-16 gap-2 text-gray-400">
        <span className="animate-spin text-lg">⟳</span>
        <span className="text-sm">加载中…</span>
      </div>
    )
  }

  if (state.phase === 'error') {
    return (
      <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-700">
        {state.message}
        <button onClick={fetchStatus} className="ml-3 underline text-red-500">重试</button>
      </div>
    )
  }

  if (state.phase === 'connected') {
    return (
      <ConnectedView
        clientId={clientId}
        status={state.status}
        onRefresh={fetchStatus}
        onDisconnect={() => setState({ phase: 'disconnected' })}
      />
    )
  }

  // disconnected
  return (
    <div className="space-y-6">
      <IntroCard />
      {formOpen ? (
        <ConnectForm
          clientId={clientId}
          onConnected={(s) => setState({ phase: 'connected', status: s })}
          onCancel={() => setFormOpen(false)}
        />
      ) : (
        <button
          onClick={() => setFormOpen(true)}
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl transition-colors"
        >
          🔗 连接 GitHub 仓库
        </button>
      )}
    </div>
  )
}

// ─── IntroCard ────────────────────────────────────────────────────────────────

function IntroCard() {
  return (
    <div className="rounded-xl bg-indigo-50 border border-indigo-200 p-5 space-y-2">
      <p className="text-sm font-semibold text-indigo-800">GitHub CMS 连接器</p>
      <p className="text-sm text-indigo-700 leading-relaxed">
        连接客户 GitHub 仓库后，Magic Engine 可以自动将 SEO 修复（标题、描述）
        作为 Pull Request 提交到仓库。只需合并 PR，网站即刻更新。
      </p>
      <ul className="text-xs text-indigo-600 space-y-1 mt-2">
        <li>✓ 无需手动编辑代码文件</li>
        <li>✓ 每次修复都有独立 PR，可审查可回滚</li>
        <li>✓ PAT 加密存储，从不明文出现在日志中</li>
      </ul>
    </div>
  )
}

// ─── ConnectForm ─────────────────────────────────────────────────────────────

interface ConnectFormProps {
  clientId:    string
  onConnected: (s: CmsConnectionStatus) => void
  onCancel:    () => void
}

function ConnectForm({ clientId, onConnected, onCancel }: ConnectFormProps) {
  const [repoOwner,    setRepoOwner]    = useState('')
  const [repoName,     setRepoName]     = useState('')
  const [branch,       setBranch]       = useState('main')
  const [contentPaths, setContentPaths] = useState('')
  const [token,        setToken]        = useState('')
  const [saving,       setSaving]       = useState(false)
  const [error,        setError]        = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSaving(true)

    const paths = contentPaths
      .split('\n')
      .map(p => p.trim())
      .filter(Boolean)

    try {
      const res  = await fetch(`/api/clients/${clientId}/cms/connect`, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          Authorization:   `Bearer ${process.env.NEXT_PUBLIC_INTERNAL_API_KEY ?? ''}`,
        },
        body: JSON.stringify({
          repo_owner:     repoOwner.trim(),
          repo_name:      repoName.trim(),
          default_branch: branch.trim() || 'main',
          content_paths:  paths,
          token:          token.trim(),
        }),
      })
      const json = await res.json() as { success: boolean; data?: CmsConnectionStatus; error?: string }
      if (!json.success) throw new Error(json.error ?? 'Save failed')
      onConnected(json.data!)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <FormField label="仓库所有者 (GitHub Owner)" required>
          <input
            value={repoOwner}
            onChange={e => setRepoOwner(e.target.value)}
            placeholder="e.g. bigbigraydeng-maker"
            className={INPUT_CLASS}
            required
          />
        </FormField>
        <FormField label="仓库名称 (Repo Name)" required>
          <input
            value={repoName}
            onChange={e => setRepoName(e.target.value)}
            placeholder="e.g. chinatravel"
            className={INPUT_CLASS}
            required
          />
        </FormField>
      </div>

      <FormField label="默认分支 (Default Branch)">
        <input
          value={branch}
          onChange={e => setBranch(e.target.value)}
          placeholder="main"
          className={INPUT_CLASS}
        />
      </FormField>

      <FormField label="内容文件路径（每行一个，相对于仓库根目录）">
        <textarea
          value={contentPaths}
          onChange={e => setContentPaths(e.target.value)}
          placeholder={'src/lib/data/guides.ts\nsrc/lib/data/tours.ts'}
          rows={3}
          className={INPUT_CLASS + ' resize-none font-mono text-xs'}
        />
      </FormField>

      <FormField label="GitHub Personal Access Token (PAT)" required>
        <input
          type="password"
          value={token}
          onChange={e => setToken(e.target.value)}
          placeholder="ghp_..."
          className={INPUT_CLASS + ' font-mono'}
          required
          minLength={10}
          autoComplete="new-password"
        />
        <p className="mt-1 text-xs text-gray-400">
          需要 <code>contents:write</code> + <code>pull_requests:write</code> 权限。
          PAT 加密后存储，不会明文出现在日志中。
        </p>
      </FormField>

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={saving}
          className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
        >
          {saving ? '保存中…' : '保存连接'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-5 py-2.5 border border-gray-300 hover:bg-gray-50 text-sm font-medium rounded-xl transition-colors"
        >
          取消
        </button>
      </div>
    </form>
  )
}

// ─── ConnectedView ────────────────────────────────────────────────────────────

interface ConnectedViewProps {
  clientId:     string
  status:       CmsConnectionStatus
  onRefresh:    () => void
  onDisconnect: () => void
}

function ConnectedView({ clientId, status, onRefresh, onDisconnect }: ConnectedViewProps) {
  const [testing,      setTesting]      = useState(false)
  const [testResult,   setTestResult]   = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const res  = await fetch(`/api/clients/${clientId}/cms/test`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.NEXT_PUBLIC_INTERNAL_API_KEY ?? ''}` },
      })
      const json = await res.json() as { success: boolean; error?: string }
      if (json.success) {
        setTestResult('✅ 连接成功 — 仓库可访问')
      } else {
        setTestResult(`❌ ${json.error ?? '连接失败'}`)
      }
      onRefresh()
    } catch {
      setTestResult('❌ 网络错误，请重试')
    } finally {
      setTesting(false)
    }
  }

  const handleDisconnect = async () => {
    setDisconnecting(true)
    try {
      await fetch(`/api/clients/${clientId}/cms/connect`, {
        method:  'DELETE',
        headers: { Authorization: `Bearer ${process.env.NEXT_PUBLIC_INTERNAL_API_KEY ?? ''}` },
      })
      onDisconnect()
    } catch {
      setDisconnecting(false)
      setConfirmDelete(false)
    }
  }

  const statusColor =
    status.status === 'connected' ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
    : status.status === 'error'   ? 'bg-red-100 text-red-700 border-red-200'
    :                               'bg-gray-100 text-gray-600 border-gray-200'

  return (
    <div className="space-y-5">
      {/* Status badge */}
      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold ${statusColor}`}>
        <span>{status.status === 'connected' ? '●' : '○'}</span>
        <span>
          {status.status === 'connected' ? '已连接'
           : status.status === 'error'   ? '连接错误'
           :                               '未验证'}
        </span>
      </div>

      {/* Repo info */}
      <div className="rounded-xl bg-gray-50 border border-gray-200 divide-y divide-gray-200">
        {[
          { label: '仓库', value: `${status.repoOwner}/${status.repoName}` },
          { label: '分支', value: status.branch },
          { label: 'Token (末四位)', value: status.tokenHint ? `····${status.tokenHint}` : '—' },
          { label: '最后测试', value: status.lastTestedAt
              ? new Date(status.lastTestedAt).toLocaleString('zh-CN')
              : '从未测试' },
        ].map(({ label, value }) => (
          <div key={label} className="flex items-center justify-between px-4 py-3 text-sm">
            <span className="text-gray-500">{label}</span>
            <span className="font-mono text-xs font-medium text-gray-900">{value}</span>
          </div>
        ))}
      </div>

      {/* Last error */}
      {status.lastError && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-xs text-red-700">
          <span className="font-semibold">错误：</span>{status.lastError}
        </div>
      )}

      {/* Test result */}
      {testResult && (
        <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800">
          {testResult}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={handleTest}
          disabled={testing}
          className="flex-1 py-2.5 border border-indigo-600 text-indigo-600 hover:bg-indigo-50 disabled:opacity-50 text-sm font-semibold rounded-xl transition-colors"
        >
          {testing ? '测试中…' : '🔄 测试连接'}
        </button>

        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            className="px-5 py-2.5 border border-red-300 text-red-600 hover:bg-red-50 text-sm font-medium rounded-xl transition-colors"
          >
            断开
          </button>
        ) : (
          <button
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="px-5 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            {disconnecting ? '断开中…' : '确认断开'}
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function FormField({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-gray-700">
        {label}
        {required && <span className="ml-1 text-red-500">*</span>}
      </label>
      {children}
    </div>
  )
}

const INPUT_CLASS =
  'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 ' +
  'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent ' +
  'placeholder-gray-400'
