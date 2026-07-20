# Voice Agent — Local Setup

Multi-tenant AI phone sales/support built into the Magic Engine Next.js app. P0 runs
a full **mock closed loop** with no external services; real keys switch it to live.

## Run the mock closed loop (no keys needed)

```bash
# full inbound call: webhook → accept → greeting → knowledge → lead → callback → summary
npx tsx scripts/voice/simulate-openai-call.ts

# outbound (sandbox test number, compliance gate enforced)
npx tsx scripts/voice/simulate-openai-call.ts --outbound

# knowledge search + cross-tenant isolation
npx tsx scripts/voice/test-knowledge-search.ts

# resolved provider modes / store / outbound posture (no secrets leaked)
npx tsx --env-file=.env.local scripts/voice/verify-integrations.ts
```

## Tests

```bash
npx vitest run src/lib/voice      # unit + integration (mock closed loop)
```

## Architecture (files)

| Concern | Path |
|---|---|
| Env config + per-provider mock/real | `src/lib/voice/config.ts` |
| Domain: enums, state machine, E.164, SIP route | `src/lib/voice/domain.ts` |
| Store: interface + memory + supabase + factory | `src/lib/voice/store/` |
| Business "brain" (reads `master_briefs`) | `src/lib/voice/brain.ts` |
| Prompt compiler (AI disclosure, 3-forbidden) | `src/lib/voice/prompt-compiler.ts` |
| Tool router + P0 tools | `src/lib/voice/tools/` |
| Knowledge search (file_search + mock) | `src/lib/voice/knowledge/` |
| Providers (mock + OpenAI + webhook HMAC) | `src/lib/voice/providers/` |
| Webhook handler | `src/lib/voice/webhook/openai-handler.ts` |
| Realtime session + worker + outbound | `src/lib/voice/realtime/` |
| OpenAI realtime ws bridge (raw event map + socket) | `src/lib/voice/realtime/openai-bridge.ts` |
| Outbound compliance gate | `src/lib/voice/outbound-gate.ts` |
| Finalize (summary + non-destructive lead merge) | `src/lib/voice/finalize.ts` |
| API routes | `src/app/api/voice/` |
| Dashboard | `src/app/dashboard/voice/` |
| Worker process entry | `scripts/voice/realtime-worker.ts` |

## Going live (Supabase)

1. Apply migration `supabase/migrations/20260715000001_voice_agent_p0.sql` (**PM `go apply` only**).
2. Seed demo: `npx tsx --env-file=.env.local scripts/voice/create-demo-tenant.ts`.
3. Map each `voice_tenants.client_id` to a real ME client (so the agent reads that
   client's `master_briefs` as its brain).
4. Set OpenAI keys + webhook secret; configure the SIP provider (see `SIP_SETUP.md`).
5. Deploy the realtime worker as a **persistent process** (see `RUNBOOK.md`).

## Store selection

`VOICE_STORE=auto` (default): supabase when `SUPABASE_SERVICE_ROLE_KEY` + URL present,
else memory. Force with `VOICE_STORE=memory|supabase`.
