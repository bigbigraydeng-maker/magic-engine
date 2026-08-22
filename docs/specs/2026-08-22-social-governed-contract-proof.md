# Social governed-contract proof (local only)

Issue: #1141

`social.schedule_approved_post` is a provider-neutral, text-only proof that one
Social Candidate can cross the existing Action Bridge and Kernel approval
boundary without enabling a production publishing path.

## Frozen local contract

- The exact Candidate identity `{domain: "social", intent: "publish_approved_post"}`
  maps to the exact ActionKey `social.schedule_approved_post`.
- The Action is outward, reversible, single-attempt, and always requires human
  approval.
- Ordinary production composition excludes the capability. Only an explicit
  non-production `local_test` gate can assemble it.
- Provider readiness inspection invokes no provider operation.
- Before approval, provider calls are zero. After approval, scheduling occurs
  once and must return an exact `providerPostId`.
- Missing cancellation support or exact post identity fails closed.
- Verification and rollback use only the exact identity pinned in the current
  run's schedule receipt.
- Publication status and engagement reads use the same provider-neutral
  interface. Normal tests use a fake provider and make no network call.

## Explicit non-goals

No production adapter or credential lifecycle; no real provider harness or
provider call; no Social Outcome migration; no generic IMPACT expansion; no
GEO or Product Map change; no production composition, write, enablement, spend,
deployment, or migration apply.

This proof does not make production Social capability ready and does not
measure Social impact.
