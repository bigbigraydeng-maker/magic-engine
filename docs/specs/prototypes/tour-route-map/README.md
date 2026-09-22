# Tour route-map generator — prototype

Prototype for the itinerary→route-map capability (see
[`../../2026-09-14-me-tour-management-module-plan.md`](../../2026-09-14-me-tour-management-module-plan.md)).
Kept here so productization (module P2) does not have to re-derive the design.

**Status**: prototype, **not** a productized ME capability. Renders China route
maps only (base map + Taiwan labelling + CTS brand are hardcoded — see plan doc
Reuse Statement for the parametrization prerequisites before it is shared).

## Files
- `gen.py` — renderer: auto-fits the China outline to a tour's cities, draws the
  route (curved segments + arrowheads + transport icons), places labels with
  collision avoidance, and emits PC (landscape) + mobile (portrait) SVG.
- `specs.py` — the 7 grounded CTS tour specs (cities/nights/transport/activities
  taken from the tours' real itineraries + highlights).
- `chn.json`, `twn.json` — China mainland + Taiwan boundary GeoJSON
  (johan/world.geo.json, public/free).

## Data dependency (not committed)
`gen.py` expects `logo_b64.txt` next to it — base64 of the CTS logo, derived from
the `chinatravel` repo `logo.png`:

    python3 -c "import base64;open('logo_b64.txt','w').write(base64.b64encode(open('/path/to/chinatravel/logo.png','rb').read()).decode())"

## Run
    python3 gen.py     # writes out/<slug>.svg + out/<slug>-mobile.svg

First implementation wired into the CTS site lives in the `chinatravel` repo:
`src/components/tours/TourRouteMap.tsx` + `public/tour-maps/*.svg`.
