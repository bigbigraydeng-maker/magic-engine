'use client'

import { useCallback, useEffect, useId, useState } from 'react'
import type { CatalogMemberView, MembersResponse } from '@/lib/tour-catalog/catalog-contract'
import { formatDateTimeWithYear } from './catalog-format'
import { BRAND_BUTTON_CLASS } from './catalog-brand'

export const MEMBERS_INTRO =
  '只有名单里的邮箱能进这个团目录（Magic Engine 管理员除外）。对方还需要有这个客户的登录账号。'
export const MEMBERS_LOAD_ERROR = '读不到名单，请稍后再试'
export const MEMBERS_SAVE_ERROR = '没有保存成功，请稍后再试'
export const MEMBERS_BAD_EMAIL = '请填一个完整的邮箱地址'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const INPUT_CLASS =
  'rounded-lg border border-black/10 bg-white px-3 py-2 text-sm font-semibold text-me-charcoal focus:outline-none focus:ring-2 focus:ring-me-ochre/40'
const SECONDARY_BUTTON_CLASS =
  'rounded-lg border border-black/10 bg-white px-3 py-1 text-sm font-semibold text-me-charcoal hover:bg-me-ivory'
const PRIMARY_BUTTON_CLASS = `${BRAND_BUTTON_CLASS} rounded-lg px-4 py-2 text-sm font-black disabled:cursor-not-allowed disabled:opacity-40`

function membersUrl(clientId: string): string {
  return `/api/clients/${clientId}/tour-catalog/members`
}

function readMembers(body: unknown): CatalogMemberView[] | null {
  const members = (body as MembersResponse | null)?.members
  return Array.isArray(members) ? members : null
}

async function fetchMembers(clientId: string): Promise<CatalogMemberView[] | null> {
  try {
    const res = await fetch(membersUrl(clientId))
    if (!res.ok) return null
    const body = (await res.json().catch(() => ({}))) as unknown
    return readMembers(body)
  } catch {
    return null
  }
}

async function postMember(clientId: string, email: string): Promise<CatalogMemberView[] | null> {
  try {
    const res = await fetch(membersUrl(clientId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    if (!res.ok) return null
    const body = (await res.json().catch(() => ({}))) as unknown
    return readMembers(body)
  } catch {
    return null
  }
}

async function deleteMember(clientId: string, email: string): Promise<CatalogMemberView[] | null> {
  try {
    const res = await fetch(`${membersUrl(clientId)}?email=${encodeURIComponent(email)}`, {
      method: 'DELETE',
    })
    if (!res.ok) return null
    const body = (await res.json().catch(() => ({}))) as unknown
    return readMembers(body)
  } catch {
    return null
  }
}

function MemberRow(props: { member: CatalogMemberView; onRemove: (email: string) => void; busy: boolean }) {
  const { member, onRemove, busy } = props
  return (
    <li
      data-testid={`member-${member.email}`}
      className="flex flex-wrap items-start justify-between gap-3 border-b border-black/5 py-3 last:border-b-0"
    >
      <div className="min-w-0 flex-1">
        <p className="break-all font-black text-me-charcoal">{member.email}</p>
        <p className="text-xs text-me-charcoal/55">
          由 {member.grantedBy} 加入 · {formatDateTimeWithYear(member.createdAt)}
        </p>
        {member.hasLogin === false ? (
          <span className="mt-1 inline-block rounded-lg border border-[#B45309]/30 bg-[#B45309]/10 px-2 py-0.5 text-xs font-black text-[#B45309]">
            还没有这个客户的登录账号——先在客户主页「设置 → 用户权限」里给他开通，再让他登录
          </span>
        ) : null}
      </div>
      <button
        type="button"
        className={SECONDARY_BUTTON_CLASS}
        aria-label={`把 ${member.email} 移出名单`}
        disabled={busy}
        onClick={() => onRemove(member.email)}
      >
        移出
      </button>
    </li>
  )
}

function useMembers(clientId: string) {
  const [members, setMembers] = useState<CatalogMemberView[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  const load = useCallback(async () => {
    setLoadFailed(false)
    setMembers(null)
    const list = await fetchMembers(clientId)
    if (list) {
      setMembers(list)
    } else {
      setLoadFailed(true)
    }
  }, [clientId])

  useEffect(() => {
    void load()
  }, [load])

  return { members, setMembers, loadFailed, load }
}

function useAddMember(clientId: string, setMembers: (list: CatalogMemberView[]) => void, reload: () => Promise<void>) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = useCallback(async () => {
    const trimmed = email.trim().toLowerCase()
    if (!EMAIL_PATTERN.test(trimmed)) {
      setError(MEMBERS_BAD_EMAIL)
      return
    }
    setError(null)
    setBusy(true)
    const list = await postMember(clientId, trimmed)
    if (list) {
      setMembers(list)
      setEmail('')
    } else {
      setError(MEMBERS_SAVE_ERROR)
    }
    setBusy(false)
  }, [clientId, email, setMembers])

  return { email, setEmail, error, setError, busy, submit }
}

function useRemoveMember(clientId: string, setMembers: (list: CatalogMemberView[]) => void, reload: () => Promise<void>) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const remove = useCallback(
    async (target: string) => {
      const confirmed = window.confirm(
        `确定把 ${target} 移出名单吗？移出后对方就进不了这个团目录。`,
      )
      if (!confirmed) return
      setError(null)
      setBusy(true)
      const list = await deleteMember(clientId, target)
      if (list) {
        setMembers(list)
      } else {
        setError(MEMBERS_SAVE_ERROR)
      }
      setBusy(false)
    },
    [clientId, setMembers],
  )

  return { error, setError, busy, remove }
}

function MembersBody(props: {
  members: CatalogMemberView[] | null
  loadFailed: boolean
  onRetry: () => void
  onRemove: (email: string) => void
  busy: boolean
}) {
  const { members, loadFailed, onRetry, onRemove, busy } = props
  if (loadFailed) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p role="alert" className="text-sm font-semibold text-[#C2453A]">
          {MEMBERS_LOAD_ERROR}
        </p>
        <button type="button" className={SECONDARY_BUTTON_CLASS} onClick={onRetry}>
          重试
        </button>
      </div>
    )
  }
  if (members === null) {
    return <p className="text-sm text-me-charcoal/55">加载中…</p>
  }
  if (members.length === 0) {
    return <p className="text-sm text-me-charcoal/55">名单还是空的：现在只有 Magic Engine 管理员能进。</p>
  }
  return (
    <ul>
      {members.map(member => (
        <MemberRow key={member.email} member={member} onRemove={onRemove} busy={busy} />
      ))}
    </ul>
  )
}

function AddMemberForm(props: {
  email: string
  onEmail: (value: string) => void
  onSubmit: () => void
  busy: boolean
  /** Why the last "add" did not go through; shown right under the input it is about. */
  error: string | null
}) {
  const inputId = useId()
  return (
    <div className="mt-5 flex flex-wrap items-start gap-3">
      <div className="min-w-0 flex-1">
        <label htmlFor={inputId} className="block text-sm font-semibold text-me-charcoal">
          邮箱
        </label>
        <input
          id={inputId}
          type="email"
          className={`mt-1 w-full ${INPUT_CLASS}`}
          value={props.email}
          onChange={event => props.onEmail(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              props.onSubmit()
            }
          }}
        />
        {props.error ? (
          <p role="alert" className="mt-1 text-sm font-semibold text-[#C2453A]">
            {props.error}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        className={`mt-6 ${PRIMARY_BUTTON_CLASS}`}
        disabled={props.busy}
        onClick={props.onSubmit}
      >
        加入名单
      </button>
    </div>
  )
}

export function CatalogMembersCard(props: { clientId: string }): JSX.Element {
  const { clientId } = props
  const { members, setMembers, loadFailed, load } = useMembers(clientId)
  const add = useAddMember(clientId, setMembers, load)
  const remove = useRemoveMember(clientId, setMembers, load)
  const error = remove.error
  const busy = add.busy || remove.busy

  return (
    <section className="rounded-xl border border-black/10 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-black text-me-charcoal">谁可以用团目录</h2>
      <p className="mt-1 text-sm text-me-charcoal/55">{MEMBERS_INTRO}</p>

      {error ? (
        <p role="alert" className="mt-3 text-sm font-semibold text-[#C2453A]">
          {error}
        </p>
      ) : null}

      <div className="mt-4">
        <MembersBody
          members={members}
          loadFailed={loadFailed}
          onRetry={() => void load()}
          onRemove={target => void remove.remove(target)}
          busy={busy}
        />
      </div>

      <AddMemberForm
        email={add.email}
        onEmail={add.setEmail}
        onSubmit={() => void add.submit()}
        busy={busy}
        error={add.error}
      />
    </section>
  )
}
