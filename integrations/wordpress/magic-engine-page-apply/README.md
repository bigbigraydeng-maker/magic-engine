# Magic Engine Page Apply

Local development artifact for the governed WordPress Page Apply v2 contract.

The plugin exposes an authenticated capability probe and one compare-and-set
write endpoint. It accepts only Yoast SEO title and meta-description fields,
locks the exact post and relevant postmeta rows, verifies the REST `modified`
token and the approved before values, applies metadata,
advances the version, and commits as one InnoDB transaction. It deliberately
does not accept body, slug, excerpt, status, or arbitrary meta changes.

This directory is not a deployment package. The 2026-08-21 authorization allows
local development and tests only; installing it on any WordPress site requires a
separate review and explicit deployment authorization.
