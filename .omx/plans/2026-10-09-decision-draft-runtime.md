# D1-D2: checked pre-dispatch draft contract and bounded evaluator

## Objective and ownership
Native draft_executor is sole writer in isolated /home/gion/Projects/orca-opendecider-draft-20261009. Root orchestrates, reviews and integrates only after writer stops. Separate main worktree lifecycle changes are excluded from this snapshot. Existing user-approved pre-dispatch plan remains authoritative; this slice does not activate Send or public RPC.

## Allowed scope
Four new files: src/shared/rpc-contract/decision-draft-params.ts and .test.ts; src/main/decision-shadow/decision-draft-runtime.ts and .test.ts. Fifth existing shared/decision-preflight-types.ts only if genuinely needed. Preserve inherited dirty work. No source edits outside this scope, public registration, sessions, providers/models launches, dependencies, config, credentials, persistence or deployment.

## Contract
Strict analyze DTO: workspaceId, draftId, revision, catalogRef, choicesVersion, text, attachmentCount, selfContained, inputTruncated; explicitSelection optional checked model/effort. All identifiers/revisions/text reuse existing preflight bounds; catalogRef opaque bounded token (no assumption client supplies authority). Cancel DTO only workspaceId/draftId/revision. Reject owner/account/path/arbitrary choices/target/agent/conversation payload fields.
Host-only context supplies authenticated ownerKey, actual workspaceId/catalogRef/choicesVersion, allowed lanes and target/agent/conversation. Verify echoed binding exactly before provider work. Shared scope returned contains no owner/account/credentials. Host must derive facts at later RPC integration; this service cannot promote supplied dependency data into real admission proof.

## Runtime behavior and acceptance
- Reuse evaluateDecisionPreflightRules, existing sanitizer and validateDecisionShadowAnswers/preflight suggestion validation. No session observer, generation, fence, launch imports or frontier fallback.
- Rules decisive skip/manual gives zero provider calls. Host construction must validate manual pair against real catalog; narrower Nano lane policy is not proof of model entitlement. This slice tests host-bound allowed pairs only.
- Unresolved eligible drafts evaluate sanitized text only with existing categories and <=7 host lanes plus needs_context. Original text stays local; never echoed in logs/errors/results. Scores explicitly uncalibrated.
- Bind own draft key to owner/workspace/draft. Revision rollback or equal revision with changed text/choices/catalog is rejected; higher revision cancels older result before evaluating. No stale promise can overwrite new work. Same identical revision may refuse rather than cache/join.
- One active request per own draft, four provider evaluations globally. Five-second deadline resolves even if provider ignores abort; abort controller is signaled. Unsettled provider work continues to count against capacity until it actually settles, preventing unbounded abandoned work. Queue overflow unavailable, no waiting queue.
- Explicit cancel targets exact owner/workspace/draft/revision. Other owner/workspace or obsolete revision cannot cancel newer work. Already aborted caller does zero provider work. Caller signal, supersession, cancellation and dispose independently settle clients and prevent stale success.
- Keep latest revision/signature tombstones memory-only; cap256 entries, refuse overflow instead of forgetting stale intent. Host-owned disposal/owner cleanup is allowed only with explicit retired-owner lifetime, no arbitrary client forget API. No semantic cache or disk text.
- Provider failures/invalid answers yield fixed unavailable reasons, no raw errors, no automatic OpenAI. Timeout/cancel listener/timer cleanup proven. Resource counts remain correct after late provider completion.

## Tests and checks
Meaningful RED then GREEN. Test exclusions/manual, valid/invalid provider output, exact choices/sanitation, same/different owner and workspace, revision drift, equal revision mutation, cancellation, disconnect, deadline with uncooperative provider, all4slots stilloccupied after timed-out uncooperative work, overload, owner metadata cap, late completion/disposal. Count provider calls; no start/send dependencies exist. ORCA_BACKGROUND_LAUNCH=1 pnpm exec vitest run --config config/vitest.config.ts focused tests plus shared preflight regressions. Node/web typecheck, Oxfmt, focused lint, baseline2383e6225d139488dfbd903666c8093ebb95d02b changed quality, diff. Record logs under execution-20261009T155241Z/draft.

## Remaining gates
D3 actual authenticated runtime RPC/host catalog/service ownership wiring and independent dispatcher tests remain next. C1d2 actual first-reservation admission, C2 public selection, E UI/launch transport, F real selected canary remain HOLD. Human gold/calibration/allowance savings UNKNOWN; Shadow routing savings0.
