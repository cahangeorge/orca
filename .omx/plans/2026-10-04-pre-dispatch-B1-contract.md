# B1: shared initial selection contract

Objective: bind the human-approved initial model/effort and opaque host catalog/account evidence to a create intent, preserving legacy behavior. Root sole writer; authorized bounded B1 only.

Contract: optional `initialOptions: {model: string, effort: string}` with no other keys; separate `initialOptionsCatalogRef: string`. Both appear together, only for new Codex creates (no resumeFrom). Tokens are bounded, nonempty and contain no whitespace; effort remains an open token for future host catalog validation. Reference is opaque and does not carry account paths/auth. Constructor snapshots model/effort and hashes the same returned fields. Both new fields affect create digest; absent/undefined fields leave old hashes and payload shapes unchanged. Wire strict attach rejects this metadata and host-only createInitialSelection. No normalization or default model.

Assumptions: catalog reference issuance/lookup/freshness and account validation are deferred to C, durable conflict/replay to B2. These strings alone establish no authorization. No capability advertisement or sending new fields from callers yet; old strict hosts reject them. Host recomputation is not updated in B1. Generated RPC catalog regeneration remains C2; schema/catalog concordance is intentionally pending.

Scope: three contract files and two test files (listed in source-before manifest/new test below), total five; no UI/host/runtime source edits. Existing shared create/fingerprint helpers reused. Source style follows AGENTS: checked types, braces, Oxfmt, no lint suppressions.

Files: src/shared/rpc-contract/structured-agent-session-params.ts; src/shared/structured-agent-session-create.ts; src/shared/structured-agent-session-mutation.ts; src/shared/structured-agent-session-create.test.ts; src/shared/rpc-contract/structured-agent-session-initial-selection.test.ts.

Tasks: freeze legacy golden digests independently; write RED acceptance tests; implement shared types/schema/digest; run scoped regressions, node/web compiler, formatter and six quality profiles; independent read-only Codex verification; preserve prior files/evidence and update compact handoff.

Commands: pnpm test src/shared/structured-agent-session-create.test.ts src/shared/structured-agent-session-mutation.test.ts src/shared/rpc-contract/structured-agent-session-initial-selection.test.ts src/shared/decision-preflight-validation.test.ts src/shared/decision-preflight-rules.test.ts; pnpm run typecheck:node; pnpm run typecheck:web; pnpm exec oxfmt --check <five files>; pnpm run check:code-quality:changed 2383e6225d139488dfbd903666c8093ebb95d02b. Six focused Oxlint profiles over only five files, configs reused from A.

Acceptance C4/C5a/C6: valid pair round-trips unchanged; partial/additional/invalid fields refused; separate ref mandatory when pair present; no Claude/resume new selection; each new field alters digest; caller option object mutation cannot change constructed payload; recomputation from actual parsed payload agrees; pinned old blank/resume/tab/Claude digests stable; strict attach refuses client metadata. Pure source tests, no services/inference required. No full suite/E2E until integration F gate.

Boundaries: preserve all prior Shadow/A sources and evidence, original checkout; no installs, commits/push, deploy, runtime/model launch or global configuration changes. Existing five Shadow quality findings remain an explicit global FAIL, no scope expansion to fix them. Root accepts only B1 after targeted proof.

## Review correction

The strict schema now also verifies new-selection digest against the shared helper. A manually built selected payload with a legacy digest cannot pass through the current host and lose its selection. This is a contract guard, not host integration: valid new digests are refused by current host until B2/C. The bounded cross-field helper lives in shared create.ts, keeping schema below the existing max-lines limit without suppression. Removed an unnecessary existing Object.entries assertion; canonicalization behavior unchanged and tested. Adverse shape tests recompute independent payload digests so the digest guard cannot hide missing token validation.
