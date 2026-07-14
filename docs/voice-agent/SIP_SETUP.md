# Voice Agent — SIP / OpenAI Setup (manual, human steps)

The electricity link (audio, VAD, barge-in, voice) is handled by OpenAI Realtime SIP.
Magic Engine only does routing, tools, data and audit.

## OpenAI project

1. Create an OpenAI Project; note the **project ID** (`proj_...`).
2. Create an API key → `OPENAI_API_KEY`.
3. Project Settings → Webhooks → add endpoint `https://{api-domain}/api/voice/webhooks/openai`.
4. Subscribe to the **Realtime incoming call** event.
5. Save the **webhook signing secret** → `OPENAI_WEBHOOK_SECRET`.
6. Set `OPENAI_PROJECT_ID`, `OPENAI_REALTIME_MODEL` (`gpt-realtime-2.1-mini` default).

## SIP provider (Twilio / Telnyx)

1. Buy an NZ/AU number.
2. Create a SIP trunk.
3. Point origination / incoming route to:
   `sip:{OPENAI_PROJECT_ID}@sip.api.openai.com;transport=tls`
4. Ensure the provider passes the dialled number through (`To` / `P-Called-Party-ID` /
   `Diversion`). The handler parses these; it does **not** depend on custom headers.
5. In Magic Engine, create a `voice_phone_routes` row for the number → tenant + agent.
6. Call the number from a real phone and check `voice_calls` / transcript populate.

## Signature verification

The webhook uses the standard Svix/OpenAI HMAC scheme (`webhook-id`,
`webhook-timestamp`, `webhook-signature`), verified in
`src/lib/voice/providers/webhook-sign.ts` against `OPENAI_WEBHOOK_SECRET`, with a
replay window of `WEBHOOK_REPLAY_WINDOW_SECONDS` (default 300s).

## Control endpoints used

`POST /v1/realtime/calls/{id}/accept | reject | refer | hangup` — called by
`OpenAIRealtimeProvider` (`src/lib/voice/providers/openai.ts`). The `accept` body
follows the Realtime SIP guide; keep it aligned with the installed SDK's current shape.

## Assumption to confirm against live OpenAI

The incoming event payload is parsed as `{ id, type, data: { call_id, sip_headers } }`
where `sip_headers` is an object or array of `{name,value}`. Verify against a real
event and adjust `normalizeSipHeaders` / extraction in `openai-handler.ts` if needed.
