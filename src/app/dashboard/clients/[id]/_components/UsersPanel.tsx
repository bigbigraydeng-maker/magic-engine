'use client'

import { useState, useEffect, useCallback } from 'react'

interface ClientUser {
  id: string
  email: string
  display_name: string
  access_type: 'portal' | 'dashboard' | 'both'
  created_at: string
}

const ACCESS_LABELS: Record<string, { label: string; desc: string; color: string }> = {
  portal:    { label: 'Portal 只读', desc: '只能查看客户 Portal',          color: 'bg-blue-50 text-blue-700 border-blue-200' },
  dashboard: { label: 'Dashboard',   desc: '可访问后台内容板、社媒矩阵',    color: 'bg-me-ochre/10 text-me-ochre border-me-ochre/30' },
  both:      { label: '全部权限',    desc: 'Portal + Dashboard 均可访问',  color: 'bg-purple-50 text-purple-700 border-purple-200' },
}

export function UsersPanel({ clientId }: { clientId: string }) {
  const [users, setUsers] = useState<ClientUser[]>([])
  const [loading, setLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [accessType, setAccessType] = useState<'portal' | 'dashboard' | 'both'>('dashboard')
  const [adding, setAdding] = useState(false)
  const [msg, setMsg] = useState('')
  const [deletingEmail, setDeletingEmail] = useState<string | null>(null)

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/users`)
      const json = await res.json()
      setUsers(json.users ?? [])
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    setAdding(true)
    setMsg('')
    try {
      const res = await fetch(`/api/clients/${clientId}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, display_name: displayName, access_type: accessType }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setUsers(prev => {
        const exists = prev.find(u => u.email === json.user.email)
        return exists
          ? prev.map(u => u.email === json.user.email ? json.user : u)
          : [...prev, json.user]
      })
      setEmail('')
      setDisplayName('')
      setMsg('✓ 已添加')
    } catch (err) {
      setMsg(`✗ ${(err as Error).message}`)
    } finally {
      setAdding(false)
    }
  }

  const handleDelete = async (targetEmail: string) => {
    setDeletingEmail(targetEmail)
    try {
      const res = await fetch(`/api/clients/${clientId}/users`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: targetEmail }),
      })
      const json = await res.json()
      if (!json.success) throw new Error(json.error)
      setUsers(prev => prev.filter(u => u.email !== targetEmail))
    } catch (err) {
      setMsg(`✗ ${(err as Error).message}`)
    } finally {
      setDeletingEmail(null)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-me-charcoal/90">用户访问权限</h3>
        <p className="text-xs text-me-charcoal/55 mt-0.5">管理哪些邮箱可以访问该客户的 Portal 或后台内容板</p>
      </div>

      {/* User list */}
      <div className="space-y-2">
        {loading ? (
          <p className="text-sm text-me-charcoal/45 py-4 text-center">加载中…</p>
        ) : users.length === 0 ? (
          <div className="rounded-xl border border-dashed border-black/10 py-8 text-center text-sm text-me-charcoal/45">
            暂无授权用户
          </div>
        ) : (
          users.map(u => {
            const badge = ACCESS_LABELS[u.access_type]
            return (
              <div key={u.id} className="flex items-center justify-between gap-3 bg-me-ivory rounded-xl px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-me-charcoal/90 truncate">{u.email}</p>
                  {u.display_name && (
                    <p className="text-xs text-me-charcoal/45">{u.display_name}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`text-xs font-medium border rounded-full px-2.5 py-0.5 ${badge.color}`}>
                    {badge.label}
                  </span>
                  <button
                    onClick={() => handleDelete(u.email)}
                    disabled={deletingEmail === u.email}
                    className="text-xs text-[#C2453A] hover:text-[#C2453A] disabled:opacity-40 px-2 py-1 rounded-lg hover:bg-[#C2453A]/10 transition-colors"
                  >
                    {deletingEmail === u.email ? '…' : '移除'}
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Add user form */}
      <form onSubmit={handleAdd} className="rounded-xl border border-black/10 bg-white p-4 space-y-3">
        <p className="text-xs font-semibold text-me-charcoal/75 uppercase tracking-wider">添加用户</p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-me-charcoal/55 mb-1">邮箱 *</label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="client@example.com"
              className="w-full border border-black/15 rounded-lg px-3 py-2 text-sm text-me-charcoal/90 focus:outline-none focus:ring-2 focus:ring-me-ochre"
            />
          </div>
          <div>
            <label className="block text-xs text-me-charcoal/55 mb-1">显示名称</label>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="例：New Asian Marketing"
              className="w-full border border-black/15 rounded-lg px-3 py-2 text-sm text-me-charcoal/90 focus:outline-none focus:ring-2 focus:ring-me-ochre"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs text-me-charcoal/55 mb-1">访问权限 *</label>
          <div className="grid grid-cols-3 gap-2">
            {(Object.entries(ACCESS_LABELS) as [string, typeof ACCESS_LABELS[string]][]).map(([key, cfg]) => (
              <button
                key={key}
                type="button"
                onClick={() => setAccessType(key as typeof accessType)}
                className={`text-left rounded-lg border p-2.5 transition-colors ${
                  accessType === key
                    ? `${cfg.color} border-current`
                    : 'border-black/10 hover:border-black/15 text-me-charcoal/60'
                }`}
              >
                <p className="text-xs font-semibold">{cfg.label}</p>
                <p className="text-[10px] mt-0.5 opacity-75">{cfg.desc}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={adding}
            className="bg-me-ochre hover:bg-me-ochre/90 text-white text-sm px-5 py-2 rounded-lg font-medium disabled:opacity-50 transition-colors"
          >
            {adding ? '添加中…' : '+ 添加用户'}
          </button>
          {msg && (
            <span className={`text-xs ${msg.startsWith('✓') ? 'text-[#5C8A4A]' : 'text-[#C2453A]'}`}>
              {msg}
            </span>
          )}
        </div>
      </form>
    </div>
  )
}
