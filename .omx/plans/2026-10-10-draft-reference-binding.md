# D3a — read-only catalog reference and draft host binding

## Objective / ownership

Implement one internal checked draft-service seam in the isolated Orca OpenDecider checkout. A valid suggestion is tied to authenticated owner, document connection, local workspace/account/catalog reference and revision; stale/unknown observations refuse. This does not unlock current production Analyze: strict references still require the independent full account evidence absent in production. Original plan D is independent of selected Create; a future advisory-only token would require a separate explicit contract. One native executor owns four files; root and reviewers read-only while it writes.

## Allowed files / stack

TypeScript, existing Vitest/Zod/runtime/provider. Modify src/main/native-chat/agent-model-catalog/agent-model-catalog-initial-selection.ts and its existing test. Add src/main/decision-shadow/decision-draft-service.ts and its test. No other source files, dependencies, global settings, auth/home preparation, credential reads, public RPC/registry/codegen, renderer or session effects. Root owns this spec and compact status only after writer returns.

## Task1 — strict read-only reference resolution

Add readForDraft({context,catalogRef,choicesVersion}) to existing evidence object. Reuse exact private read(context), reference identity, saved scope, freshness/private receipt/failure gates and callback-reentrancy checks; do not duplicate or weaken entitlement proof. Snapshot input before callbacks. Missing references remain UNKNOWN; known scope/version/catalog failure refuses conservatively. Return owned choices only, no entry/owner/account/receipt/grant. Issue no reference, consume no first-attempt authority, mutate no current successful reference. Invalid references may be irrevocably refused as existing validation does. Caller mutation/eviction during callback must not pass. Preserve issue/validateNewCreate behavior.

## Task2 — bounded internal draft service

Wrap DecisionDraftRuntime without reimplementing its provider sanitation/answer validation. Trusted dependency resolves current local workspace/account scope (async permitted) and reads current authenticated caller/document metadata; none of those facts come from client params. Existing strict analyze/cancel DTO only. Pin owned input/caller before any await; include connectionId in draft namespace, validate local host/no WSL/CODEX_HOME and context owner/workspace match. Derive local/codex/new only from that supported host scope. readForDraft supplies choices; Nano choices are intersected with the existing explicit native pilot policy (Luna/high, Sol/medium or high, Astra/low); max7 plus needs_context. A valid explicit manual pair is checked against full resolved catalog and does zero provider work, including a catalog-supported pair outside the narrower Nano policy. Do not treat host policy as catalog entitlement.

Reobserve caller and scope/reference after awaited scope work and after evaluator settles, before publishing an available/selected result. Compare immutable normalized snapshots, recheck deadline/cancellation/disposal and latest intent. Refuse unknown/malformed/async synchronous caller observation; errors use fixed private reasons, no text/account/env/error echo. The service must never call create/acquire/thread-start/turn-start/send, issue grants or use frontier fallback.

Ready+evaluate total deadline5s. Bound async scope work as well as provider work: max4 physical in-flight service jobs, unsettled work retains capacity after timeout/cancel until it actually settles; do not create unbounded abandoned scope requests. Latest intent is owner+document+workspace+draft; revision changes supersede, equal changed intent refuses, lower revision refuses. Keep bounded memory-only revision metadata (256 like evaluator), refuse overflow; do not forget old revisions by arbitrary client cleanup. Caller signal and cancel exact revision can stop work during resolution and evaluation; late completion cannot invoke provider or publish stale output. Explicit dispose aborts clients/work and refuses future work. Never hide an uncooperative resolver in a retry queue.

## Acceptance / tests

Meaningful RED then GREEN with synthetic trusted full-reader probe/catalog fixtures. Missing/foreign/expired/revoked refs; changed choices/model/effort/account/path/host/policy; default absent full reader; defensive choices/input snapshot; lazy getter/callback reentrancy; foreign owner/document and document replacement; cancellation/dispose during scope and Nano; monotonic revisions and late results; queue/deadline with uncooperative resolver/provider and capacity retained; empty/narrow lanes/manual outside policy; errors private. Count fake provider calls and prove zero session effects by service dependency surface. Existing admission/catalog/draft suites remain green.

## Commands / code style

ORCA_BACKGROUND_LAUNCH=1 node node_modules/vitest/vitest.mjs run --config config/vitest.config.ts [focused suites] --maxWorkers=1. Existing style: fixed structured failures, checked types, no casts without SAFETY, no max-lines disable. Node tsc config/tsconfig.node.json then web config/tsconfig.tc.web.json sequentially after live RAM; root owns compiler/quality acceptance. Focused Oxlint/Oxfmt and git diff --check; changed-code quality exactbaseline2383e6225d139488dfbd903666c8093ebb95d02b. No browser/model/app/full-release claims from these checks.

## Remaining gates

D3b actual authenticated scope/host assembly and RPC registration, capability/schema read-back and document lifecycle; E pre-launch UI; C strict first-attempt issuer/fullauth; F actual hidden Electron/provider workflow; human labels/calibration/savings. Production UNKNOWN never becomes a fresh Create or a default fallback.
