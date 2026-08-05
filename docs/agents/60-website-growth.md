# Website Growth Agent

The Website Growth Agent turns a client's website into a continuously improving Magic Engine account. Magic Engine's own website is the first dogfood client.

## Loop

1. **Diagnose** — read `client_site_pages` and current `content_strategy_items`.
2. **Prioritise** — rank a maximum of three evidence-backed actions across technical SEO, content/intent coverage, and AI visibility.
3. **Approve** — a GET request is proposal-only. A POST requires `confirm_queue=true` before cards enter `execution_items`.
4. **Execute safely** — existing CMS/GitHub publishers prepare pull requests. They do not edit production or merge automatically.
5. **Measure** — page upgrades use page-scoped GSC clicks after the PR is merged; new content uses a metric already present in the SEO flywheel; GEO actions use mention rate.
6. **Learn** — confirmed outcomes and completed feedback increase the weight of similar work. Reversed outcomes reduce it. Suggestions repeatedly dismissed or marked irrelevant are suppressed.

This is behavioural learning through persistent evidence and outcomes, not model-weight training. Every recommendation remains explainable through `evidence_refs`, `learning_adjustment`, and `learning_reasons`.

## API

Preview a plan without changing state:

```http
GET /api/clients/:id/website-agent/plan?max_actions=3
```

Queue the current plan for review:

```http
POST /api/clients/:id/website-agent/plan
Content-Type: application/json

{"confirm_queue":true,"max_actions":3}
```

## Priority policy

- Broken/non-indexable pages and missing metadata come first.
- Existing commercial pages with weak intent coverage come before net-new content.
- Industry and lead-generation pages are treated as commercial pages.
- GEO enrichment remains part of the loop, but is deliberately weighted below technical SEO and core commercial intent gaps.
- No action without a concrete source reference can enter the plan.
- Planning never claims an uplift. Attribution begins only after the change is live.

