# Execution: Orca pre-dispatch C1d2 lifecycle prerequisite

## Objective
Close the real desktop unary RPC lifecycle gap before public selected-create admission. Reuse DesktopRuntimeSenderLifecycle and existing RpcContext.signal. The user authorized native specialized agents to execute the plans; root orchestrates and delegates one writer. No daily install, deployment or provider inference.

## Ownership and scope
One native Codex writer after root brief; root and other specialists read-only in this worktree while writer runs. At most five source/test files: src/main/ipc/desktop-runtime-sender-lifecycle.ts, src/main/ipc/runtime.ts, runtime-subscribe-lifecycle.test.ts and/or new runtime-unary-lifecycle.test.ts, runtime.test.ts only if fixture must expose real WebContents shape. Preserve inherited dirty source. Earlier root-only writer plan is superseded only for this authorized native handoff, not architecture/safety constraints.

## Acceptance
- runtime:call authenticates current main frame before dispatch and captures one lifecycle-owned connection identity and AbortSignal.
- Pending unary work is aborted when its sender document navigates, renderer crashes, sender is destroyed, or same numeric sender ID is replaced by another WebContents.
- All concurrent calls in the retired generation abort; other senders and later generations remain independent.
- Settled/rejected dispatch releases its controller in finally; retirement cannot retain settled calls or remove a later call accidentally.
- Stale-frame refusal dispatches nothing. Streaming setup, unsubscribe and generation cleanup behavior remains unchanged.
- Signal reaches the actual RpcContext through existing dispatcher. It is cooperative cancellation: do not claim rollback of already committed operations or first-reservation/model authorization from this seam.
- No new public selected-create capability, create forwarding, UI, RPC fields, settings, credentials, package dependencies or process launches.

## Verification
Meaningful failing lifecycle/IPC tests before implementation; ORCA_BACKGROUND_LAUNCH=1 pnpm test affected unary and existing runtime/subscribe lifecycle tests. pnpm run typecheck:node; pnpm exec oxfmt --check affected files; focused oxlint and changed-code quality; git diff --check. Root independently reviews and verifies. Full repository suite is deferred until integrated phase gate; prior full-suite assertion failure is not hidden.

## Dependency and next work
This closes only unary lifecycle prerequisite to C1d2. Current account/catalog-at-probe continuity and bounded local pilot routing-policy admission, original client IDs/one-use first-attempt proof still require connected follow-up slices; preserve existing resolved Orca permissions before C2/D/E/F public Send. Dataset human labels and allowance utility stay UNKNOWN, Shadow savings0. Broader gateway/cross-project deployment needs separate audit and infrastructure evidence.
