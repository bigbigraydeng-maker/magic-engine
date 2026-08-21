# Magic Engine — Growth Intelligence Core & Build-vs-Buy Decision

> Date: 2026-08-21  
> Status: **Strategic decision record — proposed for merge; no implementation authorization**  
> Product Owner: Ray Deng  
> Tracking decision: [Issue #1131](https://github.com/bigbigraydeng-maker/magic-engine/issues/1131)  
> Base repository fact gate: `main = 7b5c327b22f662ccfbcf8bd1bb4e6b31bdcd8ebb`  
> Applies to: product strategy, roadmap, architecture reviews, Build Control, Work Packages, vendor selection, future vertical editions and fundraising materials.

---

## 1. Executive decision

Magic Engine must not judge a new requirement by:

> “Can Codex or Claude build this?”

It must first judge it by:

> “Is this something Magic Engine must own in order to become more valuable and harder to copy?”

The company-level rule is:

> **Commodity infrastructure should be bought, integrated or reused. Growth Intelligence must be owned by Magic Engine.**

Magic Engine is not trying to become an Auth company, Billing company, OAuth company, Queue company, Notification company, CRM clone, media infrastructure company or LLM logging company.

Magic Engine is building:

> **A Growth Decision & Execution System that continuously understands an enterprise’s growth state, identifies the next best action, executes it safely, proves the result, and turns every success and failure into a better future decision.**

This decision extends, rather than replaces, the existing ME2 principles:

- AI reasons; software remembers.
- One shared platform; industry differences live in Playbooks / Profiles / Policies.
- Domain Modules reason; shared Capabilities execute; Kernel governs side effects.
- Learn locally first; generalize only when evidence proves the lesson travels.

See also:

- [ME2 Reuse & Platformization Principle](./2026-08-19-me2-platformization-principle.md)
- [Architecture and business decisions](../DECISIONS.md)
- [Build Control governance #1100](https://github.com/bigbigraydeng-maker/magic-engine/issues/1100)

---

## 2. What Magic Engine should be in plain language

A normal AI marketing tool says:

> “Here are ten things you could do.”

A normal agency says:

> “We did some work for you this month.”

Magic Engine should say:

> “We compared the available opportunities, chose the one most likely to matter now, explained the evidence, obtained the right approval, executed it safely, measured what happened, and used the result to improve the next decision.”

The product is therefore not a collection of AI tools. It is one governed learning loop.

```text
Business Goal
→ Current Growth State
→ Ranked Opportunity
→ Next Best Action
→ Expected Impact / Cost / Confidence / Risk
→ Human Approval
→ Kernel Authorization
→ Controlled Execution
→ Execution Receipt
→ Verification Window
→ Attribution
→ Outcome
→ Learning Scope
→ Better next ranking
```

The existing ME2 loop remains directionally correct:

```text
Goal
→ Discovery
→ Analysis
→ Prescription
→ Authorization
→ Execution
→ Verification
→ Outcome
→ Learning
```

This decision makes five previously implicit parts explicit:

1. Candidate actions must be **ranked**, not merely listed.
2. The system must state expected impact, confidence, cost, time-to-result and risk.
3. Execution must produce a durable intervention receipt.
4. Completion is not success until verification and attribution are performed.
5. Learning must have an explicit scope: client-private, industry or global platform.

---

## 3. Full-body diagnosis: has Magic Engine started building the core?

### 3.1 Yes — meaningful parts already exist

Magic Engine has already started building the real core rather than only talking about it.

| Body part | Existing direction | Meaning in plain language |
|---|---|---|
| Eyes | Measurement, evidence, GEO/SEO/ads/content signals | ME can observe parts of the customer’s current situation. |
| Brain | Findings, analysis, prescriptions, Growth Contract shapes | ME can explain problems and propose actions. |
| Decision gate | Human Approval and Kernel authorization | AI does not get unrestricted permission to spend money or change customer assets. |
| Hands | Controlled execution, rollback, idempotency, execution lineage | ME can perform real work while preserving evidence of what happened. |
| Memory | Outcomes, failures, case records, client memory | ME is beginning to remember what worked and what failed. |

The strongest current strategic asset is the governed execution boundary. A generic authorization provider may tell ME that a user has permission to approve ads; only the ME Kernel can also decide whether this exact action is within budget, unchanged since approval, reversible, idempotent and safe for this customer.

### 3.2 No — the body is not yet operating as one repeatable system

The major missing pieces are:

- one canonical Growth State Graph;
- explainable Next Best Action ranking;
- a common expected-impact contract;
- mandatory verification and attribution after all important executions;
- a safe Learning Promotion Gate;
- a customer-facing “Today” experience that answers what matters now and why;
- repeatable evidence that client two starts ahead because of client one’s verified learning.

The honest summary is:

> **ME has built eyes, parts of a brain, hands and some memory, but they are not yet operating repeatedly as one complete body across real customers.**

---

## 4. Actual examples: execution is not the same as impact

### 4.1 Website form example

Suppose a property website form was broken and ME repaired it.

The weak completion statement is:

> “The form now submits. Task complete.”

That proves execution success only.

A real Impact record asks:

- How many visitors previously reached the page?
- How many valid enquiries were created before the repair?
- How many were created during the next 14 or 28 days?
- Did advertising, seasonality or traffic change at the same time?
- Is the improvement large enough to attribute to the intervention?
- Should other property clients with traffic but zero enquiries be checked for the same failure pattern?

Only then does the work become Growth Intelligence.

### 4.2 Magic Engine Customer Zero

A technical SEO PR being merged does not prove an organic-growth outcome.

The correct sequence is:

```text
T0 baseline
→ approved intervention
→ exact intervention receipt
→ T+ measurement
→ attribution
→ outcome
→ learning
```

This is why the Magic Engine website Customer Zero reference loop is strategically more important than another standalone feature. It can prove that the whole system works on a real company, with before-state, intervention and after-state preserved.

### 4.3 CRM example

ME should not become another screen full of contacts, stages and buttons.

A CRM such as HubSpot or Pipedrive can store records. ME should sit above that data and answer:

> “Which customer or lead needs attention today, why are they important, what should happen next, and did the action move them forward?”

The existing read-only “Who needs attention today?” work is aligned with this direction. A full CRM clone would not be.

---

## 5. What Magic Engine must own: the Growth Intelligence assets

These assets compound with real customer usage and should remain first-class Magic Engine intellectual property.

### 5.1 Growth State Graph

A durable representation of:

- business goals;
- markets and industries;
- products and offers;
- websites, channels and campaigns;
- customer constraints;
- approved budgets;
- historical interventions;
- measurements, outcomes and current state.

It answers:

> “What is true about this business now?”

### 5.2 Next Best Action Ranking

Not ten generic recommendations, but a ranked choice based on:

- expected value;
- confidence;
- cost;
- urgency;
- time-to-result;
- risk;
- reversibility;
- strategic fit;
- available capacity.

It answers:

> “Why should this action happen before the others?”

### 5.3 Decision Ledger

Records:

- evidence used;
- reasoning version;
- options considered;
- decision made;
- approver;
- policy and budget state at approval time.

It answers:

> “Why did the system and the human choose this?”

### 5.4 Intervention Ledger

Records:

- the exact approved input;
- actual changes made;
- provider and target;
- spend and timing;
- execution identity;
- rollback capability and result.

It answers:

> “What did ME actually change in the world?”

### 5.5 Measurement and Attribution

Separates:

- task completed;
- metric moved;
- business outcome improved;
- intervention likely caused the change.

It answers:

> “Did this work, by how much, and how sure are we?”

### 5.6 Failure Memory

Stores failed or ineffective actions, including the conditions under which they failed.

It answers:

> “Which expensive mistakes should this client, and eventually similar clients, avoid?”

Failure memory may become more defensible than successful prompts because most tools do not preserve negative outcomes honestly.

### 5.7 Learning Promotion Engine

Controls when a lesson moves from:

```text
Client-private
→ Industry-level
→ Global platform
```

Promotion must require:

- provenance;
- tenant-safe anonymization;
- compatible semantics;
- sufficient sample size;
- evidence quality;
- expiry / decay rules;
- revocation when later evidence contradicts it.

Cross-client retrieval is not sufficient by itself. The promotion policy is the valuable part.

### 5.8 Governed Execution Trust

Combines:

- identity and membership evidence;
- permissions;
- human approval;
- budget and policy;
- immutable approved inputs;
- idempotency;
- rollback;
- audit;
- truthful failure handling.

It answers:

> “Can this specific action be safely performed now?”

---

## 6. What is necessary engineering but not a valuation moat

The following may be required, but should not be presented as core intellectual property merely because ME wrote the code:

- login and password flows;
- SSO plumbing;
- subscription renewal state machines;
- OAuth refresh logic;
- generic queues and cron orchestration;
- notification routing;
- transactional email transport;
- media transformation and CDN;
- generic CRM record keeping;
- generic LLM traces;
- agent names;
- general prompts;
- code-line count;
- table count;
- cron count;
- the underlying foundation model.

A large amount of custom plumbing can lower, rather than raise, company value if it increases maintenance cost without improving customer outcomes or proprietary learning.

---

## 7. Build-vs-Buy map and current Top 3 shortlist

The shortlist below is a decision aid, not an instruction to purchase or migrate.

| Board | Top 3 for ME to evaluate | Current default decision |
|---|---|---|
| Identity / Organizations / SSO | Supabase Auth · Logto · WorkOS | Keep Supabase now; preserve a replaceable identity boundary. |
| Subscription Billing | Stripe Billing · Paddle · Chargebee | Do not build trial, renewal, failed-payment and cancellation machinery from scratch. |
| OAuth / Connector Infrastructure | Nango · Paragon · Merge | New connectors should not default to custom OAuth and refresh logic. |
| Durable Workflow | Inngest · Temporal · Trigger.dev | Use a bounded spike for workflows involving waiting, retries, approval or long-running state. |
| AI Observability / Evals | Langfuse · Braintrust · Phoenix | Establish common traces, datasets, experiments and quality evidence. |
| Product Analytics | PostHog · Amplitude · Mixpanel | Buy the ability to see onboarding, adoption, funnels and retention. |
| Error / Performance Monitoring | Sentry · Datadog · Better Stack | Do not rely on scattered cron logs as the only operational truth. |
| Secrets / Credentials | Infisical · Doppler · HashiCorp Vault | Consolidate gradually when risk and scale justify it. |
| Notifications | Knock · Courier · Novu | Evaluate when multi-channel preferences and reliable delivery become real requirements. |
| Authorization calculation | Cerbos · Permit.io · AuthZed | They may calculate permissions; ME still owns action policy and Kernel authorization. |
| CRM system of record | HubSpot · Pipedrive · Salesforce | Integrate where customers already use them; ME owns intelligence above the CRM. |
| Web data / browser execution | Apify · Browserbase · Firecrawl | Use for collection and browser plumbing; ME owns interpretation and learning. |
| SEO / search data | DataForSEO · Semrush API · Similarweb | Buy raw market data; own diagnosis, intervention and attribution. |
| Media infrastructure | Cloudinary · Mux · Uploadcare | Do not become a video-transcoding or image-CDN company. |

---

## 8. Immediate wheel-reinvention findings

These are audit findings, not automatic replacement orders.

### 8.1 Subscription trial

Current MTC credits and one-time Stripe checkout are useful, but they are not a complete subscription lifecycle.

Trial start, recurring subscription, renewal, failed payment, retry, cancellation and downgrade should normally be delegated to Stripe Billing, Paddle or Chargebee.

ME may still own:

- MTC usage credits;
- internal cost ledger;
- module budgets;
- hard usage caps;
- profitability reporting.

### 8.2 OAuth and token management

ME already carries provider-specific token refresh, expiry and revocation work. This creates a growing maintenance burden as Google, Meta, TikTok, Shopify, Microsoft and other providers are added.

Rule for the next new connector:

> Compare a mature connector platform against direct implementation before authorizing custom OAuth code.

Do not force-migrate stable existing connectors merely to make the architecture look cleaner.

### 8.3 Cron and workflow state machines

Many active cron jobs prove that ME performs real work. They also create responsibility for:

- retries;
- concurrency;
- waiting for approvals;
- long-running state;
- duplicate execution;
- recovery after partial failure;
- per-tenant limits;
- operational visibility.

Simple periodic reads may remain cron jobs. Multi-stage workflows with waiting, side effects and recovery should be evaluated against Inngest, Temporal or Trigger.dev.

### 8.4 Observability

ME should not build separate internal substitutes for all three categories:

```text
Sentry / Datadog
→ Is the software healthy?

PostHog / Amplitude
→ Are customers adopting and retaining the product?

Langfuse / Braintrust / Phoenix
→ Is the AI reasoning and output quality improving?
```

### 8.5 Full CRM expansion

ME may keep a lightweight CRM fallback for customers with no system. It should not compete on generic contact, deal, activity and pipeline record keeping.

The differentiating layer is:

```text
CRM and channel data
→ identity resolution
→ value / urgency understanding
→ next best action
→ governed action
→ result
→ learning
```

### 8.6 Generic free AI tools

Meeting notes, CV screening, ordinary invoice creation, generic email drafting and generic image generation may be useful acquisition tools or integrations.

They should not dominate the product roadmap or investor narrative unless they feed the Growth Intelligence loop with unique evidence and measurable outcomes.

---

## 9. Impact: the canonical meaning

Impact is not a replacement name for DAPE and not a standalone module.

Impact is the settlement record of a growth action.

Every important Impact should include:

- business goal;
- baseline;
- evidence and finding;
- candidate actions;
- ranking rationale;
- expected impact range;
- confidence;
- cost;
- expected time-to-result;
- risk and reversibility;
- approval identity;
- actual intervention;
- verification window;
- actual outcome;
- attribution caveats;
- learning scope.

This is consistent with the original DAPE idea only when DAPE includes all of the following:

1. selection of the best action, not just generation of a task;
2. governed execution, not merely a recommendation;
3. outcome proof, not merely a completed action;
4. learning that changes later decisions.

Where those parts are absent, the implementation is only a partial DAPE / Impact loop.

---

## 10. Capital-market value thesis

Magic Engine should not be positioned primarily as:

- an AI agency;
- an AI content generator;
- a dashboard;
- a collection of mini tools;
- a platform with many modules but little proven use.

The stronger company shape is:

> **An AI-native enterprise Growth Operating System with governed action and proprietary outcome learning.**

The value drivers that must become measurable are:

1. **Recurring revenue** — subscription and usage revenue, not mainly one-off projects.
2. **Workflow depth** — ME becomes part of ongoing growth operations.
3. **Proprietary context** — a structured understanding of each enterprise.
4. **Next-action accuracy** — customers trust the prioritization.
5. **Governed execution** — actions can safely affect websites, ads, content, CRM and commerce.
6. **Outcome proof** — results are measured honestly.
7. **Learning flywheel** — verified interventions improve later decisions.
8. **Retention and expansion** — customers stay and add more growth workflows.
9. **Gross margin** — mature infrastructure prevents custom-delivery cost from growing with revenue.
10. **Enterprise trust** — isolation, identity, approval, audit and compliance.

Licensing, partnership or JV distribution can become a future channel. It does not create a high valuation by itself. The direct product must first prove that it is repeatable, low-marginal-cost, retained and outcome-producing.

---

## 11. Mandatory Build-vs-Buy Gate for future Work Packages

Before any meaningful build, the Task Contract must answer:

### A. Product core test

- Does this improve ME’s ability to choose the next best growth action?
- Does it improve safe execution?
- Does it improve proof of outcome?
- Does it create proprietary, reusable learning?

### B. Market availability test

- Does a mature provider already solve this standard problem?
- Is an open-source component available?
- What are the top three realistic options?

### C. Total-cost test

Compare:

- initial implementation;
- security and edge cases;
- maintenance;
- provider changes;
- support burden;
- observability;
- migration and exit cost;
- vendor lock-in;
- monthly spend at current and target scale.

### D. Ownership boundary

The Work Package must state:

- what ME owns;
- what the provider owns;
- what evidence returns to ME;
- what can be replaced later;
- what must never be embedded in a vendor-specific format.

### E. Authorization

No implementation begins until Build Control and the Product Owner explicitly approve the selected build / buy / integrate slice.

---

## 12. Near-term strategic focus

The next stage should not expand the number of body parts. It should connect the existing parts into a repeatable loop.

### First focus

Run one complete Customer Zero Impact:

```text
Baseline
→ ranked action
→ approval
→ controlled execution
→ receipt
→ remeasurement
→ attribution
→ outcome
→ learning
```

The completion criterion is not a merged PR. It is a truthful outcome record that changes the next decision.

### Second focus

Expose a minimal customer-facing Today experience:

- what deserves attention;
- why it matters;
- recommended action;
- expected impact and confidence;
- approval state;
- result of recently completed work.

### Third focus

Prove the same Playbook on a second and third comparable customer without customer-specific code, then demonstrate one of these improvements:

- faster time to first useful action;
- fewer failed experiments;
- lower manual setup cost;
- higher recommendation acceptance;
- better verified outcome rate.

That is the first real evidence of compounding Growth Intelligence.

---

## 13. Explicit non-authorizations

This decision record does **not** authorize:

- migrating Supabase Auth;
- buying Logto, WorkOS or any other vendor;
- replacing existing connectors;
- replacing all cron jobs;
- introducing Temporal / Inngest / Trigger.dev into production;
- replacing the current CRM;
- deleting existing modules;
- creating a broad platform rewrite;
- creating new Agents;
- applying migrations;
- production writes;
- deployment;
- merge of this document without normal review.

Each action requires a separate, bounded Task Contract.

---

## 14. Review triggers

Review this decision when any of the following occurs:

- the first complete Customer Zero outcome and learning record is produced;
- a second comparable customer runs through the same Playbook;
- Enterprise SSO / multi-organization becomes an active sales requirement;
- the company prepares formal fundraising materials;
- the first licensing / JV partner is being negotiated;
- a team proposes building Auth, Billing, OAuth, Queue, Notification, CRM or Observability infrastructure;
- a selected vendor materially changes pricing, ownership or product direction.

---

## 15. Final frozen statement

> **Magic Engine becomes more valuable when it owns better growth decisions, safer real-world interventions, stronger outcome proof and accumulated learning — not when it owns more commodity plumbing.**

The preferred architecture is therefore:

```text
External systems and mature infrastructure
        ↓
Replaceable Ports / Adapters
        ↓
Magic Engine Growth State
        ↓
Next Best Action
        ↓
Human Approval + Kernel Authorization
        ↓
Controlled Execution
        ↓
Measurement + Attribution
        ↓
Outcome + Learning Promotion
        ↓
A better next decision
```

This is the center of the Magic Engine product, technical roadmap and long-term valuation thesis.