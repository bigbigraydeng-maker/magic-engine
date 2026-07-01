-- ════════════════════════════════════════════════════════════════════════════
-- LP Lead Capture (Stage 2 of the Oztop /quote/ landing page rollout)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Stage 1 used Formspree so FDE could launch the LP immediately. Stage 2 swaps
-- the form endpoint to ME's own /api/clients/[id]/leads route so each
-- submission flows into THIS table — enabling Kanban surfacing, attribution,
-- and downstream lead-to-revenue tracking.
--
-- RLS uses the project-standard service-role-only policy (see CLAUDE.md);
-- the public route layer authorizes anonymous POSTs.
--
-- Reference: docs/mockups/oztop-quote-lp.html

CREATE TABLE IF NOT EXISTS public.leads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ON DELETE RESTRICT: leads are a captured business asset (real customers'
  -- contact details). Deleting a client must NOT silently drop their leads —
  -- forces an explicit business decision (archive / export / re-assign).
  client_id       UUID NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,

  -- Required form fields
  name            TEXT NOT NULL,
  phone           TEXT NOT NULL,

  -- Optional form fields (LP validates "required" client-side; server is
  -- lenient and only enforces name+phone so a slightly broken LP doesn't
  -- block a hot lead).
  email           TEXT,
  project_type    TEXT,    -- whitelist enforced at the route layer
  suburb          TEXT,
  timeline        TEXT,    -- whitelist enforced at the route layer
  message         TEXT,

  -- Attribution
  source_url      TEXT,
  referrer        TEXT,
  utm_source      TEXT,
  utm_medium      TEXT,
  utm_campaign    TEXT,

  -- Server-captured (never trust client input here)
  client_ip       TEXT,    -- from X-Forwarded-For; used for rate limiting
  user_agent      TEXT,

  -- Lifecycle. CHECK constraint enforces the enum at write-time so a buggy
  -- UI / API can't stash unknown values that crash Kanban downstream.
  status          TEXT NOT NULL DEFAULT 'new'
                  CHECK (status IN ('new', 'contacted', 'qualified', 'won', 'lost', 'spam')),
  notes           TEXT,                          -- FDE follow-up notes

  submitted_at    TIMESTAMPTZ,                   -- client clock; informational only
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Kanban + per-client listing both query (client_id, created_at DESC).
CREATE INDEX IF NOT EXISTS leads_client_id_created_at_idx
  ON public.leads (client_id, created_at DESC);

-- Rate-limit query path: (client_id, client_ip, created_at).
CREATE INDEX IF NOT EXISTS leads_client_id_ip_recent_idx
  ON public.leads (client_id, client_ip, created_at DESC);

-- updated_at maintained via trigger so route handler stays simple.
CREATE OR REPLACE FUNCTION public.set_updated_at_leads()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS leads_set_updated_at ON public.leads;
CREATE TRIGGER leads_set_updated_at
  BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_leads();

-- ─── RLS — service-role only (project standard) ─────────────────────────────
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.leads FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON TABLE  public.leads IS 'Lead-capture submissions from client landing pages (P12.R.lead-capture)';
COMMENT ON COLUMN public.leads.client_ip IS 'X-Forwarded-For first hop; used for rate-limit + spam triage';
COMMENT ON COLUMN public.leads.status IS 'new | contacted | qualified | won | lost | spam';
