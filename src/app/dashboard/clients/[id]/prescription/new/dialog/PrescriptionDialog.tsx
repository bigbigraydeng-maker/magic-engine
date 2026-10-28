'use client'

import { useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useClientAdCurrency } from '@/lib/ads/use-client-ad-currency'
import type { ClientKind } from '@/types/diagnostic'
import { PrescriberLine, PrescriptionReviewActions, PrescriptionStatusNotice } from '../review-actions'
import { decideTurn, type GoalChoice, type TurnDecision } from './decide-turn'
import { DraftCard } from './DraftCard'
import { humanJobError, progressLabel, publicProgressNote } from './copy'
import { CHAT_NOTE, approveActionsVisible } from './present'
import { loadPrescriptionDialog, type DialogPrescription } from './load-dialog'
import { pollSettled, type FollowResult } from './follow-job'
import { requestGenerate, requestRefine } from './request-prescription'

interface Turn { role: 'user' | 'huatuo'; text: string }

export function PrescriptionDialog({
  clientId,
  prescriptionId,
  goalId,
  supplementOf,
  reviseOf,
}: {
  clientId: string
  prescriptionId: string | null
  goalId: string | null
  supplementOf: string | null
  reviseOf: string | null
}) {
  const currency = useClientAdCurrency(clientId)
  const model = useDialogModel({ clientId, prescriptionId, goalId, supplementOf, reviseOf, currency })
  return (
    <div className="min-h-screen bg-[#f6f7f2]">
      <DialogHeader clientId={clientId} />
      <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-8 px-4 py-6">
        <ChatStage model={model} />
        {model.loading
          ? <LoadingPlan progress={model.progress} />
          : <PlanBody clientId={clientId} model={model} />}
      </div>
    </div>
  )
}

function DialogHeader({ clientId }: { clientId: string }) {
  return (
    <header className="border-b border-black/10 bg-white px-4 py-3">
      <div className="mx-auto flex max-w-3xl items-center gap-3">
        <Link href={`/dashboard/clients/${clientId}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-me-charcoal/70 hover:text-me-charcoal">返回</Link>
        <div>
          <h1 className="text-lg font-black text-me-charcoal">处方</h1>
          <p className="text-xs text-me-charcoal/50">跟华佗说要开的方，或要改的地方</p>
        </div>
      </div>
    </header>
  )
}

function ChatStage({ model }: { model: DialogModel }) {
  return (
    <section className="min-w-0">
      <ChatTurns turns={model.turns} />
      <Composer model={model} />
      <p className="mt-3 text-xs leading-5 text-me-charcoal/70">{CHAT_NOTE}</p>
    </section>
  )
}

function LoadingPlan({ progress }: { progress: string }) {
  return (
    <div>
      <p role="status" className="text-sm font-semibold text-me-charcoal">{progress}</p>
      <p className="mt-2 text-sm text-me-charcoal/80">正在打开处方</p>
    </div>
  )
}

function PlanBody({ clientId, model }: { clientId: string; model: DialogModel }) {
  const prescription = model.prescription
  const approveShown = approveActionsVisible(prescription?.status ?? null, Boolean(prescription?.content))
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <p role="status" className="text-sm font-semibold text-me-charcoal">{model.progress}</p>
      {prescription && <PrescriberLine agentName={prescription.agentName} manual={prescription.manual} />}
      {prescription && (
        <PrescriptionStatusNotice status={prescription.status} manual={prescription.manual} approveShown={approveShown} />
      )}
      <AgreeRow clientId={clientId} model={model} />
      <DraftCard
        content={prescription?.content ?? null}
        intake={prescription?.intake ?? null}
        selfGrade={prescription?.selfGrade ?? null}
        problem={model.problem}
        status={prescription?.status ?? null}
        effectCard={prescription?.effectCard ?? null}
      />
    </div>
  )
}

function AgreeRow({ clientId, model }: { clientId: string; model: DialogModel }) {
  const prescription = model.prescription
  if (approveActionsVisible(prescription?.status ?? null, Boolean(prescription?.content))) {
    return (
      <PrescriptionReviewActions
        onApprove={() => void model.approve()}
        onReject={() => void model.reject()}
        isApproving={model.approving}
      />
    )
  }
  if (prescription?.status !== 'approved') return null
  return (
    <p className="text-sm text-me-charcoal/80">
      <Link className="font-semibold text-me-ochre" href={`/dashboard/clients/${clientId}/execution`}>去看执行进度</Link>
    </p>
  )
}

function Composer({ model }: { model: DialogModel }) {
  return (
    <form onSubmit={model.onSubmit} className="rounded-3xl border border-black/10 bg-white p-4 shadow-sm sm:p-5">
      <label className="block min-w-0 text-base font-semibold text-me-charcoal">
        跟华佗说
        <textarea
          value={model.draft}
          onChange={(event) => model.setDraft(event.target.value)}
          rows={6}
          placeholder={placeholder(model.prescription?.status ?? null)}
          className="mt-3 min-h-40 w-full resize-y rounded-2xl border border-black/10 bg-[#f6f7f2] px-4 py-4 text-base font-normal leading-7 text-me-charcoal outline-none focus-visible:ring-2 focus-visible:ring-me-charcoal/40"
        />
      </label>
      <div className="mt-3 flex justify-end">
        <button type="submit" disabled={model.writing || !model.draft.trim()} className="min-h-11 rounded-full bg-me-charcoal px-6 text-sm font-semibold text-white disabled:opacity-40">
          发送
        </button>
      </div>
    </form>
  )
}

function ChatTurns({ turns }: { turns: Turn[] }) {
  if (turns.length === 0) return null
  return (
    <ol className="mb-5 space-y-4">
      {turns.map((turn, index) => (
        <li key={`${turn.role}-${index}`} className={turn.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
          <p className={bubbleClass(turn.role)}>{turn.text}</p>
        </li>
      ))}
    </ol>
  )
}

function bubbleClass(role: Turn['role']): string {
  const shared = 'max-w-[85%] whitespace-pre-wrap break-words px-4 py-3 text-sm leading-6'
  if (role === 'user') return `${shared} rounded-3xl rounded-br-md bg-me-charcoal text-white`
  return `${shared} rounded-3xl rounded-bl-md border border-black/10 bg-white text-me-charcoal`
}

function placeholder(status: string | null): string {
  if (status === 'approved') return '要再开一版，就说「再开一版」，并写上每月预算'
  if (status === 'draft') return '说说要改哪里'
  return '说说要开什么方，并写上每月预算'
}

function useDialogModel(input: {
  clientId: string
  prescriptionId: string | null
  goalId: string | null
  supplementOf: string | null
  reviseOf: string | null
  currency: string | null
}) {
  const loaded = useLoadedDialog(input)
  const chat = useChat(input, loaded)
  return {
    ...loaded,
    ...chat,
    progress: progressLabel(loaded.prescription?.status ?? null, chat.writing),
    problem: problemText(loaded.prescription),
  }
}

function useLoadedDialog(input: {
  clientId: string
  prescriptionId: string | null
  goalId: string | null
  supplementOf: string | null
  reviseOf: string | null
}) {
  const [loading, setLoading] = useState(true)
  const [discoveryId, setDiscoveryId] = useState<string | null>(null)
  const [goals, setGoals] = useState<GoalChoice[]>([])
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(input.goalId)
  const [prescription, setPrescription] = useState<DialogPrescription | null>(null)
  const [prior, setPrior] = useState({ supplementOf: input.supplementOf, reviseOf: input.reviseOf })
  const [clientKind, setClientKind] = useState<ClientKind>('standard')

  useEffect(() => {
    let cancelled = false
    void loadPrescriptionDialog({
      clientId: input.clientId,
      prescriptionId: input.prescriptionId,
      goalId: input.goalId,
      skipLatest: Boolean(input.supplementOf || input.reviseOf) && !input.prescriptionId,
    }).then((result) => {
      if (cancelled) return
      setDiscoveryId(result.discoveryId)
      setGoals(result.goals)
      setClientKind(result.clientKind)
      setSelectedGoalId(input.goalId ?? (result.goals.length === 1 ? result.goals[0].id : null))
      setPrescription(result.prescription)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [input.clientId, input.prescriptionId, input.goalId, input.supplementOf, input.reviseOf])

  useGeneratingPoll(input.clientId, prescription, setPrescription)

  return {
    loading, discoveryId, goals, clientKind, selectedGoalId, setSelectedGoalId, prescription, setPrescription, prior, setPrior,
  }
}

function useGeneratingPoll(
  clientId: string,
  prescription: DialogPrescription | null,
  setPrescription: SetPrescription,
) {
  const prescriptionId = prescription?.status === 'generating' ? prescription.id : null
  useEffect(() => {
    if (!prescriptionId) return
    let cancelled = false
    void pollSettled({
      clientId,
      prescriptionId,
      fetchImpl: fetch,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => Date.now(),
      isCancelled: () => cancelled,
      onProgress: (note) => setPrescription((current) => current ? { ...current, progressNote: note } : current),
    }).then((result) => {
      if (!cancelled) applyFollow(result, setPrescription)
    })
    return () => { cancelled = true }
  }, [clientId, prescriptionId, setPrescription])
}

function useChat(input: { clientId: string; currency: string | null }, loaded: ReturnType<typeof useLoadedDialog>) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const [writing, setWriting] = useState(false)
  const [approving, setApproving] = useState(false)
  const [waitingFor, setWaitingFor] = useState<'budget' | 'goal' | 'shoot' | null>(null)
  const [pendingShoot, setPendingShoot] = useState<number | null>(null)
  const [pendingGoal, setPendingGoal] = useState<string | null>(null)
  const [pendingBudget, setPendingBudget] = useState<number | null>(null)
  const reply = (text: string) => setTurns((prev) => [...prev, { role: 'huatuo', text }])

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text || writing) return
    setDraft('')
    setTurns((prev) => [...prev, { role: 'user', text }])
    const decision = decideTurn(decisionInput(text, input.currency, loaded, { writing, waitingFor, pendingGoal, pendingBudget, pendingShoot }))
    void applyDecision(decision, { input, loaded, reply, setWriting, setWaitingFor, setPendingGoal, setPendingBudget, setPendingShoot })
  }

  return { turns, draft, setDraft, writing, approving, onSubmit, approve: () => patchStatus(loaded, input.clientId, 'approved', setApproving, reply), reject: () => rejectDraft(loaded, input.clientId, reply) }
}

function decisionInput(
  text: string,
  _currency: string | null,
  loaded: ReturnType<typeof useLoadedDialog>,
  chat: {
    writing: boolean
    waitingFor: 'budget' | 'goal' | 'shoot' | null
    pendingGoal: string | null
    pendingBudget: number | null
    pendingShoot: number | null
  },
) {
  return {
    text,
    prescriptionStatus: loaded.prescription?.status ?? null,
    prescriptionId: loaded.prescription?.id ?? null,
    discoveryReady: Boolean(loaded.discoveryId),
    goals: loaded.goals,
    selectedGoalId: loaded.selectedGoalId,
    pendingGoal: chat.pendingGoal,
    pendingBudget: chat.pendingBudget,
    pendingShoot: chat.pendingShoot,
    clientKind: loaded.clientKind,
    waitingFor: chat.waitingFor,
    supplementOf: loaded.prior.supplementOf,
    reviseOf: loaded.prior.reviseOf,
    writing: chat.writing,
  }
}

async function applyDecision(decision: TurnDecision, ctx: {
  input: { clientId: string; currency: string | null }
  loaded: ReturnType<typeof useLoadedDialog>
  reply: (text: string) => void
  setWriting: (value: boolean) => void
  setWaitingFor: (value: 'budget' | 'goal' | 'shoot' | null) => void
  setPendingShoot: (value: number | null) => void
  setPendingGoal: (value: string | null) => void
  setPendingBudget: (value: number | null) => void
}) {
  if (decision.kind === 'say' || decision.kind === 'ask') {
    ctx.reply(decision.text)
    if (decision.kind === 'ask') {
      ctx.setWaitingFor(decision.waitingFor)
      ctx.setPendingGoal(decision.businessGoal)
      ctx.setPendingBudget(decision.budget)
      ctx.setPendingShoot(decision.shoot ?? null)
    }
    return
  }
  await runJob(decision, ctx)
}

async function runJob(decision: Exclude<TurnDecision, { kind: 'say' | 'ask' }>, ctx: DecisionCtx) {
  ctx.setWriting(true)
  ctx.setWaitingFor(null)
  const result = await callJob(decision, ctx)
  ctx.setWriting(false)
  if (!result.ok) {
    ctx.reply(result.error ? humanJobError(result.error) : '这次没写成。请换一句再说。')
    return
  }
  const next = followedToDialog(result, ctx.loaded.prescription)
  if (decision.kind === 'generate') {
    next.intake = intakeFrom(decision, ctx.input.currency)
    ctx.loaded.setSelectedGoalId(decision.goalId)
    ctx.loaded.setPrior({ supplementOf: null, reviseOf: null })
  }
  ctx.loaded.setPrescription(next)
  ctx.reply(decision.kind === 'refine' ? '已按你的话改了一版。' : '这版写好了，看上面的卡片。合适就点同意。')
}

function progressHandlers(setPrescription: (value: DialogPrescription | null | ((current: DialogPrescription | null) => DialogPrescription | null)) => void) {
  return {
    onProgress: (note: string | null) => {
      const shown = publicProgressNote(note)
      setPrescription((current) => current ? { ...current, progressNote: shown } : current)
    },
  }
}

type SetPrescription = (value: DialogPrescription | null | ((current: DialogPrescription | null) => DialogPrescription | null)) => void

function applyFollow(result: FollowResult, setPrescription: SetPrescription) {
  if (!result.ok) {
    // Cancelled polls carry an empty error; keep the page as it is.
    if (!result.error) return
    setPrescription((current) => current ? { ...current, status: 'failed', errorMessage: result.error, progressNote: null } : current)
    return
  }
  setPrescription((current) => followedToDialog(result, current))
}

function followedToDialog(result: Extract<FollowResult, { ok: true }>, previous: DialogPrescription | null): DialogPrescription {
  return {
    id: result.prescriptionId,
    status: result.status || 'draft',
    content: result.content,
    progressNote: result.progressNote,
    errorMessage: null,
    agentName: result.agentName ?? previous?.agentName ?? null,
    selfGrade: result.selfGrade,
    intake: previous?.intake ?? null,
    manual: false,
    effectCard: result.effectCard,
  }
}

async function patchStatus(
  loaded: ReturnType<typeof useLoadedDialog>,
  clientId: string,
  status: 'approved' | 'rejected',
  setApproving: (value: boolean) => void,
  reply: (text: string) => void,
): Promise<boolean> {
  if (!loaded.prescription) return false
  setApproving(true)
  try {
    const saved = await postStatus(clientId, loaded.prescription.id, status)
    if (!saved.ok) {
      reply('这次没记上。请再点一次。')
      return false
    }
    if (status === 'approved') {
      loaded.setPrescription({ ...loaded.prescription, status: 'approved' })
      reply(saved.planText ? `已记下同意。这一步不是开始花钱。${saved.planText}` : '已记下同意。这一步不是开始花钱。')
    }
    return true
  } finally {
    setApproving(false)
  }
}

async function planTextOf(res: Response): Promise<string | null> {
  try {
    const body = await res.json() as { plan_approval?: { text?: unknown } } | null
    const text = body?.plan_approval?.text
    return typeof text === 'string' && text !== '' ? text : null
  } catch {
    return null
  }
}

async function postStatus(
  clientId: string,
  prescriptionId: string,
  status: 'approved' | 'rejected',
): Promise<{ ok: boolean; planText: string | null }> {
  try {
    const res = await fetch(`/api/clients/${clientId}/prescription/${prescriptionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, rejection_note: status === 'rejected' ? '用户要求重新生成' : undefined }),
    })
    // The plan result rides on the same reply; a bad body just means no extra line.
    return { ok: res.ok || res.status === 409, planText: res.ok ? await planTextOf(res) : null }
  } catch {
    return { ok: false, planText: null }
  }
}

async function rejectDraft(
  loaded: ReturnType<typeof useLoadedDialog>,
  clientId: string,
  reply: (text: string) => void,
) {
  const ok = await patchStatus(loaded, clientId, 'rejected', () => undefined, reply)
  if (!ok) return
  loaded.setPrescription(null)
  reply('这版先不采用。可以直接再说一句话重开。')
}

function problemText(prescription: DialogPrescription | null): string | null {
  if (!prescription) return null
  if (prescription.content) return null
  if (prescription.status === 'failed') return humanJobError(prescription.errorMessage || '这版没写成。')
  if (prescription.status === 'generating') return publicProgressNote(prescription.progressNote) || '华佗正在写，写完会出现在这里。'
  return null
}

type DialogModel = ReturnType<typeof useDialogModel>
type DecisionCtx = Parameters<typeof applyDecision>[1]

async function callJob(decision: Exclude<TurnDecision, { kind: 'say' | 'ask' }>, ctx: DecisionCtx): Promise<FollowResult> {
  const handlers = progressHandlers(ctx.loaded.setPrescription)
  if (decision.kind === 'refine') {
    return requestRefine({
      clientId: ctx.input.clientId,
      prescriptionId: ctx.loaded.prescription?.id ?? '',
      comments: decision.comments,
      handlers,
    })
  }
  return requestGenerate({
    clientId: ctx.input.clientId,
    currency: ctx.input.currency,
    discoveryId: ctx.loaded.discoveryId,
    businessGoal: decision.businessGoal,
    budget: decision.budget,
    urgency: decision.urgency,
    dimensions: decision.dimensions,
    goalId: decision.goalId,
    clientKind: decision.clientKind,
    weeklyShoot: decision.weeklyShoot,
    mode: decision.mode,
    priorId: decision.priorId,
    handlers,
  })
}

function intakeFrom(decision: Extract<TurnDecision, { kind: 'generate' }>, currency: string | null): DialogPrescription['intake'] {
  return {
    business_goal: decision.businessGoal,
    timeline_urgency: decision.urgency,
    monthly_budget_aud: decision.budget,
    budget_currency: currency,
    priority_dimensions: decision.dimensions,
    notes: null,
    client_kind: decision.clientKind,
    weekly_shoot_count: decision.weeklyShoot,
  }
}
