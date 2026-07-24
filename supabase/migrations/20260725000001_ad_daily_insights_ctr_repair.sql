-- P21.K — repair mixed-metric ctr history in ad_daily_insights.
--
-- Bug: parseCampaignDailyRow preferred Meta's outbound_clicks_ctr and fell back
-- to clicks/impressions only when it was absent. For campaigns whose clicks
-- don't leave Meta (Lead Forms, CTWA), Meta returns outbound_clicks_ctr on some
-- days (~0.05–0.2%) and omits it on others (fallback ~1.7–2.6%), so one
-- campaign's stored ctr series mixed two metrics an order of magnitude apart
-- (proven on Oztop "Lead Form Cold Broad", client d5c98811, 7/9–7/23).
--
-- The code now always computes ctr = clicks/impressions. Every historical row
-- already stores clicks and impressions, so history is recomputed in place on
-- the same single basis — no API refetch needed. Idempotent; safe to re-run.
--
-- Also adopts the code's zero-click rule: impressions served with zero clicks
-- is a real ctr of 0 (previously null), null only when nothing was served.

UPDATE ad_daily_insights
SET ctr        = CASE WHEN impressions > 0
                      THEN clicks::numeric / impressions
                      ELSE NULL END,
    updated_at = now()
WHERE platform = 'meta'
  AND level    = 'campaign'
  AND ctr IS DISTINCT FROM (CASE WHEN impressions > 0
                                 THEN clicks::numeric / impressions
                                 ELSE NULL END);
