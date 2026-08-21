# Magic Engine — Digital Marketing Growth Scope Amendment

> Date: 2026-08-22  
> Status: **Strategic scope amendment — no implementation authorization**  
> Parent decision: [#1131](https://github.com/bigbigraydeng-maker/magic-engine/issues/1131)  
> Parent Draft PR: [#1132](https://github.com/bigbigraydeng-maker/magic-engine/pull/1132)

## 1. Why this amendment exists

The 2026-08-21 strategy review correctly identified Growth Intelligence, governed execution, attribution and learning as Magic Engine's valuable core. However, the wording `Growth Decision & Execution System` was too broad and could be misread as a mandate to build a general-purpose enterprise Growth AI Agent.

That is not the intended product boundary.

## 2. Frozen scope

Magic Engine focuses on **measurable Digital Marketing Growth**.

```text
Customer's ultimate goal: Business Growth
        ↓
Magic Engine's accountable domain: Digital Marketing Growth
        ↓
Implementation mechanisms:
Agent + Module + Capability + Kernel + mature external infrastructure
```

Agents are internal implementation mechanisms. Customers do not buy “an agent”; they buy better marketing decisions, safer execution and measurable business outcomes.

## 3. In-scope growth domain

### Demand Generation

- SEO
- GEO / AI visibility
- paid media / Ads
- social media
- content
- local search
- reputation / reviews
- competitor opportunity discovery

### Website Conversion

- landing pages
- CTA
- forms
- bookings
- product/service pages
- conversion tracking
- technical failures that prevent digital demand from converting

### Lead Conversion

- lead prioritisation
- follow-up timing
- next-best contact/action
- marketing-to-sales conversion intelligence

This does **not** mean rebuilding a full generic CRM.

### Measurement & Learning

- baseline
- intervention
- verification
- attribution
- qualified leads
- conversion
- CAC / ROAS
- appointments / sales where observable
- revenue contribution where evidence supports it
- success and failure memory

## 4. Explicit non-core domains

The following may exist as acquisition tools, integrations or supporting utilities, but they must not define the Magic Engine product roadmap or valuation thesis:

- HR / recruitment / CV screening
- generic invoicing or accounting
- inventory / supply-chain management
- generic project management
- generic meeting notes
- generic productivity automation
- generic image/video generation with no marketing-loop evidence

A proposed capability in one of these areas requires a separate justification showing how it directly feeds the Digital Marketing Growth loop. Otherwise it should be integrated, bought, delegated or not built.

## 5. Updated core intellectual assets

The canonical Growth Intelligence terms are narrowed as follows:

1. **Digital Marketing Growth State Graph** — goals, audience, offers, channels, website, search, AI visibility, content, social, ads, leads, conversions, budgets, constraints, interventions and outcomes.
2. **Next Best Digital Marketing Action Ranking** — which marketing action should happen next and why.
3. **Decision Ledger** — evidence, reasoning, alternatives, approval and policy state.
4. **Marketing Intervention Ledger** — what page, campaign, content or follow-up action actually changed.
5. **Measurement & Attribution** — whether the intervention changed meaningful marketing or business outcomes.
6. **Digital Marketing Failure Memory** — which approaches fail, in which conditions, and why.
7. **Learning Promotion Engine** — when tenant-private marketing evidence may safely become industry/platform learning.
8. **Governed Execution Trust** — identity, permission, budget, approval, immutability, idempotency, rollback and audit.

## 6. Updated Impact definition

`Impact` means **Digital Marketing Impact** unless a future explicit strategy decision says otherwise.

A completed task is not Impact.

Every important Impact should connect:

```text
Business Goal
→ Marketing Baseline
→ Evidence / Finding
→ Ranked Marketing Opportunity
→ Next Best Digital Marketing Action
→ Expected Impact / Cost / Confidence / Risk
→ Approval
→ Governed Execution
→ Intervention Receipt
→ Verification Window
→ Attribution
→ Qualified Lead / Conversion / Revenue Outcome where measurable
→ Learning
```

Examples:

- A form submitting successfully = execution success. More valid enquiries attributable to the repair = Impact.
- Higher GEO citation count = measurement movement. More qualified brand discovery / visits / enquiries attributable to the intervention = stronger Impact.
- Better ad CTR = channel metric improvement. Lower qualified-lead CAC or better revenue contribution = business-relevant Impact.
- A CRM reminder being shown = product event. Higher appointment or conversion rate after better lead prioritisation = Impact.

## 7. Capital-market positioning

Do not position Magic Engine primarily as a `Growth AI Agent`.

Preferred strategic framing:

> **Magic Engine is a Digital Marketing Growth Decision & Execution System. It understands a business's current digital marketing state, identifies the next best marketing action, executes it safely, proves its effect on leads, conversions and revenue where measurable, and learns from every result.**

The defensibility is not the Agent itself. It is the accumulated intervention-to-outcome dataset, customer context, failure memory, attribution evidence and improving next-action decisions inside a focused, high-value operating domain.

## 8. Build Control rule added by this amendment

Before any future Task Contract is authorized, Build Control / Codex / Claude must answer:

1. Does this work directly improve Digital Marketing Growth discovery, prioritisation, execution, measurement, attribution or learning?
2. If not, is it commodity infrastructure that should be bought/integrated instead?
3. If it is neither, why is it in the Magic Engine core roadmap?
4. Does the proposal accidentally broaden ME into a general enterprise Growth Agent or generic AI toolbox?

If these questions are not answered, implementation should stop and return to Product Owner / Build Control.

## 9. Relationship to earlier records

This amendment **narrows** terminology in #1131 and Draft PR #1132. It does not invalidate the existing ME2 loop, Kernel, platformization principle, Build-vs-Buy principle, Industry Playbook model, Customer Zero reference loops or governed execution architecture.

It changes the accountable business domain from generic `Growth` to **Digital Marketing Growth**.

No code, migration, provider change, purchase, deployment or production write is authorized by this document.
