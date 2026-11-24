# C1d2 — connected catalog probe continuity protocol

Local isolated pilot only. This phase does not enable selected routing or install Orca.

## Problem and scope

Successful model listings currently carry process membership, not fresh launch/account provenance. Connect the real probe to private store evidence and initial-selection reference checks. Seven source/test files: codex-model-catalog-probe-context.ts and test (new), codex-model-catalog-probe.ts and test, agent-model-catalog-store.ts, agent-model-catalog-initial-selection.ts and test. Root owns this spec/status; one native executor owns those seven files while root/reviewer remain read-only.

## Contract

Trusted internal synchronous reader receives pinned actual invocation and account home. Known continuity key must represent freshly observed current launch context AND account provenance agreeing with that invocation; hashing only the argument is insufficient. Reader absent, throws, malformed, async, unknown or drift refuses selected eligibility. No production reader is supplied in this phase. No actual credential/file observation, entitlement inference, model/provider inference or global settings changes.

Freeze invocation and nested args/environment before the probe. Observe immediately before and after actual runSession. Only equal known observations bind a private WeakMap receipt to the original success object. Ineligible observation latches for that success; later stability requires a new probe. Receipt validation is synchronous and rechecks account home and current continuity. Changing context after issuance invalidates reference validation.

Store transfers receipt privately to the exact new entry; no enumerable entry/success fields, disk, DTO or logs. Legacy successful listings and live-session overwrites still serve picker but cannot satisfy the stricter selected gate. Existing failure/empty/restart/eviction revocation holds. Receipt checks must recheck exact current entry after callback execution to refuse synchronous reentrant replacement/failure. Missing references remain reconciliation UNKNOWN, never fresh operation/default fallback.

## Acceptance

Actual probe -> store -> reference tests: stable synthetic trusted reader; drift before/after/during probe and after issuance; account mismatch; absent/malformed/throwing/async reader; failed/empty refresh and failure TTL; live-session overwrite; unchanged listing new context; persistence/restart; JSON metadata privacy; no unhandled rejected-reader promises; frozen invocation. Existing legacy catalog/service/probe tests remain green. Save meaningful RED then GREEN. Node and canonical web typecheck, focused lint/format/diff and exact baseline changed-code quality. No full UI/release claim.

## Limits and next gate

This proves the connected host continuity protocol with injected synthetic provenance and default refusal. Current production launch environment/account APIs are async, and effective process environment also includes inherited process.env and CLI runtime pairing. Production synchronous sampler remains required; an invocation digest/path stamp alone cannot supply it. First-attempt consumption/issuer, replay-first coordinator, public transport and Analyze/choose/Send remain later dependencies.

## Accepted remediation scope

Two adjacent test fixtures were updated for the stricter provenance contract: structured-agent-session-selected-create-recovery-durable.test.ts (actual fake-transport probe) and structured-agent-session-selected-create-reservation.test.ts (explicit synthetic synchronous receipt). Nine source/test files total; no production gate relaxation. Independent actual-source probes reproduced receipt invalidation during a callback and callback crossing catalog expiry. Regressions saved RED before fixes: post-callback receipt identity/valid latch rechecked; freshness clock sampled after continuity callback. A probe success receipt is consumed on store transfer; this is not consumption of a client's first-attempt catalogRef.

Final root targeted13 suites261/261 PASS; Node/canonical web compiler, nine-file lint/format/diff and exact baseline quality PASS (95 changed files, zero new findings). Full repository/browser/production and actual-provider inference are outside this internal slice. Evidence execution-20261010T125650Z.
