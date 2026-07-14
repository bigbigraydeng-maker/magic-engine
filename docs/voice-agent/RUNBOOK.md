# Voice Agent — Runbook

## Processes

- **Web + API** (Next.js, Render `web`): webhooks, admin API, dashboard.
- **Realtime worker** (`scripts/voice/realtime-worker.ts`): a **persistent** Node
  process that holds the OpenAI realtime control WebSocket per call. Must run on
  Render/Fly/Railway as a **`worker`** service — never a serverless function that
  dies after ~30s. Health: `GET /health/live`, `/health/ready`.

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
