'use client'

/**
 * 「欢迎信自动发送」：PM 在这一页看清楚再操作——
 *  ① 现在生效的授权（状态、规则大白话、有效期；「撤销」= 紧急刹车）
 *  ② 最近发送（真发的每封信：状态、原因、时间；「结果不明」的 PM 本人核对后标「已发出 / 没发出」）
 *  ③ 待批的提案（规则大白话、信长什么样、彩排连续几天一致、为什么还不能批；「授权」先预览再确认）
 *  ④ 真发前要准备好的东西（只显示有没有，不显示任何密钥）
 *  高级：提交新提案
 * 只有全局管理员能看能点；别人看到一句「只有管理员能看」。这一页本身不发信。这一版只发内部邮箱的试跑。
 */
import { useCallback, useEffect, useState } from 'react'
import { MeButton, MePill } from '@/components/ui/me-primitives'
import { fetchStatus } from './api'
import { AuthorizeBox } from './AuthorizeBox'
import { ProposeBox } from './ProposeBox'
import { RecentSends } from './RecentSends'
import { RehearsalTable } from './RehearsalTable'
import { RevokeButton } from './RevokeButton'
import {
  errorText,
  FORMAL_PROPOSAL_NOTE,
  nzTime,
  problemText,
  stateText,
  TRIAL_FOLLOWUP_NOTE,
  TRIAL_ONLY_NOTE,
  warningText,
  type AuthorizationView,
  type Notice,
  type ProposalView,
  type StatusPayload,
  type TemplateViewData,
} from './welcome-letter-text'

function Section({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }): JSX.Element {
  return (
    <section className="mb-4 rounded-xl border border-me-charcoal/10 bg-me-ivory/40 p-3" data-testid={testId}>
      <h2 className="mb-2 text-[13px] font-black text-me-charcoal/70">{title}</h2>
      {children}
    </section>
  )
}

function Summary({ lines }: { lines: string[] | null }): JSX.Element {
  if (lines === null) return <p className="text-sm text-[#C2453A]">规则读不懂。</p>
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm text-me-charcoal">
      {lines.map((l) => <li key={l}>{l}</li>)}
    </ul>
  )
}

function Letter({ template }: { template: TemplateViewData }): JSX.Element {
  if (template.subject === null || template.body === null) return <p className="text-sm text-[#C2453A]">读不到模板「{template.key}」。</p>
  return (
    <div className="mt-2 border-l-2 border-me-charcoal/25 pl-3 py-1 text-sm" data-testid="letter">
      <p className="text-xs text-me-charcoal/60">模板「{template.key}」第 {template.version} 版{template.check === 'ok' ? '' : '（不能自动发）'}</p>
      <p className="mt-1 font-semibold">{template.subject}</p>
      <pre className="mt-1 whitespace-pre-wrap font-sans text-me-charcoal/90">{template.body}</pre>
      <p className="mt-1 text-xs text-me-charcoal/60">{'{{first_name}}'} 发的时候换成客人的名字。</p>
    </div>
  )
}

interface AuthorizationProps {
  clientId: string
  auth: AuthorizationView | null
  /** A proposal for the real list is open (the rehearsal compares against it while the trial runs). */
  formalProposalOpen: boolean
  onDone: (notice: Notice) => void
}

function AuthorizationSection({ clientId, auth, formalProposalOpen, onDone }: AuthorizationProps): JSX.Element {
  if (auth === null) return <Section title="① 现在生效的授权" testId="authorization"><p className="text-sm text-me-charcoal/70">还没有生效的授权：不会自动发欢迎信。</p></Section>
  const r = auth.record
  return (
    <Section title="① 现在生效的授权" testId="authorization">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <MePill tone={auth.state === 'active' ? 'track' : 'rej'}>{stateText(auth.state)}</MePill>
        {auth.trial && <MePill tone="sched">试跑</MePill>}
      </div>
      <p className="mb-2 text-xs text-me-charcoal/60">
        {r.authorized_by_email ?? '—'} 在 {nzTime(r.authorized_at)} 批准；{nzTime(r.live_from)} 之后进来的新客人才会收到；有效到 {nzTime(r.expires_at)}。
      </p>
      <Summary lines={auth.summary} />
      {auth.trial && !formalProposalOpen && <p className="mt-2 text-sm text-me-charcoal/80" data-testid="trial-followup">{TRIAL_FOLLOWUP_NOTE}</p>}
      <div className="mt-3"><RevokeButton clientId={clientId} id={r.id} label="撤销授权" doneText="已撤销授权：从下一封信起就停。" onDone={onDone} /></div>
    </Section>
  )
}

interface ProposalProps {
  clientId: string
  proposal: ProposalView | null
  canAuthorize: boolean
  replacing: boolean
  onDone: (notice: Notice) => void
}

function AuthorizeOrWhyNot({ clientId, proposal, canAuthorize, replacing, onDone }: ProposalProps & { proposal: ProposalView }): JSX.Element {
  if (proposal.problem !== null) {
    return <p className="mt-3 rounded-lg bg-[rgba(194,69,58,.08)] p-2 text-sm text-[#C2453A]" data-testid="proposal-problem">{problemText(proposal.problem)}</p>
  }
  if (!canAuthorize) {
    return <p className="mt-3 text-sm text-me-charcoal/70" data-testid="not-approver">这份提案可以授权，但你不在授权人名单里，或名单还没设好（看下面④）：只有 PM 本人能点「授权」。</p>
  }
  return <AuthorizeBox clientId={clientId} proposal={proposal} replacing={replacing} onDone={onDone} />
}

function ProposalSection(props: ProposalProps): JSX.Element {
  const { clientId, proposal, onDone } = props
  if (proposal === null) return <Section title="③ 待批的提案" testId="proposal"><p className="text-sm text-me-charcoal/70">现在没有待批的提案。</p></Section>
  const r = proposal.record
  return (
    <Section title="③ 待批的提案" testId="proposal">
      <p className="mb-2 text-xs text-me-charcoal/60">{r.proposed_by_email} 在 {nzTime(r.proposed_at)} 提交。提案不是授权，提交了也不会发信。</p>
      {!proposal.trial && <p className="mb-2 text-sm font-semibold text-[#9A6B12]" data-testid="formal-proposal-note">{FORMAL_PROPOSAL_NOTE}</p>}
      <Summary lines={proposal.summary} />
      {proposal.template !== null && <Letter template={proposal.template} />}
      <div className="mt-3">
        {proposal.rehearsal !== null ? (
          <RehearsalTable clientId={clientId} evidence={proposal.rehearsal} />
        ) : (
          <p className="text-sm text-me-charcoal/70">{proposal.trial ? '这是只发内部邮箱的试跑，不需要彩排对照。' : '暂时读不到彩排对照。'}</p>
        )}
      </div>
      {proposal.warnings.map((w) => <p key={w} className="mt-2 text-sm font-semibold text-[#C2453A]">{warningText(w)}</p>)}
      <AuthorizeOrWhyNot {...props} proposal={proposal} />
      <div className="mt-3"><RevokeButton clientId={clientId} id={r.id} label="撤下提案" doneText="已撤下提案（彩排会停到新提案交上为止）。" onDone={onDone} /></div>
    </Section>
  )
}

function Prerequisites({ data, mode }: { data: StatusPayload['prerequisites']; mode: StatusPayload['mode'] }): JSX.Element {
  const row = (ok: boolean, text: string) => (
    <li key={text} className="flex items-start gap-2 text-sm">
      <span className={ok ? 'text-[#3F6B33]' : 'text-[#C2453A]'}>{ok ? '✓' : '✗'}</span>
      <span>{text}</span>
    </li>
  )
  return (
    <Section title="④ 真发之前要准备好的" testId="prerequisites">
      <ul className="space-y-1">
        {row(mode === 'live', mode === 'live' ? '真发开关：已打开（Render 上两个开关都开着）' : '真发开关：关着，只演练、不会真发（要你在 Render 打开两个开关并重新部署）')}
        {data != null && row(data.account_key, `发信账号「${data.account}」的钥匙已放进 Render`)}
        {data != null && row(data.unsubscribe_secret, '一键退订链接的签名密钥已放进 Render')}
        {data != null && row(data.app_url === true, '站点地址已设好（信里的退订链接要指向 ME 自己的网址，必须是 https）')}
        {data != null && row(data.events, '系统的事件通道配好了（授权要靠它留回执）')}
        {data != null && row(data.trial_domains, '已设好哪些邮箱算内部邮箱（只发内部邮箱的试跑要用）')}
        {data != null && row(data.approvers === true, '已设好授权人名单（只放 PM 本人；他也要在管理员名单里）')}
      </ul>
      <p className="mt-2 text-xs text-me-charcoal/60">这里只显示有没有，不显示任何密钥。每封信的送达、退信、投诉能不能记回来，要在只发内部邮箱的试跑里实测。</p>
    </Section>
  )
}

export function WelcomeLetterPanel({ clientId }: { clientId: string }): JSX.Element {
  const [status, setStatus] = useState<StatusPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [reloadFailed, setReloadFailed] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const next: StatusPayload = await fetchStatus(clientId).catch(() => ({ success: false, error: 'INTERNAL_ERROR' }))
    // A failed reload keeps the last good page (and says so) instead of hiding it, the notice and the brake.
    setStatus((previous) => (next.success || previous === null || !previous.success ? next : previous))
    setReloadFailed(!next.success)
    setLoading(false)
  }, [clientId])

  useEffect(() => {
    void load()
  }, [load])

  /** After any command, whatever its outcome: say what happened and read the page again. */
  const after = useCallback(
    (n: Notice) => {
      setNotice(n)
      void load()
    },
    [load],
  )

  const header = (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <div>
        <h1 className="font-display text-lg font-semibold">欢迎信自动发送</h1>
        <p className="text-xs text-me-charcoal/60">新客人留资后第二天早上自动发一封欢迎信。看清楚再授权；撤销从下一封起生效。</p>
        <p className="mt-1 text-xs font-semibold text-me-charcoal/80" data-testid="trial-only-note">{TRIAL_ONLY_NOTE}</p>
      </div>
      <MeButton variant="ghost" size="sm" disabled={loading} onClick={() => void load()}>刷新</MeButton>
    </div>
  )

  const noticeLine =
    notice === null ? null : (
      <p className={`mb-4 rounded-lg p-2 text-sm ${notice.tone === 'ok' ? 'bg-[rgba(92,138,74,.10)] text-[#3F6B33]' : 'bg-[rgba(194,69,58,.08)] font-semibold text-[#C2453A]'}`} role="status" data-testid="notice">
        {notice.text}
      </p>
    )

  if (status === null) return <main className="p-4">{header}{noticeLine}<p className="text-sm text-me-charcoal/60">正在读取…</p></main>
  if (!status.success) return <main className="p-4">{header}{noticeLine}<p className="text-sm font-semibold text-[#C2453A]">{errorText(status)}</p></main>
  if (status.can_manage !== true) return <main className="p-4">{header}<p className="text-sm text-me-charcoal/70">只有管理员能看这一页。</p></main>

  return (
    <main className="p-4" data-testid="welcome-letter-panel">
      {header}
      {noticeLine}
      {reloadFailed && <p className="mb-4 text-sm font-semibold text-[#C2453A]" data-testid="reload-failed">刚才刷新没成功，下面是上一次读到的内容；请再点「刷新」。</p>}
      <AuthorizationSection
        clientId={clientId}
        auth={status.authorization ?? null}
        formalProposalOpen={status.proposal?.trial === false}
        onDone={after}
      />
      <RecentSends
        clientId={clientId}
        rows={status.recent_sends ?? null}
        limit={status.recent_sends_limit ?? 20}
        canResolve={status.can_authorize === true}
        onDone={after}
      />
      <ProposalSection
        clientId={clientId}
        proposal={status.proposal ?? null}
        canAuthorize={status.can_authorize === true}
        replacing={(status.authorization ?? null) !== null}
        onDone={after}
      />
      <Prerequisites data={status.prerequisites ?? null} mode={status.mode} />
      <ProposeBox clientId={clientId} onDone={after} />
    </main>
  )
}
