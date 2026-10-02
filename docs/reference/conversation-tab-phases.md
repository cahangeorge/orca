# Conversation tab phases

Codex conversation tabs use a tinted background for the work phase and the existing
agent indicator for execution status. Titles and provider identity remain independent.
A verification background means a check was started; it does not certify its result.
Response completion does not finalize an objective.

## Automatic evidence

The execution host projects admitted root journal rows into the existing structured
session status feed. Read/search/list events indicate analysis, structured plans
indicate planning, successfully completed Codex file changes indicate implementation,
and recognized standalone check commands indicate verification. An explicit goal
completion indicates finalized. New goals clear previous completion evidence.

Pending, failed, streamed-preview and legacy edits without `editConfirmed: true`
are not confirmed changes. Prose, generic shell commands, heartbeat updates and
subagent activity do not infer a phase. Journal identity, sequence and existing
host/workspace/session routing scope the evidence. Immutable row classifications are
cached; ordered replay searches backwards from the newest semantic evidence.

Automatic phase is rederived from the durable journal, rather than stored in a second
agent-state store. A disconnected or restored session retains its known phase with
an unconfirmed status and a last-known tooltip. Host ownership and transport freshness
must be established before showing live Native Chat activity.

PTY Codex tabs lack equivalent reliable journal evidence and remain neutral/manual.
Other agents and file/browser tabs retain their existing presentation. Mobile carries
optional presentation metadata but has no new phase UI.

## Controls and compatibility

Background priority is manual color, manual phase, automatic phase, then neutral.
The tab context menu offers manual phases and an explicit reset of phase and color.
Reset sends one atomic tab-properties mutation. Optional `manualWorkPhase` travels
through workspace persistence, RPC and mirrored snapshots; explicit local reset is
protected from delayed snapshot echoes.

Settings → Agents has independent automatic-background and status-icon toggles.
Disabling automatic backgrounds preserves manual choices. Disabling icons keeps the
provider logo and titles. Existing title-generation settings are independent.

The shared journal, status and tab additions are optional. Peers lacking compatible
phase evidence degrade to neutral; unknown manual phases are ignored by decoding.
Tokens in `main.css` define phase surfaces and foregrounds for both themes.

## Verification

Focused tests cover producer-confirmed edits, conservative classification, goal
boundaries, session isolation, cold restoration, real save/reload, RPC compatibility,
manual reset, stale snapshots, settings and the actual tab DOM. Local delivery evidence
and release limitations are recorded in the phase handoff. This feature does not
activate a build in the user's running application.
