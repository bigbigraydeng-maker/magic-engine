---
id: 2026-10-18-cts-youtube-cross-channel-alignment
title: Require sourced website, SEO, campaign and social alignment for CTS YouTube topics
status: decided
owner: agent
decided_on: 2026-10-18
source: session:01a134ba
verify_by: 2026-10-30
verify_how: Confirm one CTS topic card in staging reads the official website, records distinct Google and YouTube evidence, links current campaign and social sources, and blocks unknown or stale evidence before production.
---
The implementation records topic evidence and blocks confirm, schedule and private staging when evidence is missing. Google website-search evidence is read from stored GSC query-page data for the exact configured keyword and official landing page; missing data remains uncollected.
Database application, deployment and production-data validation require separate verification.
Public publication remains a separate user-authorized gate.
