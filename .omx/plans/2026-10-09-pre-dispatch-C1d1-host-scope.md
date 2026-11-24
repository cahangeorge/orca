# C1d1 local host scope and selected client intent preflight

## Objective and boundary

Implement a read-only internal candidate binding using actual host runtime workspace/location/account-home resolution and trusted RpcContext, before selected-create public activation. Reuse local shadow transport gate, structured capability/settings policy, CreateIntentParams/fingerprint, operation-ID timestamp rules, runtime account read-only resolver. No new dependencies, schema, RPC registration, public capability or UI changes. Full C1d and first-attempt provenance remain HOLD; a well-formed ID/digest does NOT prove a never-executed client attempt. A scoped result is neither catalog/model authorization nor first-reservation capability. Same-path credential drift remains unsupported.

## Scope and style

Three files: runtime/orca-runtime-get-structured-agent-session-create-support.ts adds narrow read-only selection scope method; rpc/methods/structured-agent-session-selected-create-scope.ts and .test.ts new. Root sole writer; independent Codex read-only review. Existing naming and Oxfmt; no max-lines suppression; only checked types or exact SAFETY fixture cast.

## Acceptance

Local desktop runtime, exact desktop-renderer identity, no pairedDeviceId, live nonblank connection, negotiated structured capability and enabled host policy only. Clone and schema-validate selected Codex blank intent/fence-null/client digest before awaits. Preserve client session and operation IDs; no IDs minted, missing evidence never recreates. Check operation timestamp against existing replay age/skew bounds, safe clock, rollback/expiry across awaits. Reject forged scope/account/policy payload fields. Derive location/workspacePath/accountHome only host-side via existing read-only account resolver, reject remote/WSL, refuse blank path/wrong home kind. Compare two full scope samples and resample caller/connection/capability/host setting after awaits; drift/unavailability/abort UNKNOWN. These are sampled identity consistency checks, not atomic admission proof. Existing settings model defaults do not replace selected pair.

## Verification and tasks

1. Verify prior manifests/source preservation and archive current handoff.
2. Add failing meaningful tests for scope method and gate using actual OrcaRuntimeService with fixture-owned boundary resolvers, no providers/app.
3. Implement minimal three-file seam; targeted ORCA_BACKGROUND_LAUNCH=1 pnpm test src/main/runtime/rpc/methods/structured-agent-session-selected-create-scope.test.ts.
4. Relevant regression: that test plus runtime/orca-runtime-structured-agent-session-create-intent.test.ts, rpc/methods/structured-agent-session-initial-selection.test.ts, native-chat/agent-model-catalog/agent-model-catalog-initial-selection.test.ts, rpc/methods/structured-agent-session-selected-create-host-replay.test.ts, shared/rpc-contract/structured-agent-session-initial-selection.test.ts.
5. pnpm run typecheck:node and typecheck:web; pnpm exec oxfmt --check <three files>; six existing focused oxlint configurations; pnpm run check:code-quality:changed 2383e6225d139488dfbd903666c8093ebb95d02b; git diff --check. Independent read-only review.
6. Preserve prior sources/artifacts/original checkout; archive/checkpoint exactly one next gate. No commits/push/deploy/install/credentials/config/model/provider launch.

# C1d1 transport claim clarification

Review of actual desktop IPC shows current-main-frame authentication and host-created connection identity at unary dispatch. RpcContext captures that identity; unary IPC supplies no lifecycle AbortSignal or liveness callback. Replace the initial SPEC phrase “live nonblank connection” with “host-created nonblank captured connection identity”. This reader checks supplied-context changes and an optional abort signal only. It does not attest window retirement, current-main-frame continuity or an ABA change across awaits. These remain part of the unproved admission boundary; `admission: unproven` is mandatory. No IPC/global lifecycle changes are introduced.
