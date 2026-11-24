# Native Chat automatic titles — 2026-10-02

Objective: Orca 1.4.218 Native Chat tabs derive a short title from the observed conversation prompt using the existing terminal title rule.

Scope: renderer title projection, tab display/drag labels, host snapshot preservation, targeted regression tests. Sole writer: current Codex leader. Source baseline: v1.4.218, commit 75ea50273328d9bd5465170d10a098711d61b5a4. No changes to credentials, models, session execution, or production services.

Acceptance:
- Enabled setting generates a Native Chat title once a real prompt is observed, including existing sessions.
- Manual names win; empty prompts and disabled setting preserve the placeholder.
- Subsequent status events and host snapshots preserve the generated title; settings toggles control display.
- Tab rendering and drag/layout labels agree; other tab kinds retain their behavior.

Tasks:
1. Add regression tests and demonstrate failure.
2. Reuse deriveGeneratedTabTitle and patchTab in the Native Chat status projection, carry generated labels through rendering and host mirrors.
3. Run targeted tests, renderer typecheck, scoped lint, and renderer build. Independent native read-only review.
4. Prepare a reversible installed-app patch matching exact version/hash; activate only when it can preserve active sessions. If restart is needed, leave a concrete tested artifact and document the gate.

Verification commands: ORCA_BACKGROUND_LAUNCH=1 pnpm exec vitest run --config config/vitest.config.ts <target tests>; pnpm tc:web; pnpm exec oxlint <changed sources>; ORCA_ELECTRON_VITE_TARGET=renderer pnpm run build:electron-vite --config config/electron-vite-target.config.cts --ignoreConfigWarning.

Initial state: clean isolated checkout; original /home/gion repository has unrelated dirty files, untouched. Runtime RPC works outside sandbox. No app restarts or commits authorized by this phase.

Checkpoint: tasks 1–3 PASS (94 tests/9 files, renderer typecheck, scoped lint, renderer build, independent review). Task 4 package and guarded rollback prepared at /home/gion/.local/state/orca-native-chat-title-fix-20261002; installed/activated NO. 3,806 non-renderer entries unchanged. Pending gate: explicit application/restart approval at a safe conversation boundary, then visible Native Chat verification. No unrelated changes or commits.

v1 activated with user authority; archive hash and runtime verified live. Follow-up found latestPrompt resumed from an acknowledgement and generated "Da ai acordul". v2 selects the first substantive user message from the existing capability-gated conversation outline, repairs automatic labels, skips continuation/harness inputs, and preserves manual names. 102 tests/10 files, renderer typecheck/lint/build/diff PASS; independent review PASS. Prepared v2 state at /home/gion/.local/state/orca-native-chat-title-fix-20261002/v2, with automatic persisted-title check after restart. User's application/restart authority retained. Activation waits for system authentication and normal app exit; no forced shutdown. Actual visible UI verification UNKNOWN.

Final verification: v2 installed/activated YES, hash matches manifest, runtime reachable after restart (PID 751109); current session title from original prompt persisted and automatic comparison PASS. No commits or unrelated edits. Pixel-visible verification UNKNOWN; generation and persisted renderer state verified live.

v3 display correction: user screenshot FAIL (Codex Chat still visible). SortableTab displays tab.title directly; native adapter failed to resolve it, despite carrying generatedTitle. Native adapter now uses resolveUnifiedTabLabel for title. Actual DOM rendering regression (enabled/disabled/manual) proves pre-fix failure and post-fix PASS. 104 tests/10 files plus renderer typecheck/lint/build PASS. v3 staged under state/v3; live post-restart visual confirmation pending, distinct from persisted-title PASS. No broad code changes or new authority required.
