# Voice Agent — WhatsApp Setup (P1, not in P0)

WhatsApp text + voice notes reuse the SAME tenant / agent / brain / knowledge / tool
router / audit as the voice agent. This is **P1** — do it only after P0 is green.

## Text messages (P1)

1. Meta App → WhatsApp product; note `WHATSAPP_PHONE_NUMBER_ID`,
   `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_ACCESS_TOKEN`, `META_APP_SECRET`,
   `META_VERIFY_TOKEN`.
2. Webhook: `GET /api/voice/webhooks/meta` (verify challenge with `META_VERIFY_TOKEN`),
   `POST /api/voice/webhooks/meta` (X-Hub-Signature-256 HMAC via `META_APP_SECRET`).
3. Inbound message → normalize contact → conversation thread → Responses API + the
   shared Tool Router → send reply → persist messages + tool calls.

## Voice notes (P1)

Download media via the Meta API → transcribe → run the text agent → reply text by
default (optional TTS). Voice notes are **async** — do NOT open a realtime session.

## Realtime WhatsApp calling (P2)

Reserved behind the `RealtimeCallProvider` interface. Meta WhatsApp Business Calling
needs Meta account + number + permissions + SIP config and a call-permission flow.
Do not let this block the PSTN MVP.

> Status: P0 ships voice only. These routes are documented for the next phase.
