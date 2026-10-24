# CTS published tour feed

The CTS public website consumes only the immutable ME tour-catalog version marked as published. Editing or saving a tour in Tour Management changes the working copy; it does not update the website until the catalog is published.

## Public read endpoint

`GET /api/public/tour-catalog/{clientId}` returns the matching client's latest published snapshot. It requires a client API key scoped for `read:all`, bound to the same client ID in the URL. Meta Ads scoped keys are rejected. The response contains the version and the public tour projection; draft fields and internal departure notes are excluded. If the client has no published version, the endpoint returns `503` with `published: false`.

## Publish refresh callback

Successful publish and revert operations call `revalidatePublishedTourWebsite`. Configure these server-side variables in the ME service:

| Variable | Value |
| --- | --- |
| `CTS_TOUR_CATALOG_REVALIDATE_URL` | `https://www.ctstours.co.nz/api/revalidate` |
| `CTS_TOUR_CATALOG_REVALIDATE_SECRET` | Strong shared secret matching the website configuration |
| `CTS_TOUR_CATALOG_CLIENT_ID` | The CTS client UUID |

The website must also have `ME_CTS_TOUR_CATALOG_URL`, a same-client `read:all` API key in `ME_CTS_TOUR_CATALOG_API_KEY`, `CTS_TOUR_CATALOG_REVALIDATE_SECRET`, and `CTS_TOUR_CATALOG_CLIENT_ID` configured. Do not store secret values in this document or source control.

The publish response includes `websiteSync: revalidated | not_configured | failed`. The Tour Management UI shows this state after publish. A successful ME publish remains successful if the refresh call fails; the warning tells the editor the website callback needs attention. The website feed itself is revalidated at most every 15 seconds.

## Main code locations

- Feed projection: `src/lib/tour-catalog/website-output.ts`
- Authenticated endpoint: `src/app/api/public/tour-catalog/[clientId]/route.ts`
- Publish and revert callback: `src/lib/tour-catalog/website-revalidation.ts`
- Publish/revert API response: `src/lib/tour-catalog/publish-contract.ts`
- Tour Management refresh notice: `src/app/dashboard/clients/[id]/tour-catalog/_components/CatalogWorkspace.tsx`

The public response contract must stay in sync with CTS Website `PUBLISHED_TOUR_CATALOG_CONTRACT`. Tests cover the projection, endpoint access rules, publish/revert callback and publish response wiring.
