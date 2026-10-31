'use client'

/**
 * 抽屉里的客人「档案」：名字（可改）/ 昵称（各渠道上他自己的名字，只读）/ 邮箱 / 电话（可加）。
 * 设计稿：docs/specs/2026-10-22-crm-contact-profile-design-v0.md。PM：先把字段做好，以后有机会再完善。
 *
 * 读失败什么都不渲染（不在抽屉里立一块红色报错挡住别的）；写失败显示服务端给的原因。
 */

import { useEffect, useState } from 'react'

interface Profile {
  contactId: string
  name: string | null
  nicknames: Array<{ channel: string; name: string }>
  emails: Array<{ value: string; primary: boolean }>
  phones: Array<{ value: string; primary: boolean }>
}

const CHANNEL_LABEL: Record<string, string> = { whatsapp: 'WhatsApp', messenger: 'Messenger', email: '邮件' }

export function ProfileCard({ clientId, contactId, onChanged }: { clientId: string; contactId: string; onChanged?: () => void }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [failed, setFailed] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [adding, setAdding] = useState<'email' | 'phone' | null>(null)
  const [valueDraft, setValueDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const base = `/api/clients/${clientId}/crm/contacts/${contactId}/profile`

  useEffect(() => {
    // 切到另一个客人时，旧请求晚到的响应要丢掉（否则会把上一个人的档案显示在当前抽屉里）。
    let stale = false
    setProfile(null)
    setFailed(false)
    setEditingName(false)
    setAdding(null)
    setError(null)
    void (async () => {
      try {
        const res = await fetch(base)
        if (!res.ok) throw new Error('load failed')
        const json = (await res.json()) as { profile: Profile }
        if (!stale) setProfile(json.profile)
      } catch {
        if (!stale) setFailed(true)
      }
    })()
    return () => {
      stale = true
    }
  }, [base])

  if (failed || !profile) return null

  const call = async (url: string, method: string, body: unknown): Promise<boolean> => {
    if (busy) return false
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = (await res.json().catch(() => ({}))) as { error?: string; profile?: Profile }
      if (!res.ok) {
        setError(json.error ?? '没有保存成功，请稍后再试')
        return false
      }
      if (json.profile) setProfile(json.profile)
      onChanged?.()
      return true
    } catch {
      setError('网络出错，没有保存成功')
      return false
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-me-charcoal/10 bg-white px-3 py-2.5 text-[13px]" data-testid="profile-card">
      <p className="mb-1.5 text-xs font-black text-me-charcoal/55">客人档案</p>

      <div className="flex flex-wrap items-center gap-x-2">
        <span className="w-10 shrink-0 text-me-charcoal/50">名字</span>
        {editingName ? (
          <>
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              maxLength={80}
              aria-label="客人名字"
              placeholder="他的名字或昵称（不知道就留空）"
              className="min-w-0 flex-1 rounded-lg border border-me-stone px-2 py-1"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void call(base, 'PATCH', { name: nameDraft }).then((ok) => ok && setEditingName(false))}
              className="rounded-lg bg-me-charcoal px-2.5 py-1 text-xs font-bold text-white disabled:opacity-40"
            >
              保存
            </button>
            <button type="button" onClick={() => (setEditingName(false), setError(null))} className="px-1 text-xs font-bold text-me-charcoal/50">
              取消
            </button>
          </>
        ) : (
          <>
            <span className="font-semibold text-me-charcoal">{profile.name ?? '未留姓名'}</span>
            <button
              type="button"
              onClick={() => {
                setNameDraft(profile.name ?? '')
                setEditingName(true)
                setError(null)
              }}
              className="text-xs font-bold text-me-charcoal/50 underline"
            >
              改
            </button>
          </>
        )}
      </div>

      {profile.nicknames.length > 0 && (
        <div className="mt-1 flex flex-wrap items-center gap-x-2">
          <span className="w-10 shrink-0 text-me-charcoal/50">昵称</span>
          {profile.nicknames.map((n) => (
            <span key={`${n.channel}:${n.name}`} className="text-me-charcoal/75">
              {CHANNEL_LABEL[n.channel] ?? n.channel}：{n.name}
            </span>
          ))}
        </div>
      )}

      {(['email', 'phone'] as const).map((kind) => {
        const items = kind === 'email' ? profile.emails : profile.phones
        const label = kind === 'email' ? '邮箱' : '电话'
        return (
          <div key={kind} className="mt-1 flex flex-wrap items-center gap-x-2">
            <span className="w-10 shrink-0 text-me-charcoal/50">{label}</span>
            {items.length === 0 && <span className="text-me-charcoal/40">还没有</span>}
            {items.map((i) => (
              <span key={i.value} className="break-all text-me-charcoal/80">
                {i.value}
                {i.primary && items.length > 1 ? '（主）' : ''}
              </span>
            ))}
            {adding === kind ? (
              <>
                <input
                  value={valueDraft}
                  onChange={(e) => setValueDraft(e.target.value)}
                  aria-label={`新${label}`}
                  placeholder={kind === 'email' ? 'name@example.com' : '021 123 4567 或 +64…'}
                  className="min-w-0 flex-1 rounded-lg border border-me-stone px-2 py-1"
                />
                <button
                  type="button"
                  disabled={busy || valueDraft.trim() === ''}
                  onClick={() => {
                    // 加了之后，这个号码 / 邮箱以后的来电来信都会自动归到这位客人名下，而且这里没有删除入口——加之前确认一次。
                    if (!window.confirm(`确认把 ${valueDraft.trim()} 加到这位客人名下？\n加上之后，这个${label}以后的来电 / 来信都会归到他，目前不能在这里删除。`)) return
                    void call(`${base}/identities`, 'POST', { kind, value: valueDraft }).then((ok) => ok && (setAdding(null), setValueDraft('')))
                  }}
                  className="rounded-lg bg-me-charcoal px-2.5 py-1 text-xs font-bold text-white disabled:opacity-40"
                >
                  加上
                </button>
                <button type="button" onClick={() => (setAdding(null), setError(null))} className="px-1 text-xs font-bold text-me-charcoal/50">
                  取消
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setAdding(kind)
                  setValueDraft('')
                  setError(null)
                }}
                className="text-xs font-bold text-me-charcoal/50 underline"
              >
                + 加{label}
              </button>
            )}
          </div>
        )
      })}

      {error && (
        <p className="mt-1.5 text-xs font-semibold text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
