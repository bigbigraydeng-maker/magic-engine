'use client'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { ErrorBox, errorText, postJson, type Distributor } from './shared'

interface NewDistributorFormProps {
  approved: Distributor[]
  onCreated: () => void
}

export function NewDistributorForm({ approved, onCreated }: NewDistributorFormProps) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [parentId, setParentId] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr('')
    if (!name.trim()) {
      setErr('请填写名字')
      return
    }
    setBusy(true)
    const body: Record<string, string> = { display_name: name.trim() }
    if (email.trim()) body.contact_email = email.trim()
    if (phone.trim()) body.contact_phone = phone.trim()
    if (parentId) body.parent_id = parentId
    const res = await postJson<{ distributor: Distributor }>('/api/admin/distributors', body)
    setBusy(false)
    if (!res.ok) {
      setErr(errorText(res.err))
      return
    }
    setName('')
    setEmail('')
    setPhone('')
    setParentId('')
    onCreated()
  }

  return (
    <form onSubmit={submit}>
      <ErrorBox message={err} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-bold uppercase tracking-wide text-me-charcoal/55">名字</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-black/[0.1] px-3 py-2 text-sm text-me-charcoal/90"
          />
        </label>
        <label className="block">
          <span className="text-xs font-bold uppercase tracking-wide text-me-charcoal/55">邮箱</span>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-lg border border-black/[0.1] px-3 py-2 text-sm text-me-charcoal/90"
          />
        </label>
        <label className="block">
          <span className="text-xs font-bold uppercase tracking-wide text-me-charcoal/55">电话</span>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="mt-1 w-full rounded-lg border border-black/[0.1] px-3 py-2 text-sm text-me-charcoal/90"
          />
        </label>
        <label className="block">
          <span className="text-xs font-bold uppercase tracking-wide text-me-charcoal/55">上线</span>
          <select
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-black/[0.1] px-3 py-2 text-sm text-me-charcoal/90"
          >
            <option value="">没有上线</option>
            {approved.map((d) => (
              <option key={d.id} value={d.id}>
                {d.display_name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button
        type="submit"
        disabled={busy}
        className="mt-4 rounded-lg bg-me-ochre px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
      >
        新增（待审批）
      </button>
    </form>
  )
}
