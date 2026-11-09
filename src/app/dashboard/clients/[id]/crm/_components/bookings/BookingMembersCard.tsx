'use client'

/**
 * Admin-only card that manages who may see the CRM "订单与付款" tracker.
 *
 * Non-admins (403 / feature not enabled) see nothing at all. The card mirrors
 * the visual style of the tour-catalog members card but is a separate
 * component with its own copy and API calls.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { BookingMember } from '@/lib/crm/booking-types'
import {
  addMember,
  fetchMembers,
  removeMember,
  type MembersResponse,
} from './booking-api'
import { ERROR_TEXT, INPUT_CLASS, MUTED_TEXT, PRIMARY_BUTTON, SECONDARY_BUTTON } from './booking-styles'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const LOAD_ERROR = '读不到名单，请稍后再试'
const SAVE_ERROR = '没有保存成功，请稍后再试'
const BAD_EMAIL = '请填一个完整的邮箱地址'

type LoadState =
  | { status: 'loading' }
  | { status: 'hidden' }
  | { status: 'error' }
  | { status: 'ready'; members: BookingMember[] }

function MemberRow(props: {
  member: BookingMember
  busy: boolean
  onRemove: (email: string) => void
}) {
  const { member, busy, onRemove } = props
  return (
    <li
      data-testid={`booking-member-${member.email}`}
      className="flex flex-wrap items-start justify-between gap-3 border-b border-black/5 py-3 last:border-b-0"
    >
      <div className="min-w-0 flex-1">
        <p className="break-all font-black text-me-charcoal">{member.email}</p>
        <p className={MUTED_TEXT}>{`由 ${member.grantedBy} 加入`}</p>
      </div>
      <button
        type="button"
        className={SECONDARY_BUTTON}
        aria-label={`把 ${member.email} 移出名单`}
        disabled={busy}
        onClick={() => onRemove(member.email)}
      >
        移出
      </button>
    </li>
  )
}

function AddMemberForm(props: {
  email: string
  onEmail: (value: string) => void
  onSubmit: () => void
  busy: boolean
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
          className={`mt-1 ${INPUT_CLASS}`}
          value={props.email}
          onChange={(event) => props.onEmail(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              props.onSubmit()
            }
          }}
        />
        {props.error ? (
          <p role="alert" className={`mt-1 ${ERROR_TEXT}`}>
            {props.error}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        className={`mt-6 ${PRIMARY_BUTTON}`}
        disabled={props.busy}
        onClick={props.onSubmit}
      >
        加入名单
      </button>
    </div>
  )
}

function MembersBody(props: {
  state: LoadState
  busy: boolean
  onRetry: () => void
  onRemove: (email: string) => void
}) {
  const { state, busy, onRetry, onRemove } = props
  if (state.status === 'error') {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <p role="alert" className={ERROR_TEXT}>
          {LOAD_ERROR}
        </p>
        <button type="button" className={SECONDARY_BUTTON} onClick={onRetry}>
          重试
        </button>
      </div>
    )
  }
  if (state.status !== 'ready') return null
  if (state.members.length === 0) {
    return <p className={MUTED_TEXT}>名单还是空的：现在只有 Magic Engine 管理员能用。</p>
  }
  return (
    <ul>
      {state.members.map((member) => (
        <MemberRow key={member.email} member={member} busy={busy} onRemove={onRemove} />
      ))}
    </ul>
  )
}

export function BookingMembersCard(props: { clientId: string }): JSX.Element | null {
  const { clientId } = props
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)

  const load = useCallback(async () => {
    setState({ status: 'loading' })
    const result = await fetchMembers(clientId)
    if (result.ok) {
      if (!Array.isArray(result.data.members)) {
        setState({ status: 'hidden' })
        return
      }
      setState({ status: 'ready', members: result.data.members })
    } else if (result.kind === 'hidden') {
      setState({ status: 'hidden' })
    } else {
      setState({ status: 'error' })
    }
  }, [clientId])

  useEffect(() => {
    void load()
  }, [load])

  const applyMembers = useCallback((data: MembersResponse) => {
    if (!Array.isArray(data.members)) return
    setState({ status: 'ready', members: data.members })
  }, [])

  const submit = useCallback(async () => {
    if (busy) return
    if (busyRef.current) return
    const trimmed = email.trim().toLowerCase()
    if (!EMAIL_PATTERN.test(trimmed)) {
      setError(BAD_EMAIL)
      return
    }
    setError(null)
    busyRef.current = true
    setBusy(true)
    try {
      const result = await addMember(clientId, trimmed)
      if (result.ok) {
        applyMembers(result.data)
        setEmail('')
      } else if (result.kind === 'hidden') {
        setState({ status: 'hidden' })
      } else {
        setError(result.message || SAVE_ERROR)
      }
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [applyMembers, busy, clientId, email])

  const remove = useCallback(
    async (target: string) => {
      if (busy) return
      if (busyRef.current) return
      const confirmed = window.confirm(
        `确定把 ${target} 移出名单吗？移出后对方就看不到订单与付款了。`,
      )
      if (!confirmed) return
      setError(null)
      busyRef.current = true
      setBusy(true)
      try {
        const result = await removeMember(clientId, target)
        if (result.ok) {
          applyMembers(result.data)
        } else if (result.kind === 'hidden') {
          setState({ status: 'hidden' })
        } else {
          setError(result.message || SAVE_ERROR)
        }
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    },
    [applyMembers, busy, clientId],
  )

  if (state.status === 'loading' || state.status === 'hidden') return null

  return (
    <section
      data-testid="booking-members-card"
      className="rounded-xl border border-black/10 bg-white p-5 shadow-sm"
    >
      <h2 className="text-lg font-black text-me-charcoal">谁能用付款进度</h2>
      <p className="mt-1 text-sm text-me-charcoal/70">
        只有名单里的邮箱能看到和修改「订单与付款」和「付款要催」（Magic Engine 管理员除外）。对方还需要有这个客户的登录账号。
      </p>

      {error ? (
        <p role="alert" className={`mt-3 ${ERROR_TEXT}`}>
          {error}
        </p>
      ) : null}

      <div className="mt-4">
        <MembersBody
          state={state}
          busy={busy}
          onRetry={() => void load()}
          onRemove={(target) => void remove(target)}
        />
      </div>

      <AddMemberForm
        email={email}
        onEmail={setEmail}
        onSubmit={() => void submit()}
        busy={busy}
        error={null}
      />
    </section>
  )
}
