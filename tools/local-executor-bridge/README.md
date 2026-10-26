# Local Executor Bridge V1

This is the fail-closed security kernel for #1221. It does not install or start a scheduler.
The formal runner path reads the latest marked envelope and its exact contract comment directly
through `gh api`; Ray does not copy a prompt or contract into a local file.

V1 accepts exactly one signed envelope schema, one executor id, Issue #1222, profile
`obsidian_skin_v1`, a 15-minute TTL, and one attempt. The envelope contains no command,
prompt, repository path, provider action, or arbitrary payload. `ssh-keygen -Y verify` checks
an independently supplied, pinned public key before the atomic ledger can move through:

`CLAIMED → STARTED → TESTED → READY_FOR_RAY_TEST | BLOCKED`

Reusing a nonce is denied even after interruption. A crash therefore leaves a durable receipt
and cannot silently dispatch a second run.
The policy hash also pins the GitHub repository, allowlisted Issue, and absolute GitHub CLI path,
so a local configuration change cannot redirect an otherwise valid receipt to another source.

## Deliberate installation gate

The repository does not contain Ray's signing public key and must not invent one. Installation
requires a separately reviewed allowed-signers file with identity
`magic-engine-build-control`, plus an explicit local-install authorization. Until then this code
is testable but dormant; the existing 300-second LaunchAgent remains unchanged.

## Signing format

Sign the canonical (sorted, compact UTF-8 plus newline) `envelope` object with:

```text
/usr/bin/ssh-keygen -Y sign -f <private-key> -n magic-engine-local-executor-v1 envelope.json
```

The GitHub receipt contains only the marker and a fenced JSON object with `envelope` and the
ASCII SSH signature. The private key never belongs in GitHub, the repository, or the bridge.
Before claiming, the runner fetches the exact `contract_comment_id`, proves the comment belongs to
the same allowlisted Issue, recomputes its SHA-256, and rejects any mismatch before touching the ledger.
