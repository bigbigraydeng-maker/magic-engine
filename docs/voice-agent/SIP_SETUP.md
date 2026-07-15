# Voice Agent — Go-Live SOP (first real call)

The audio link (VAD, barge-in, voice) is handled by **OpenAI Realtime SIP**. Magic
Engine does routing, tools, data, audit. Flow:

```
Caller → your SIP provider (DID) → forwards call to OpenAI SIP over TLS
       → OpenAI sends realtime.call.incoming webhook → ME /api/voice/webhooks/openai
       → ME accepts + dispatches to the realtime worker → worker opens control ws
       → Agent greets, uses tools, transfers/hangs up → transcript+summary+lead saved
```

Do the steps in order. **A–B–C need a computer + third-party consoles; D–E are ours.**

---

## A. OpenAI (console.openai.com)

1. Create / pick a **Project**; copy the **Project ID** (`proj_...`) → `OPENAI_PROJECT_ID`.
2. Create an **API key** → `OPENAI_API_KEY`.
3. **Webhooks** → add endpoint: `https://app.magicengine.com.au/api/voice/webhooks/openai`
4. Subscribe to the **Realtime incoming call** event.
5. Copy the **webhook signing secret** → `OPENAI_WEBHOOK_SECRET`.

## B. SIP provider — buy a number + forward to OpenAI

Pick one. **Telnyx** and **SignalWire** are both self-serve, AU+NZ capable, and
natively forward inbound calls to an external SIP URI over TLS.

### Option 1 — Telnyx (recommended)
1. Buy an **AU or NZ number** (Numbers → Search & Buy).
2. **Voice → SIP Trunking** → create a connection (FQDN / Outbound Voice Profile).
3. Point the connection's **destination / origination URI** at:
   ```
   sip:{OPENAI_PROJECT_ID}@sip.api.openai.com;transport=tls
   ```
4. Attach the purchased number's **inbound** to that connection. Ensure **TLS**
   (port 5061) and that the **called (To) number is passed through** (default).

### Option 2 — SignalWire
1. Buy an AU/NZ number.
2. Set the number's **inbound handler → SIP forward** to:
   `sip:{OPENAI_PROJECT_ID}@sip.api.openai.com;transport=tls`
3. Confirm TLS + called-number pass-through.

### Local telcos (Devoli NZ+AU / 2talk NZ / Symbio·MaxoTel AU)
Cheaper local minutes / porting, but **confirm before buying**: (a) can forward
inbound to an **external SIP URI**, (b) **TLS/sips** supported, (c) **passes the
called number** (To / P-Called-Party-ID / Diversion). The CPaaS options above have
all three by default.

## C. Render env

**web service `magic-engine`** — set (render.yaml already declares them):
`OPENAI_API_KEY`, `OPENAI_PROJECT_ID`, `OPENAI_WEBHOOK_SECRET`, `INTERNAL_WORKER_TOKEN`
(any strong random string), `REALTIME_WORKER_URL` (see below), `VOICE_STORE=supabase`,
`OUTBOUND_CALLING_ENABLED=false`.

**private service `voice-realtime-worker`** (new in render.yaml) — set the same
`SUPABASE_*`, `OPENAI_API_KEY`, `OPENAI_PROJECT_ID`, `INTERNAL_WORKER_TOKEN`.

**Wire the dispatch**: after the worker deploys, Render shows its **internal URL**.
Set `REALTIME_WORKER_URL` on the **web** service to `http://voice-realtime-worker:<port>`
(the internal host:port Render shows). Redeploy the web service.

> `INTERNAL_WORKER_TOKEN` must be **identical** on web + worker (web authenticates its
> dispatch to the worker with it).

## D. Provision your real number (no SQL)

On your computer, put the prod `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
in a local env file, then:

```bash
npx tsx --env-file=.env.prod scripts/voice/provision-tenant.ts \
  --slug cts-voice --name "CTS Tours" --number +64XXXXXXXXX \
  --client <ME_CLIENT_UUID> \
  --role sales --provider telnyx --transfer tel:+64XXXXXXXXX \
  --agent-name Amy \
  --greeting "Kia ora, thanks for calling CTS Tours. This is Amy, an AI assistant. How can I help?"
```

Re-run with the same `--slug` to update. `--client` should be the real ME client id
(so the agent reads that client's `master_brief` as its brain). `--transfer` sets the
human-handoff whitelist (required before live calls — 板桥 硬闸 #4).

Upload the client's product/FAQ/policy docs as knowledge (dashboard KB upload, when it
lands) so `search_knowledge_base` has content; until then the agent verifies/hands off.

## E. First call test

1. Call the DID from a real phone.
2. **Agent must open by disclosing it is an AI** (板桥 硬闸 #1 — enforced in the prompt).
3. Ask a factual question → it should use the knowledge base, not invent.
4. Hang up. Open `/dashboard/voice` → the call appears with transcript, tool calls,
   summary, `promises_made`, and a lead (if captured).

**If nothing happens / silence:**
- webhook: OpenAI dashboard shows the event delivered? ME `voice_webhook_events` has a row?
- worker: `voice-realtime-worker` logs show `session_started` + a ws connection? Is
  `REALTIME_WORKER_URL` correct and `INTERNAL_WORKER_TOKEN` matching on both services?
- route: `voice_phone_routes` has your exact E.164 with `status='active'`?
- realtime **event names** are parsed defensively but may need calibration against the
  live stream — check worker logs and adjust `mapRealtimeEvent` if a transcript or
  function_call doesn't land (`src/lib/voice/realtime/openai-bridge.ts`).

---

### Signature verification
Webhook uses the Svix/OpenAI HMAC scheme (`webhook-id` / `webhook-timestamp` /
`webhook-signature`) verified against `OPENAI_WEBHOOK_SECRET`, replay window
`WEBHOOK_REPLAY_WINDOW_SECONDS` (300s). See `src/lib/voice/providers/webhook-sign.ts`.
