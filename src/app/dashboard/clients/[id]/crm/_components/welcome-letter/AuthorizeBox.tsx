'use client'

/**
 * 「授权」：先预览（不写任何东西），看清楚从什么时候起、到什么时候止、会不会替换现在生效的那份，再点「确认授权」。
 * 批的是页面上这一版：提案和信的指纹一起交上去，服务端对不上就拒。不管成没成，之后都重新读一次页面状态。
 * 替换生效中的授权时，默认往前回补 35 小时：旧授权下已经进来、还没轮到发的新客人不会被漏掉。
 */
import { useState } from 'react'
import { MeButton } from '@/components/ui/me-primitives'
import { postCommand } from './api'
import { errorText, nzTime, warningText, type Notice, type ProposalView } from './welcome-letter-text'

interface Preview {
  trial: boolean
  trial_recipients: string[] | null
  live_from: string
  backfill_hours: number
  expires_at: string
  daily_cap: number
  replaces_authorization_id: string | null
  warnings: string[]
}

const BACKFILL_CHOICES = [
  { hours: 0, label: '只算点「确认」之后进来的' },
  { hours: 24, label: '再往前补 24 小时' },
  { hours: 35, label: '再往前补 35 小时（最多）' },
]
const EXPIRY_CHOICES = [90, 30, 7]

function PreviewList({ preview }: { preview: Preview }): JSX.Element {
  const recipients = preview.trial_recipients ?? []
  return (
    <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-me-charcoal" data-testid="authorize-preview">
      <li>
        {preview.trial
          ? `这是试跑：只发给这 ${recipients.length} 个地址：${recipients.join('、')}。`
          : '这是正式名单。这一版只发内部邮箱的试跑：批了也一封都不发（要等「正式名单真发」那张单上线）。'}
      </li>
      <li>
        {preview.trial ? '' : '等正式名单真发上线后：'}从你点「确认授权」那一刻{preview.backfill_hours > 0 ? `往前 ${preview.backfill_hours} 小时` : ''}起进来的新客人才会收到
        （按现在点的话大约是 {nzTime(preview.live_from)} 起）；每天最多 {preview.daily_cap} 封。
      </li>
      <li>有效到 {nzTime(preview.expires_at)} 前后，到期自动停。</li>
      {preview.replaces_authorization_id !== null && <li>批准后，现在生效的那份授权会被替换（先停旧的，再开新的）。</li>}
      {preview.warnings.map((w) => <li key={w} className="font-semibold text-[#C2453A]">{warningText(w)}</li>)}
    </ul>
  )
}

export function AuthorizeBox({
  clientId,
  proposal,
  replacing,
  onDone,
}: {
  clientId: string
  proposal: ProposalView
  replacing: boolean
  onDone: (notice: Notice) => void
}): JSX.Element {
  const [backfill, setBackfill] = useState(replacing ? 35 : 0)
  const [expiry, setExpiry] = useState(proposal.trial ? 7 : 90)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)

  const send = async (confirm: boolean) => {
    setBusy(true)
    const answer = await postCommand(clientId, 'authorize', {
      authorization_id: proposal.record.id,
      rule_sha256: proposal.record.rule_sha256,
      template_sha256: proposal.record.template_sha256,
      backfill_hours: backfill,
      expires_in_days: expiry,
      confirm,
    })
    setBusy(false)
    if (answer.ok && !confirm) {
      setPreview((answer.body?.preview ?? null) as Preview | null)
      return
    }
    setPreview(null)
    // Whatever happened, the page is read again: an old authorization may have been stopped on the way.
    onDone(
      answer.ok
        ? { tone: 'ok', text: '已授权。真发还要 Render 上两个开关都打开；开关没开之前只演练。' }
        : { tone: 'bad', text: errorText(answer.body) },
    )
  }

  return (
    <div className="mt-3 border-l-2 border-me-charcoal/25 py-1 pl-3" data-testid="authorize-box">
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-me-charcoal/70">从哪些新客人开始</span>
          <select className="rounded border border-me-charcoal/20 px-2 py-1" value={backfill} disabled={busy} onChange={(e) => { setBackfill(Number(e.target.value)); setPreview(null) }}>
            {BACKFILL_CHOICES.map((c) => <option key={c.hours} value={c.hours}>{c.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-me-charcoal/70">有效几天</span>
          <select className="rounded border border-me-charcoal/20 px-2 py-1" value={expiry} disabled={busy} onChange={(e) => { setExpiry(Number(e.target.value)); setPreview(null) }}>
            {EXPIRY_CHOICES.map((d) => <option key={d} value={d}>{d} 天</option>)}
          </select>
        </label>
      </div>
      {preview !== null && <PreviewList preview={preview} />}
      <div className="mt-3 flex flex-wrap gap-2">
        <MeButton variant="ghost" size="sm" disabled={busy} onClick={() => void send(false)}>预览授权</MeButton>
        <MeButton variant="secondary" size="sm" disabled={busy || preview === null} onClick={() => void send(true)}>确认授权</MeButton>
      </div>
    </div>
  )
}
