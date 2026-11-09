'use client'
import { useState, type FormEvent } from 'react'
import type { TermsSection } from '@/lib/distributor/terms'

interface ApplyFormProps {
  terms: TermsSection[]
  termsVersion: string
  initialReferralCode: string | null
}

const inputClass = 'block w-full rounded-lg border border-black/[0.1] bg-white px-3 py-2 text-sm'

export function ApplyForm({ terms, termsVersion, initialReferralCode }: ApplyFormProps) {
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [region, setRegion] = useState('')
  const [note, setNote] = useState('')
  const [referralCode, setReferralCode] = useState(initialReferralCode ?? '')
  const [website, setWebsite] = useState('')
  const [accepted, setAccepted] = useState(false)
  const [status, setStatus] = useState<'idle' | 'sending' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!accepted) {
      setError('请先阅读并勾选同意经销商条款')
      return
    }
    setError(null)
    setStatus('sending')
    try {
      const res = await fetch('/api/partner/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          display_name: displayName,
          contact_email: email,
          contact_phone: phone,
          region,
          note,
          referral_code: referralCode,
          accept_terms: accepted,
          terms_version: termsVersion,
          website,
        }),
      })
      if (res.status === 201) {
        setStatus('done')
        return
      }
      const json: unknown = await res.json().catch(() => null)
      const message =
        json !== null && typeof json === 'object' && 'error' in json && typeof json.error === 'string'
          ? json.error
          : '提交失败，请稍后再试'
      setError(message)
      setStatus('idle')
    } catch {
      setError('网络出错了，请稍后再试')
      setStatus('idle')
    }
  }

  if (status === 'done') {
    return (
      <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
        <div className="px-6 py-8">
          <h2 className="text-base font-bold text-me-charcoal/90">申请已收到</h2>
          <p className="mt-3 text-sm text-me-charcoal/75">
            谢谢！我们会逐份审核，审核后用你留的邮箱或电话联系你。审核通过后你会收到一条登录经销商后台的链接。
          </p>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
        <div className="border-b border-black/[0.06] px-6 py-4">
          <h2 className="text-base font-bold text-me-charcoal/90">经销商条款</h2>
        </div>
        <div className="space-y-5 px-6 py-5">
          {terms.map((section) => (
            <div key={section.title}>
              <h3 className="mb-2 text-sm font-bold text-me-charcoal/90">{section.title}</h3>
              <ul className="list-disc pl-5 space-y-1 text-sm text-me-charcoal/75">
                {section.points.map((point, i) => (
                  <li key={i}>{point}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-8 overflow-hidden rounded-2xl bg-white shadow-sm">
        <div className="border-b border-black/[0.06] px-6 py-4">
          <h2 className="text-base font-bold text-me-charcoal/90">填写申请</h2>
        </div>
        <div className="px-6 py-5">
          <form onSubmit={submit} noValidate className="relative space-y-4">
            <div>
              <label className="block text-sm font-medium text-me-charcoal/80">
                名字 *
                <input
                  type="text"
                  className={`mt-1 ${inputClass}`}
                  maxLength={100}
                  autoComplete="name"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium text-me-charcoal/80">
                邮箱 *
                <input
                  type="email"
                  className={`mt-1 ${inputClass}`}
                  maxLength={254}
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium text-me-charcoal/80">
                电话 *
                <input
                  type="tel"
                  className={`mt-1 ${inputClass}`}
                  maxLength={30}
                  autoComplete="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium text-me-charcoal/80">
                所在城市
                <input
                  type="text"
                  className={`mt-1 ${inputClass}`}
                  maxLength={100}
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                />
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium text-me-charcoal/80">
                推荐码（介绍你的人给的 8 位码，没有就留空）
                <input
                  type="text"
                  className={`mt-1 uppercase ${inputClass}`}
                  maxLength={12}
                  value={referralCode}
                  onChange={(e) => setReferralCode(e.target.value)}
                />
              </label>
            </div>

            <div>
              <label className="block text-sm font-medium text-me-charcoal/80">
                想跟我们说的话（你现在做什么、打算怎么推荐给客户）
                <textarea
                  className={`mt-1 ${inputClass}`}
                  rows={4}
                  maxLength={1000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
            </div>

            <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
              <label>
                网站
                <input
                  name="website"
                  tabIndex={-1}
                  autoComplete="off"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                />
              </label>
            </div>

            <label className="flex items-start gap-2 text-sm text-me-charcoal/80">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
              />
              <span>我已阅读并同意上面的经销商条款</span>
            </label>

            <button
              type="submit"
              disabled={status === 'sending' || !accepted}
              className="rounded-lg bg-me-ochre px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              {status === 'sending' ? '提交中…' : '提交申请'}
            </button>

            {error !== null && (
              <p role="alert" className="mt-3 text-sm font-medium text-[#C2453A]">
                {error}
              </p>
            )}
          </form>
        </div>
      </div>
    </>
  )
}
