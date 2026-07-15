# Voice Agent — Runbook

## Processes

- **Web + API** (Next.js, Render `web`): webhooks, admin API, dashboard — **and, by
  default, the realtime link itself**. The `/api/voice/webhooks/openai` route opens the
  OpenAI realtime WebSocket **in-process** (the web service is a persistent `next start`
  Node server, so the fire-and-forget ws lives on the event loop). **No separate worker
  service is required for MVP.** Trade-off: a web redeploy drops in-flight calls.
- **Realtime worker (optional, for scale)** (`scripts/voice/realtime-worker.ts`): a
  persistent process that offloads the ws from the web service. Deploy it as a Render
  **private service** and set `REALTIME_WORKER_URL` (+ matching `INTERNAL_WORKER_TOKEN`)
  on the web service to its internal URL; the webhook then dispatches to it instead of
  running in-process. Health: `GET /health/live`, `/health/ready`. Listens on `PORT`.

## Outbound safety (hard rules)

- `OUTBOUND_CALLING_ENABLED=false` by default → only `VOICE_TEST_NUMBERS` may be
  dialled, and only via the mock provider. Dialling any other number is **rejected**.
- All dialling goes through `assertOutboundAllowed` (`src/lib/voice/outbound-gate.ts`)
  — the single non-bypassable gate: E.164, do_not_call, consent, suppression,
  quiet hours (tenant-local), frequency cap.
- To go live to real numbers: set `OUTBOUND_CALLING_ENABLED=true` **and** ensure the
  4 pre-flight gates below are green.

## Pre-flight before any REAL customer call (板桥 hard gates)

1. **AI self-discloses** in the greeting (enforced by prompt compiler; `ai_disclosure_required=true`).
2. **Price / availability / promises** never invented — knowledge + human handoff only.
3. **Cross-tenant isolation verified** — a tenant cannot read another's brain/docs/leads.
4. **Callbacks + transfer targets have a human who answers** — check the callback queue
   and `voice_agents.transfer_targets` whitelist point to a staffed number.

## Finalize / summary recovery

- Each call ends → `finalizeCall` (idempotent via `claimCallForFinalize`).
- Failed summaries: `voice_calls.summary_status='failed'`. Re-run finalize (it re-claims
  `pending|failed`). A cron/sweep should scan `summary_status IN ('pending','failed')`
  and stale `status='in_progress'` calls (worker crash recovery).

## Common error codes (spec §18)

`ROUTE_NOT_FOUND`, `WEBHOOK_SIGNATURE_INVALID`, `OPENAI_ACCEPT_FAILED`,
`TOOL_TIMEOUT`, `KNOWLEDGE_NOT_READY`, `TRANSFER_NOT_CONFIGURED`,
`OUTBOUND_BLOCKED`, `SUMMARY_FAILED`.

## Data model note

Simulated calls carry `provider='mock'` + `is_simulated=true`; the dashboard and any
attribution should filter these out of real reporting (`includeSimulated=false`).
