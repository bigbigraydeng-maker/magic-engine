'use client'

import { useState, useEffect, useCallback } from 'react'

interface Client { id: string; name: string }
interface PortalUser {
  id: string
  email: string
  client_id: string
  access_type: string
  display_name: string
  created_at: string
  created_by_email: string | null
  clients: { name: string } | null
}

interface Props {
  accessType: 'portal' | 'fde'
  title: string
  description: string
  addLabel: string
}

export default function UserManagementTab({ accessType, title, description, addLabel }: Props) {
  const [users, setUsers]     = useState<PortalUser[]>([])
  const [clients, setClients] = useState<Client[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  // Form state
  const [email, setEmail]         = useState('')
  const [clientId, setClientId]   = useState('')
  const [displayName, setDisplayName] = useState('')
  const [adding, setAdding]       = useState(false)
  const [addError, setAddError]   = useState('')
  const [addNotice, setAddNotice] = useState('')

  const [passwordTarget, setPasswordTarget] = useState<PortalUser | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [passwordNotice, setPasswordNotice] = useState('')

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/users?type=${accessType}`)
      const data = await res.json() as { users?: PortalUser[]; error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Failed to load')
      setUsers(data.users ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }, [accessType])

  useEffect(() => {
    void fetchUsers()
    fetch('/api/clients')
      .then(r => r.json())
      .then((d: { clients?: Client[] }) => setClients(d.clients ?? []))
      .catch(() => {})
  }, [fetchUsers])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || !clientId) {
      setAddError('Email and client are required.')
      return
    }
    setAdding(true)
    setAddError('')
    setAddNotice('')
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), client_id: clientId, access_type: accessType, display_name: displayName.trim() }),
      })
      const data = await res.json() as { error?: string; invite?: { sent: boolean; reason?: string } }
      if (!res.ok) throw new Error(data.error ?? 'Failed to add')
      const invitee = email.trim()
      setEmail('')
      setClientId('')
      setDisplayName('')
      if (data.invite?.sent) {
        setAddNotice(`已加入并发送邀请邮件到 ${invitee}`)
      } else {
        setAddNotice(
          `已加入 ${invitee}，但邀请邮件未发出（${data.invite?.reason ?? '未知原因'}），请手工通知登录地址。`
        )
      }
      await fetchUsers()
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Failed to add user')
    } finally {
      setAdding(false)
    }
  }

  async function handleDelete(id: string, userEmail: string) {
    if (!confirm(`Remove ${userEmail}?`)) return
    try {
      const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const d = await res.json() as { error?: string }
        throw new Error(d.error ?? 'Failed to delete')
      }
      setUsers(prev => prev.filter(u => u.id !== id))
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete')
    }
  }

  function closePasswordDialog() {
    if (savingPassword) return
    setPasswordTarget(null)
    setNewPassword('')
    setConfirmPassword('')
    setPasswordError('')
    setPasswordNotice('')
  }

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault()
    if (!passwordTarget) return
    if (newPassword.length < 8 || newPassword.length > 128) {
      setPasswordError('Password must be 8–128 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match.')
      return
    }

    setSavingPassword(true)
    setPasswordError('')
    setPasswordNotice('')
    try {
      const res = await fetch('/api/admin/users/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: passwordTarget.email, password: newPassword }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Could not save password.')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordNotice('Password saved. Share it with the user through a secure channel.')
    } catch (e) {
      setPasswordError(e instanceof Error ? e.message : 'Could not save password.')
    } finally {
      setSavingPassword(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-me-charcoal/90">{title}</h2>
        <p className="text-sm text-me-charcoal/55 mt-0.5">{description}</p>
      </div>

      {/* Add form */}
      <div className="bg-white rounded-xl border border-black/10 p-5">
        <h3 className="text-sm font-semibold text-me-charcoal/75 mb-4">{addLabel}</h3>
        <form onSubmit={e => { void handleAdd(e) }} className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium text-me-charcoal/60 mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="user@company.com"
              className="w-full px-3 py-2 text-sm border border-black/15 rounded-lg focus:outline-none focus:ring-2 focus:ring-me-ochre"
            />
          </div>
          <div className="flex-1 min-w-[160px]">
            <label className="block text-xs font-medium text-me-charcoal/60 mb-1">Client</label>
            <select
              required
              value={clientId}
              onChange={e => setClientId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-black/15 rounded-lg focus:outline-none focus:ring-2 focus:ring-me-ochre bg-white"
            >
              <option value="">Select client…</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="block text-xs font-medium text-me-charcoal/60 mb-1">Display name (optional)</label>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Jane Smith"
              className="w-full px-3 py-2 text-sm border border-black/15 rounded-lg focus:outline-none focus:ring-2 focus:ring-me-ochre"
            />
          </div>
          <button
            type="submit"
            disabled={adding}
            className="px-4 py-2 text-sm font-medium bg-me-ochre hover:bg-me-ochre disabled:opacity-60 text-white rounded-lg transition-colors"
          >
            {adding ? 'Adding…' : '+ Add'}
          </button>
        </form>
        {addError && <p className="text-[#C2453A] text-xs mt-2">{addError}</p>}
        {addNotice && !addError && (
          <p className="text-me-charcoal/70 text-xs mt-2">{addNotice}</p>
        )}
      </div>

      {/* User table */}
      <div className="bg-white rounded-xl border border-black/10 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-me-charcoal/45">Loading…</div>
        ) : error ? (
          <div className="p-8 text-center text-sm text-[#C2453A]">{error}</div>
        ) : users.length === 0 ? (
          <div className="p-8 text-center text-sm text-me-charcoal/45">No users yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/[.06] bg-me-ivory">
                <th className="text-left px-4 py-3 text-xs font-semibold text-me-charcoal/55 uppercase tracking-wide">Email</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-me-charcoal/55 uppercase tracking-wide">Client</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-me-charcoal/55 uppercase tracking-wide">Display name</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-me-charcoal/55 uppercase tracking-wide">Added</th>
                <th className="px-4 py-3 text-xs font-semibold text-me-charcoal/55 uppercase tracking-wide">Password</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[.06]">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-me-ivory transition-colors">
                  <td className="px-4 py-3 text-me-charcoal/90 font-medium">{u.email}</td>
                  <td className="px-4 py-3 text-me-charcoal/60">{u.clients?.name ?? u.client_id}</td>
                  <td className="px-4 py-3 text-me-charcoal/55">{u.display_name || '—'}</td>
                  <td className="px-4 py-3 text-me-charcoal/45 text-xs whitespace-nowrap">
                    {new Date(u.created_at).toLocaleDateString('en-NZ')}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        setPasswordTarget(u)
                        setPasswordError('')
                        setPasswordNotice('')
                      }}
                      className="text-xs font-medium text-me-ochre hover:underline whitespace-nowrap"
                    >
                      Set / reset
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => { void handleDelete(u.id, u.email) }}
                      className="text-xs text-[#C2453A] hover:text-[#C2453A] hover:underline transition-colors"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {passwordTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-user-password-title"
            className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl"
          >
            <h3 id="reset-user-password-title" className="text-lg font-semibold text-me-charcoal">
              Set password for {passwordTarget.email}
            </h3>
            <p className="mt-2 text-sm leading-5 text-me-charcoal/60">
              Use at least 8 characters. The password is saved directly to the account and is not sent by email.
            </p>
            <form onSubmit={e => { void handleSetPassword(e) }} className="mt-5 space-y-3">
              <label className="block text-xs font-medium text-me-charcoal/60">
                New password
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  required
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-black/15 px-3 py-2 text-sm text-me-charcoal focus:outline-none focus:ring-2 focus:ring-me-ochre"
                />
              </label>
              <label className="block text-xs font-medium text-me-charcoal/60">
                Confirm password
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  required
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-black/15 px-3 py-2 text-sm text-me-charcoal focus:outline-none focus:ring-2 focus:ring-me-ochre"
                />
              </label>
              {passwordError && <p role="alert" className="text-sm text-[#C2453A]">{passwordError}</p>}
              {passwordNotice && <p role="status" className="text-sm text-green-700">{passwordNotice}</p>}
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={closePasswordDialog} disabled={savingPassword} className="rounded-lg border border-black/15 px-3 py-2 text-sm text-me-charcoal/70 disabled:opacity-50">
                  Close
                </button>
                <button type="submit" disabled={savingPassword} className="rounded-lg bg-me-ochre px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
                  {savingPassword ? 'Saving…' : 'Save password'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  )
}
