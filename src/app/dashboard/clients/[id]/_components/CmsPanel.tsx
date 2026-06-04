'use client'

/**
 * CmsPanel — Website CMS Connector configuration UI.
 *
 * Rendered inside SettingsDrawer under the '🔗 网站连接' tab.
 *
 * Phase 14.A.3: multi-provider entry point — FDE picks GitHub, WordPress, or
 * (coming soon) Shopify and manages credentials per-provider on the same
 * `cms_connections` table.
 *
 * Security: tokens / app passwords are POSTed once over HTTPS and never stored
 * in React state after submit; status endpoints only ever return the last-four
 * character hint.
 */

import { useState, useEffect, useCallback } from 'react'
import type {
  CmsConnectionStatus,
  WordpressConnectionStatus,
  CmsContentTarget,
  CmsContentTargetSyntax,
} from '@/lib/cms/vocabulary'
import {
  CMS_CONTENT_TARGET_SYNTAX,
} from '@/lib/cms/vocabulary'

interface Props {
  clientId: string
}

type ProviderTab = 'github' | 'wordpress' | 'shopify'

const PROVIDER_TABS: { id: ProviderTab; label: string; soon?: boolean }[] = [
  { id: 'github',    label: 'GitHub' },
  { id: 'wordpress', label: 'WordPress' },
  { id: 'shopify',   label: 'Shopify', soon: true },
]

export function CmsPanel({ clientId }: Props) {
  const [activeProvider, setActiveProvider] = useState<ProviderTab>('github')

  return (
    <div className="space-y-5">
      {/* Provider tabs */}
      <div className="flex items-center gap-1 border-b border-black/10">
        {PROVIDER_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveProvider(tab.id)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeProvider === tab.id
                ? 'border-me-ochre text-me-ochre'
                : 'border-transparent text-me-charcoal/55 hover:text-me-charcoal/75'
            }`}
          >
            {tab.label}
            {tab.soon && (
              <span className="ml-1.5 text-[10px] text-me-charcoal/45 font-normal">即将推出</span>
            )}
          </button>
        ))}
      </div>

      {activeProvider === 'github'    && <GithubProviderPanel    clientId={clientId} />}
      {activeProvider === 'wordpress' && <WordpressProviderPanel clientId={clientId} />}
      {activeProvider === 'shopify'   && <ShopifyComingSoonPanel />}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// GitHub provider (existing flow — unchanged behavior, just lifted into its
// own panel so the same drawer can switch between providers)
// ════════════════════════════════════════════════════════════════════════════

type GithubPanelState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'disconnected' }
  | { phase: 'connected'; status: CmsConnectionStatus }

function GithubProviderPanel({ clientId }: { clientId: string }) {
  const [state, setState]       = useState<GithubPanelState>({ phase: 'loading' })
  const [formOpen, setFormOpen] = useState(false)

  const fetchStatus = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const res  = await fetch(`/api/clients/${clientId}/cms/status`)
      const json = await res.json() as { success: boolean; data: CmsConnectionStatus | null; error?: string }
      if (!json.success) throw new Error(json.error ?? 'Failed to load status')
      setState(json.data
        ? { phase: 'connected', status: json.data }
        : { phase: 'disconnected' })
    } catch (err) {
      setState({ phase: 'error', message: err instanceof Error ? err.message : 'Load failed' })
    }
  }, [clientId])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  if (state.phase === 'loading') return <LoadingRow />
  if (state.phase === 'error')   return <ErrorRow message={state.message} onRetry={fetchStatus} />

  if (state.phase === 'connected') {
    return (
      <GithubConnectedView
        clientId={clientId}
        status={state.status}
        onRefresh={fetchStatus}
        onDisconnect={() => setState({ phase: 'disconnected' })}
      />
    )
  }

  return (
    <div className="space-y-5">
      <GithubIntroCard />
      {formOpen ? (
        <GithubConnectForm
          clientId={clientId}
          onConnected={(s) => setState({ phase: 'connected', status: s })}
          onCancel={() => setFormOpen(false)}
        />
      ) : (
        <button
          onClick={() => setFormOpen(true)}
          className="w-full py-3 bg-me-ochre hover:bg-me-ochre/90 text-white text-sm font-semibold rounded-xl transition-colors"
        >
          🔗 连接 GitHub 仓库
        </button>
      )}
    </div>
  )
}

function GithubIntroCard() {
  return (
    <div className="rounded-xl bg-me-ochre/10 border border-me-ochre/30 p-5 space-y-2">
      <p className="text-sm font-semibold text-me-ochre">GitHub CMS 连接器</p>
      <p className="text-sm text-me-ochre leading-relaxed">
        连接客户 GitHub 仓库后，Magic Engine 可以自动将 SEO 修复（标题、描述）
        作为 Pull Request 提交到仓库。只需合并 PR，网站即刻更新。
      </p>
      <ul className="text-xs text-me-ochre space-y-1 mt-2">
        <li>✓ 无需手动编辑代码文件</li>
        <li>✓ 每次修复都有独立 PR，可审查可回滚</li>
        <li>✓ PAT 加密存储，从不明文出现在日志中</li>
      </ul>
    </div>
  )
}

interface GithubConnectFormProps {
  clientId:    string
  onConnected: (s: CmsConnectionStatus) => void
  onCancel:    () => void
}

function GithubConnectForm({ clientId, onConnected, onCancel }: GithubConnectFormProps) {
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

    const paths = contentPaths.split('\n').map(p => p.trim()).filter(Boolean)

    try {
      const res  = await fetch(`/api/clients/${clientId}/cms/connect`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
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
      {error && <ErrorBanner message={error} />}

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
            onChange={e => {
              let val = e.target.value
              if (val.includes('github.com/')) val = val.split('/').filter(Boolean).pop() ?? val
              setRepoName(val)
            }}
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
        <p className="mt-1 text-xs text-me-charcoal/45">
          需要 <code>contents:write</code> + <code>pull_requests:write</code> 权限。
          PAT 加密后存储，不会明文出现在日志中。
        </p>
      </FormField>

      <FormActions saving={saving} onCancel={onCancel} />
    </form>
  )
}

interface GithubConnectedViewProps {
  clientId:     string
  status:       CmsConnectionStatus
  onRefresh:    () => void
  onDisconnect: () => void
}

function GithubConnectedView({ clientId, status, onRefresh, onDisconnect }: GithubConnectedViewProps) {
  const [testing,       setTesting]       = useState(false)
  const [testResult,    setTestResult]    = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const res  = await fetch(`/api/clients/${clientId}/cms/test`, {
        method: 'POST',
      })
      const json = await res.json() as { success: boolean; error?: string }
      setTestResult(json.success ? '✅ 连接成功 — 仓库可访问' : `❌ ${json.error ?? '连接失败'}`)
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
        method: 'DELETE',
      })
      onDisconnect()
    } catch {
      setDisconnecting(false)
      setConfirmDelete(false)
    }
  }

  return (
    <div className="space-y-5">
      <StatusBadge status={status.status} />

      <InfoTable
        rows={[
          { label: '仓库',          value: `${status.repoOwner}/${status.repoName}` },
          { label: '分支',          value: status.branch },
          { label: 'Token (末四位)', value: status.tokenHint ? `····${status.tokenHint}` : '—' },
          {
            label: '最后测试',
            value: status.lastTestedAt
              ? new Date(status.lastTestedAt).toLocaleString('zh-CN')
              : '从未测试',
          },
        ]}
      />

      {status.lastError && <LastErrorRow message={status.lastError} />}
      {testResult       && <TestResultRow message={testResult} />}

      <GeoContentTargetsCard
        clientId={clientId}
        initialTargets={status.contentTargets}
        onSaved={onRefresh}
      />

      <ConnectionActions
        testing={testing}
        confirmDelete={confirmDelete}
        disconnecting={disconnecting}
        onTest={handleTest}
        onConfirmDeleteRequest={() => setConfirmDelete(true)}
        onConfirmDelete={handleDisconnect}
      />
    </div>
  )
}

// ─── B1: GEO content targets editor ──────────────────────────────────────────

interface GeoContentTargetsCardProps {
  clientId:       string
  initialTargets: CmsContentTarget[]
  onSaved:        () => void
}

function GeoContentTargetsCard({ clientId, initialTargets, onSaved }: GeoContentTargetsCardProps) {
  const [rows, setRows]       = useState<CmsContentTarget[]>(initialTargets)
  const [dirty, setDirty]     = useState(false)
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  // M1 (魏征 B1 review): sync upstream changes when the FDE hasn't started
  // editing yet. Without this, a successful save → onSaved() → fetchStatus()
  // re-renders the parent with fresh contentTargets but rows stays on the
  // stale local copy. We only re-seed when !dirty so we never silently
  // overwrite unsaved edits.
  useEffect(() => {
    if (!dirty) setRows(initialTargets)
  }, [initialTargets, dirty])

  const updateRow = (idx: number, patch: Partial<CmsContentTarget>) => {
    setRows(prev => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
    setDirty(true)
  }
  const removeRow = (idx: number) => {
    setRows(prev => prev.filter((_, i) => i !== idx))
    setDirty(true)
  }
  const addRow = () => {
    setRows(prev => [...prev, { path: '', syntax: 'html', role: 'global_head' }])
    setDirty(true)
  }

  // M2 (魏征 B1 review): never silently drop user input. If any row has a
  // blank path, abort the save and tell the FDE exactly which row, so the
  // "I added a target and it didn't save" footgun never fires.
  const handleSave = async () => {
    setError(null)
    const blankIdx = rows.findIndex(r => r.path.trim() === '')
    if (blankIdx !== -1) {
      setError(`第 ${blankIdx + 1} 行缺少路径，请填写或删除该行`)
      return
    }

    setSaving(true)
    try {
      const res  = await fetch(`/api/clients/${clientId}/cms/connect`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content_targets: rows }),
      })
      const json = await res.json() as {
        success: boolean
        error?:  string
        data?:   { contentTargets?: CmsContentTarget[] }
      }
      if (!json.success) throw new Error(json.error ?? 'Save failed')

      // M1: prefer server-canonical value so rows is always what's in the DB
      // (server normalisation could trim, dedupe, etc).
      if (json.data?.contentTargets) {
        setRows(json.data.contentTargets)
      }
      setDirty(false)
      setSavedAt(Date.now())
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border border-black/10 bg-white p-5 space-y-3">
      <div>
        <p className="text-sm font-semibold text-me-charcoal">GEO 注入目标 (Content Targets)</p>
        <p className="text-xs text-me-charcoal/60 mt-1 leading-relaxed">
          配置 GEO 指令要注入到仓库哪些模板文件的 <code className="font-mono">&lt;head&gt;</code>。
          支持纯 HTML / PHP 模板；Next.js / Vue / Astro 等组件框架暂不支持。
        </p>
        {/* M3 (魏征 B1 review): make it explicit that the publish path doesn't
            consume this yet, so PMs verifying B1 don't think the config is broken. */}
        <p className="text-xs text-me-charcoal/45 mt-2 italic">
          ⓘ 配置已保存到数据库，但当前 GEO 部署仍走旧的「独立 snippet 文件 + PR」模式。
          下一个 PR（Stage 1 升级）才会开始读取此列表，自动把 snippet 注入到指定模板里。
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg bg-me-ivory border border-dashed border-black/10 px-4 py-6 text-center">
          <p className="text-xs text-me-charcoal/55">尚未配置注入目标。GEO 部署会读取此列表决定 PR 改哪些文件。</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row, idx) => (
            <ContentTargetRow
              key={idx}
              row={row}
              onChange={patch => updateRow(idx, patch)}
              onRemove={() => removeRow(idx)}
            />
          ))}
        </div>
      )}

      <div className="flex items-center justify-between pt-1">
        <button
          type="button"
          onClick={addRow}
          className="text-xs text-me-ochre hover:underline font-medium"
        >
          + 添加目标
        </button>
        <div className="flex items-center gap-3">
          {savedAt && !dirty && (
            <span className="text-xs text-[#5C8A4A]">✓ 已保存</span>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || saving}
            className="px-3 py-1.5 text-xs font-semibold bg-me-ochre text-white rounded-lg disabled:opacity-40 hover:bg-me-ochre/90 transition-colors"
          >
            {saving ? '保存中…' : '保存目标'}
          </button>
        </div>
      </div>

      {error && (
        <div className="text-xs text-[#C2453A] bg-[#C2453A]/10 border border-[#C2453A]/30 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
    </div>
  )
}

interface ContentTargetRowProps {
  row:      CmsContentTarget
  onChange: (patch: Partial<CmsContentTarget>) => void
  onRemove: () => void
}

function ContentTargetRow({ row, onChange, onRemove }: ContentTargetRowProps) {
  return (
    <div className="grid grid-cols-12 gap-2 items-center">
      <input
        type="text"
        value={row.path}
        onChange={e => onChange({ path: e.target.value })}
        placeholder="e.g. header.php"
        className={INPUT_CLASS + ' col-span-5 font-mono text-xs'}
      />
      <select
        value={row.syntax}
        onChange={e => onChange({ syntax: e.target.value as CmsContentTargetSyntax })}
        className={INPUT_CLASS + ' col-span-2 text-xs'}
      >
        {CMS_CONTENT_TARGET_SYNTAX.map(s => (
          <option key={s} value={s}>{s.toUpperCase()}</option>
        ))}
      </select>
      <input
        type="text"
        value={row.label ?? ''}
        onChange={e => onChange({ label: e.target.value || undefined })}
        placeholder="标签 (可选)"
        className={INPUT_CLASS + ' col-span-4 text-xs'}
      />
      <button
        type="button"
        onClick={onRemove}
        className="col-span-1 text-me-charcoal/45 hover:text-[#C2453A] text-lg leading-none"
        aria-label="Remove target"
      >
        ×
      </button>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// WordPress provider (Phase 14.A.3 — new)
// ════════════════════════════════════════════════════════════════════════════

type WpPanelState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'disconnected' }
  | { phase: 'connected'; status: WordpressConnectionStatus }

function WordpressProviderPanel({ clientId }: { clientId: string }) {
  const [state, setState]       = useState<WpPanelState>({ phase: 'loading' })
  const [formOpen, setFormOpen] = useState(false)

  const fetchStatus = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const res  = await fetch(`/api/clients/${clientId}/cms/wordpress`)
      const json = await res.json() as { success: boolean; data: WordpressConnectionStatus | null; error?: string }
      if (!json.success) throw new Error(json.error ?? 'Failed to load status')
      setState(json.data
        ? { phase: 'connected', status: json.data }
        : { phase: 'disconnected' })
    } catch (err) {
      setState({ phase: 'error', message: err instanceof Error ? err.message : 'Load failed' })
    }
  }, [clientId])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  if (state.phase === 'loading') return <LoadingRow />
  if (state.phase === 'error')   return <ErrorRow message={state.message} onRetry={fetchStatus} />

  if (state.phase === 'connected') {
    return (
      <WordpressConnectedView
        clientId={clientId}
        status={state.status}
        onDisconnect={() => setState({ phase: 'disconnected' })}
      />
    )
  }

  return (
    <div className="space-y-5">
      <WordpressIntroCard />
      {formOpen ? (
        <WordpressConnectForm
          clientId={clientId}
          onConnected={(s) => setState({ phase: 'connected', status: s })}
          onCancel={() => setFormOpen(false)}
        />
      ) : (
        <button
          onClick={() => setFormOpen(true)}
          className="w-full py-3 bg-me-ochre hover:bg-me-ochre/90 text-white text-sm font-semibold rounded-xl transition-colors"
        >
          🔗 连接 WordPress 站点
        </button>
      )}
    </div>
  )
}

function WordpressIntroCard() {
  return (
    <div className="rounded-xl bg-[#5C8A4A]/10 border border-[#5C8A4A]/30 p-5 space-y-2">
      <p className="text-sm font-semibold text-[#5C8A4A]">WordPress 连接器</p>
      <p className="text-sm text-[#5C8A4A] leading-relaxed">
        连接客户 WordPress 站点后，Magic Engine 可以将博客 / 落地页以草稿（Draft）形式
        推送到站点。FDE 在 WP 后台确认预览后再发布上线，全程留痕、可审计、可回滚。
      </p>
      <ul className="text-xs text-[#5C8A4A] space-y-1 mt-2">
        <li>✓ 使用 WP 5.6+ 原生 Application Password，无需安装插件</li>
        <li>✓ 推荐为 Magic Engine 创建独立用户（最小权限）</li>
        <li>✓ Application Password 加密存储，从不明文出现在日志中</li>
        <li>✓ 默认 Draft-first，不会自动发布</li>
      </ul>
    </div>
  )
}

interface WordpressConnectFormProps {
  clientId:    string
  onConnected: (s: WordpressConnectionStatus) => void
  onCancel:    () => void
}

function WordpressConnectForm({ clientId, onConnected, onCancel }: WordpressConnectFormProps) {
  const [siteUrl,     setSiteUrl]     = useState('')
  const [username,    setUsername]    = useState('')
  const [appPassword, setAppPassword] = useState('')
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSaving(true)

    try {
      const res  = await fetch(`/api/clients/${clientId}/cms/wordpress`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          site_url:     siteUrl.trim(),
          username:     username.trim(),
          app_password: appPassword.trim(),
        }),
      })
      const json = await res.json() as { success: boolean; data?: WordpressConnectionStatus; error?: string }
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
      {error && <ErrorBanner message={error} />}

      <FormField label="站点 URL (HTTPS only)" required>
        <input
          type="url"
          value={siteUrl}
          onChange={e => setSiteUrl(e.target.value)}
          placeholder="https://example.com"
          className={INPUT_CLASS}
          required
        />
        <p className="mt-1 text-xs text-me-charcoal/45">
          必须是 HTTPS + 公网域名。请勿带路径或末尾斜杠。
        </p>
      </FormField>

      <FormField label="WordPress 用户名" required>
        <input
          value={username}
          onChange={e => setUsername(e.target.value)}
          placeholder="magic-engine"
          className={INPUT_CLASS}
          required
          autoComplete="username"
        />
        <p className="mt-1 text-xs text-me-charcoal/45">
          建议为 Magic Engine 单独创建一个低权限用户（仅 publish_posts），不要复用 admin 账号。
        </p>
      </FormField>

      <FormField label="Application Password" required>
        <input
          type="password"
          value={appPassword}
          onChange={e => setAppPassword(e.target.value)}
          placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
          className={INPUT_CLASS + ' font-mono'}
          required
          minLength={10}
          autoComplete="new-password"
        />
        <p className="mt-1 text-xs text-me-charcoal/45">
          在 WP 后台「用户 → 个人资料 → Application Passwords」中生成。
          加密存储，不会明文出现在日志或界面中。
        </p>
      </FormField>

      <FormActions saving={saving} onCancel={onCancel} />
    </form>
  )
}

interface WordpressConnectedViewProps {
  clientId:     string
  status:       WordpressConnectionStatus
  onDisconnect: () => void
}

function WordpressConnectedView({ clientId, status, onDisconnect }: WordpressConnectedViewProps) {
  const [disconnecting,  setDisconnecting]  = useState(false)
  const [confirmDelete,  setConfirmDelete]  = useState(false)
  const [testing,        setTesting]        = useState(false)
  const [testResult,     setTestResult]     = useState<string | null>(null)
  // P14.B.1: Yoast probe
  const [probing,        setProbing]        = useState(false)
  const [probeResult,    setProbeResult]    = useState<string | null>(null)
  const [yoastInstalled, setYoastInstalled] = useState(status.yoastPluginInstalled)
  // P14.B.6: default category
  const [categoryEdit,   setCategoryEdit]   = useState(false)
  const [categoryInput,  setCategoryInput]  = useState(
    status.wpDefaultCategoryId != null ? String(status.wpDefaultCategoryId) : '',
  )
  const [categorySaving, setCategorySaving] = useState(false)
  const [categoryMsg,    setCategoryMsg]    = useState<string | null>(null)

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const res  = await fetch(`/api/clients/${clientId}/cms/wordpress/test`, {
        method: 'POST',
      })
      const json = await res.json() as { success: boolean; ok: boolean; displayName?: string; error?: string }
      if (json.success && json.ok) {
        setTestResult(`✅ 连接正常${json.displayName ? ` — 用户 ${json.displayName}` : ''}`)
      } else {
        setTestResult(`❌ ${json.error ?? '连接失败'}`)
      }
    } catch {
      setTestResult('❌ 网络错误，请重试')
    } finally {
      setTesting(false)
    }
  }

  const handleDisconnect = async () => {
    setDisconnecting(true)
    try {
      await fetch(`/api/clients/${clientId}/cms/wordpress`, {
        method: 'DELETE',
      })
      onDisconnect()
    } catch {
      setDisconnecting(false)
      setConfirmDelete(false)
    }
  }

  // P14.B.1: probe Yoast meta writability
  const handleYoastProbe = async () => {
    setProbing(true)
    setProbeResult(null)
    try {
      const res  = await fetch(`/api/clients/${clientId}/cms/wordpress/yoast-probe`, { method: 'POST' })
      const json = await res.json() as { success: boolean; writable?: boolean; reason?: string; error?: string }
      if (json.success && json.writable) {
        setYoastInstalled(true)
        setProbeResult('✅ Yoast SEO 字段已注册 — 发布时将自动写入 SEO 标题/描述/焦点关键词')
      } else {
        setYoastInstalled(false)
        const hint = json.reason ? ` (${json.reason})` : ''
        setProbeResult(`❌ Yoast SEO 字段未注册${hint} — 请按下方说明安装 mu-plugin`)
      }
    } catch {
      setProbeResult('❌ 探测失败，请检查网络')
    } finally {
      setProbing(false)
    }
  }

  // P14.B.6: save default category
  const handleCategorySave = async () => {
    const raw = categoryInput.trim()
    const id  = raw === '' ? null : parseInt(raw, 10)
    if (raw !== '' && (isNaN(id!) || id! < 1)) {
      setCategoryMsg('❌ 请输入有效的分类 ID（正整数）')
      return
    }
    setCategorySaving(true)
    setCategoryMsg(null)
    try {
      const res  = await fetch(`/api/clients/${clientId}/cms/wordpress/category`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ category_id: id }),
      })
      const json = await res.json() as { success: boolean; error?: string }
      if (json.success) {
        setCategoryMsg(id ? `✅ 默认分类已设为 ID ${id}` : '✅ 已清除默认分类（使用 WP 默认）')
        setCategoryEdit(false)
      } else {
        setCategoryMsg(`❌ ${json.error ?? '保存失败'}`)
      }
    } catch {
      setCategoryMsg('❌ 网络错误，请重试')
    } finally {
      setCategorySaving(false)
    }
  }

  const YOAST_MU_PLUGIN = `<?php
// /wp-content/mu-plugins/me-yoast-rest-api.php
// Magic Engine — register Yoast SEO meta keys for REST write access.
add_action('init', function () {
    foreach (['_yoast_wpseo_title', '_yoast_wpseo_metadesc', '_yoast_wpseo_focuskw'] as $key) {
        register_meta('post', $key, [
            'single'        => true,
            'type'          => 'string',
            'show_in_rest'  => true,
            'auth_callback' => fn() => current_user_can('edit_posts'),
        ]);
    }
});`

  return (
    <div className="space-y-5">
      <StatusBadge status={status.status} />

      <InfoTable
        rows={[
          { label: '站点 URL',                    value: status.siteUrl },
          { label: '用户名',                       value: status.username },
          { label: 'Application Password (末四位)', value: status.tokenHint ? `····${status.tokenHint}` : '—' },
          {
            label: '最后测试',
            value: status.lastTestedAt
              ? new Date(status.lastTestedAt).toLocaleString('zh-CN')
              : '尚未测试',
          },
        ]}
      />

      {status.lastError && <LastErrorRow message={status.lastError} />}
      {testResult       && <TestResultRow message={testResult} />}

      <ConnectionActions
        testing={testing}
        confirmDelete={confirmDelete}
        disconnecting={disconnecting}
        onTest={handleTest}
        onConfirmDeleteRequest={() => setConfirmDelete(true)}
        onConfirmDelete={handleDisconnect}
      />

      {/* P14.B.1 — Yoast SEO Extension card */}
      <div className={`rounded-xl border p-4 space-y-3 ${yoastInstalled ? 'border-[#5C8A4A]/30 bg-[#5C8A4A]/10' : 'border-me-ochre/30 bg-me-ochre/10'}`}>
        <div className="flex items-center justify-between">
          <div>
            <p className={`text-sm font-semibold ${yoastInstalled ? 'text-[#5C8A4A]' : 'text-me-ochre'}`}>
              {yoastInstalled ? '✅ SEO 扩展已启用' : '⚠️ SEO 扩展未安装'}
            </p>
            <p className={`text-xs mt-0.5 ${yoastInstalled ? 'text-[#5C8A4A]' : 'text-me-ochre'}`}>
              {yoastInstalled
                ? '发布时将自动写入 SEO 标题、描述和焦点关键词到 Yoast。'
                : '安装 mu-plugin 后，ME 发布时可自动填写 Yoast SEO 字段。'}
            </p>
          </div>
          <button
            onClick={() => void handleYoastProbe()}
            disabled={probing}
            className="shrink-0 px-3 py-1.5 text-xs font-medium border border-current rounded-lg disabled:opacity-50 transition-colors text-me-ochre border-me-ochre/40 hover:bg-me-ochre/10"
          >
            {probing ? '检测中…' : '验证安装'}
          </button>
        </div>

        {probeResult && (
          <p className="text-xs text-me-charcoal/75 bg-white rounded-lg px-3 py-2 border border-black/10">
            {probeResult}
          </p>
        )}

        {!yoastInstalled && (
          <details className="text-xs">
            <summary className="cursor-pointer text-me-ochre font-medium hover:underline">
              查看安装说明 →
            </summary>
            <div className="mt-2 space-y-2">
              <p className="text-me-charcoal/60">
                在 WP 站点服务器上创建以下文件（mu-plugins 目录自动加载，无需激活）：
              </p>
              <p className="text-me-charcoal/60 font-medium">
                路径：<code className="bg-white px-1 rounded border border-black/10">/wp-content/mu-plugins/me-yoast-rest-api.php</code>
              </p>
              <div className="relative">
                <pre className="bg-me-charcoal/90 text-me-gold rounded-lg p-3 overflow-x-auto text-[11px] leading-relaxed whitespace-pre-wrap break-all">
                  {YOAST_MU_PLUGIN}
                </pre>
                <button
                  onClick={() => { void navigator.clipboard.writeText(YOAST_MU_PLUGIN) }}
                  className="absolute top-2 right-2 px-2 py-1 text-[10px] bg-me-charcoal/75 hover:bg-me-charcoal/60 text-me-charcoal/35 rounded"
                >
                  复制
                </button>
              </div>
              <p className="text-me-charcoal/55">
                安装后点击「验证安装」确认 Yoast SEO 字段已注册。
              </p>
            </div>
          </details>
        )}
      </div>

      {/* P14.B.6 — Default WP category */}
      <div className="rounded-xl border border-black/10 bg-me-ivory p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-me-charcoal/75">默认发布分类</p>
            <p className="text-xs text-me-charcoal/55 mt-0.5">
              {status.wpDefaultCategoryId != null
                ? `当前：ID ${status.wpDefaultCategoryId}`
                : '当前：未设置（WP 默认 — 未分类）'}
            </p>
          </div>
          {!categoryEdit && (
            <button
              onClick={() => { setCategoryEdit(true); setCategoryMsg(null) }}
              className="text-xs text-me-ochre hover:underline"
            >
              {status.wpDefaultCategoryId != null ? '修改' : '设置'}
            </button>
          )}
        </div>

        {categoryEdit && (
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              value={categoryInput}
              onChange={e => setCategoryInput(e.target.value)}
              placeholder="WP 分类 ID，留空 = 不设置"
              className="flex-1 px-3 py-1.5 border border-black/15 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-me-ochre"
            />
            <button
              onClick={() => void handleCategorySave()}
              disabled={categorySaving}
              className="px-3 py-1.5 text-xs font-semibold bg-me-ochre hover:bg-me-ochre/90 disabled:opacity-50 text-white rounded-lg"
            >
              {categorySaving ? '保存中…' : '保存'}
            </button>
            <button
              onClick={() => { setCategoryEdit(false); setCategoryMsg(null) }}
              className="px-2 py-1.5 text-xs text-me-charcoal/55 hover:text-me-charcoal/75"
            >
              取消
            </button>
          </div>
        )}

        {categoryMsg && (
          <p className="text-xs text-me-charcoal/75 bg-white rounded-lg px-3 py-2 border border-black/10">
            {categoryMsg}
          </p>
        )}

        <p className="text-xs text-me-charcoal/45">
          可在 WP 后台「文章 → 分类目录」找到分类 ID（鼠标悬停分类链接查看 tag_ID 参数）。
        </p>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Shopify (P14.A.4 — placeholder)
// ════════════════════════════════════════════════════════════════════════════

function ShopifyComingSoonPanel() {
  return (
    <div className="rounded-xl bg-me-ivory border border-black/10 p-6 text-center space-y-2">
      <p className="text-3xl">🛍️</p>
      <p className="text-sm font-semibold text-me-charcoal/75">Shopify 连接器</p>
      <p className="text-xs text-me-charcoal/55 leading-relaxed max-w-md mx-auto">
        即将上线（P14.A.4）。届时可通过 Shopify Admin API 推送博客文章和页面，
        默认 Draft-first，FDE 在 Shopify 后台确认后发布。
      </p>
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// Shared sub-components
// ════════════════════════════════════════════════════════════════════════════

function LoadingRow() {
  return (
    <div className="flex items-center justify-center py-16 gap-2 text-me-charcoal/45">
      <span className="animate-spin text-lg">⟳</span>
      <span className="text-sm">加载中…</span>
    </div>
  )
}

function ErrorRow({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-xl bg-[#C2453A]/10 border border-[#C2453A]/30 p-4 text-sm text-[#C2453A]">
      {message}
      <button onClick={onRetry} className="ml-3 underline text-[#C2453A]">重试</button>
    </div>
  )
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-lg bg-[#C2453A]/10 border border-[#C2453A]/30 px-4 py-3 text-sm text-[#C2453A]">
      {message}
    </div>
  )
}

function StatusBadge({ status }: { status: 'connected' | 'disconnected' | 'error' }) {
  const style =
    status === 'connected' ? 'bg-[#5C8A4A]/12 text-[#5C8A4A] border-[#5C8A4A]/30'
    : status === 'error'   ? 'bg-[#C2453A]/12 text-[#C2453A] border-[#C2453A]/30'
    :                        'bg-me-ivory text-me-charcoal/60 border-black/10'

  const label =
    status === 'connected' ? '已连接'
    : status === 'error'   ? '连接错误'
    :                        '未验证'

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold ${style}`}>
      <span>{status === 'connected' ? '●' : '○'}</span>
      <span>{label}</span>
    </div>
  )
}

function InfoTable({ rows }: { rows: Array<{ label: string; value: React.ReactNode }> }) {
  return (
    <div className="rounded-xl bg-me-ivory border border-black/10 divide-y divide-black/10">
      {rows.map(({ label, value }) => (
        <div key={label} className="flex items-center justify-between px-4 py-3 text-sm gap-4">
          <span className="text-me-charcoal/55 shrink-0">{label}</span>
          <span className="font-mono text-xs font-medium text-me-charcoal/90 text-right break-all">{value}</span>
        </div>
      ))}
    </div>
  )
}

function LastErrorRow({ message }: { message: string }) {
  return (
    <div className="rounded-lg bg-[#C2453A]/10 border border-[#C2453A]/30 px-4 py-3 text-xs text-[#C2453A]">
      <span className="font-semibold">错误：</span>{message}
    </div>
  )
}

function TestResultRow({ message }: { message: string }) {
  return (
    <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-800">
      {message}
    </div>
  )
}

interface ConnectionActionsProps {
  testing:                boolean
  testDisabled?:          boolean
  confirmDelete:          boolean
  disconnecting:          boolean
  onTest:                 () => void
  onConfirmDeleteRequest: () => void
  onConfirmDelete:        () => void
}

function ConnectionActions({
  testing,
  testDisabled,
  confirmDelete,
  disconnecting,
  onTest,
  onConfirmDeleteRequest,
  onConfirmDelete,
}: ConnectionActionsProps) {
  return (
    <div className="flex gap-3">
      <button
        onClick={onTest}
        disabled={testing || testDisabled}
        className="flex-1 py-2.5 border border-me-ochre text-me-ochre hover:bg-me-ochre/10 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold rounded-xl transition-colors"
        title={testDisabled ? '将随 P14.A.5 启用' : undefined}
      >
        {testing ? '测试中…' : '🔄 测试连接'}
      </button>

      {!confirmDelete ? (
        <button
          onClick={onConfirmDeleteRequest}
          className="px-5 py-2.5 border border-[#C2453A]/40 text-[#C2453A] hover:bg-[#C2453A]/10 text-sm font-medium rounded-xl transition-colors"
        >
          断开
        </button>
      ) : (
        <button
          onClick={onConfirmDelete}
          disabled={disconnecting}
          className="px-5 py-2.5 bg-[#C2453A] hover:bg-[#C2453A] disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
        >
          {disconnecting ? '断开中…' : '确认断开'}
        </button>
      )}
    </div>
  )
}

function FormActions({ saving, onCancel }: { saving: boolean; onCancel: () => void }) {
  return (
    <div className="flex gap-3 pt-2">
      <button
        type="submit"
        disabled={saving}
        className="flex-1 py-2.5 bg-me-ochre hover:bg-me-ochre/90 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
      >
        {saving ? '保存中…' : '保存连接'}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="px-5 py-2.5 border border-black/15 hover:bg-me-ivory text-sm font-medium rounded-xl transition-colors"
      >
        取消
      </button>
    </div>
  )
}

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
      <label className="text-xs font-medium text-me-charcoal/75">
        {label}
        {required && <span className="ml-1 text-[#C2453A]">*</span>}
      </label>
      {children}
    </div>
  )
}

const INPUT_CLASS =
  'w-full px-3 py-2 border border-black/15 rounded-lg text-sm text-me-charcoal/90 ' +
  'focus:outline-none focus:ring-2 focus:ring-me-ochre focus:border-transparent ' +
  'placeholder-me-charcoal/45'
