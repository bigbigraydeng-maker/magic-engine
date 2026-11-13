/**
 * Issue confirm cards after a prescription is approved.
 * A failure here is returned to the caller and never fails the approval.
 */

import type { NextRequest } from 'next/server'
import type { CardClicker } from '@/lib/confirmation-card/actor'
import { clickerFromSession } from '@/lib/confirmation-card/actor'
import type { ClientAccessResult } from '@/lib/auth/client-access'
import { issueCardsAfterPrescriptionApproval } from '@/lib/ads/prescription-approve-cards'
import { APPROVE_CARD_LIFETIME, type ActionCardReport } from '@/lib/ads/prescription-action-cards'

type Approver = Extract<ClientAccessResult, { ok: true }>

export async function actionCardsAfterApproval(
  req: NextRequest,
  clientId: string,
  prescriptionId: string,
  access: Approver,
  row: { version?: unknown; content?: unknown },
): Promise<ActionCardReport> {
  try {
    return await issueCardsAfterPrescriptionApproval({
      clientId,
      prescriptionId,
      version: typeof row.version === 'number' ? row.version : 0,
      content: row.content,
      clicker: approverClicker(req, clientId, access),
    })
  } catch (error) {
    console.warn('[prescription PATCH] action cards failed', error instanceof Error ? error.name : 'error')
    return {
      wroteMeta: false,
      lifetime: APPROVE_CARD_LIFETIME,
      items: [{
        key: `${prescriptionId}:-1:action_list`,
        index: -1,
        type: 'action_list',
        status: 'failed',
        reason: '出确认卡失败，处方仍然算同意，没有改广告。',
        runId: null,
        wroteMeta: false,
      }],
    }
  }
}

function approverClicker(req: NextRequest, clientId: string, access: Approver): CardClicker {
  return clickerFromSession({
    email: access.user.email ?? '',
    role: access.role,
    allowedClientId: access.allowedClientId,
    clientId,
    agentMarked: req.headers.get('x-me-actor') === 'agent',
  })
}
