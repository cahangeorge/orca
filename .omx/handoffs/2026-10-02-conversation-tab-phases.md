# Conversation tab phases — delivery checkpoint

Date: 2026-10-02. Owner: Codex. Branch: `fix/native-chat-auto-title-20261002`.
Feature commit: `2383e6225d139488dfbd903666c8093ebb95d02b`. Base: `75ea50273328d9bd5465170d10a098711d61b5a4`.

## Scope and verdict

LOCAL FEATURE PASS; FULL SUITE FAIL; INSTALLATION HOLD.

Codex Native Chat phases come from host-owned root journal evidence. Tab backgrounds
show phase; canonical agent icons show execution state. Titles stay independent.
Manual color > manual phase > automatic evidence > neutral. The reset clears both
manual overrides atomically. Settings for automatic backgrounds and icons are independent.

PTY automatic phase inference is unsupported: neutral/manual fallback is deliberate.
Other agents and mobile phase UI are outside this feature. Unknown/legacy edit provenance
cannot claim implementation. Restored sessions show last-known phase and neutral status.

## Verification evidence

- Isolated feature candidate: 188 tests / 16 files PASS, zero new quality findings.
- Cumulative title + feature target: 200 tests / 18 files PASS.
- Final shared icon, group projection and real SortableTab: 25 tests / 3 files PASS.
  This includes the red→green regression for phase dropped by the real group adapter.
- Host cold-restoration runtime driver case PASS (writer); producer negatives independently checked.
- `tc:web`, `tc:node`, Git diff check, normal precommit lint/format hooks and production build PASS.
- Real hidden Electron renderer DOM: 10 phase/theme scenes, 40 status transitions PASS.
  Minimum text contrast 14.37:1; minimum essential status contrast 3.9668:1.
  Captures export actual DOM/CSS through an offscreen hidden window, not a complete native-window screenshot.
  No test window was shown. Temporary profiles isolate HOME and disable telemetry.
- Full suite invoked once with two workers and bail=1: 733 PASS, 1 FAIL, 59 skipped;
  18 file PASS, 2 file FAIL out of 10,135 discovered files. Unmodified SSH suite failed because
  Electron binary was missing (subsequently repaired); an unmodified startup GPU-flags test failed.
  Full suite remains FAIL/incomplete; it was not repeated.
- Cumulative quality gate retains three preexisting title-patch findings (two assertions, timer cleanup rule).
  Feature-only quality gate PASS. Review found and fixed pending-edit, restored-freshness,
  stale-reset, group-adapter and shared test-helper issues. No unresolved feature correctness finding.

Full provider-driven desktop interaction, keyboard/drag behavior in the native window and
remote mixed-version browser interaction remain UNKNOWN; targeted DOM/contracts cover the bounded implementation.

## Artifact and activation gate

Artifact directory: `/home/gion/.local/state/orca-conversation-tab-phases-20261002`.
Production archive SHA256: `9e0291da6863f3a3aeb84c41365a1656f4858da8b4d3ff21bfa3b444b9f15030`.
Installed original SHA256: `42cea9db9f32fecfc65b60499fe2050c3aef79d0a06dd5c553cab583f0384669`.
Verified unchanged outside main/renderer scopes: 3,634 files. Both the original archive and
its unpacked tree are backed up. Source artifact includes the preserved uncommitted title patch.
`installed=false`, `activated=false`; no app restart, push or deployment performed.

Next concrete gate: explicit installation/restart authority, then install archive and matching
unpacked tree together after normal application exit and validate in the user's real workspace.
Rollback restores `original-app.asar` and `original-app.asar.unpacked` together.
Do not independently replace only one member of either pair.

## Dirty-state continuity

The same six tracked title-patch files remain modified; four preexisting title helper/test files
remain untracked. Their work was preserved and excluded from the feature commit. Planning and
checkpoint metadata remain untracked. Prior title checkpoint is archived byte-for-byte at
`.omx/handoffs/2026-10-02-native-chat-title-v3-before-phases.md`.
