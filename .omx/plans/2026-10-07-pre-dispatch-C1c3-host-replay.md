# C1c3 execution-host retained replay

Root sole writer. Native architecture and final verification read-only. Seven-file bounded exception to usual5: existing queue/store/journal/host/materializer plus one-line export of strict journal validator and one integration test. Composition requires both stores and host; preserve validation via reuse rather than duplicateSQL or drop guarantees. No publicRPC/capability/UI/model launch/dispatch.

## Acceptance

Host entry serializes session via existing tasks queue, then store queue/filelock fresh-primary detached read, then existing journal queue/deferred SQL snapshot. Never use transact refresh/rewrite/refence; never open an absent journal, acquire/reserve/reconcile/wake delivery or publish a tab. Fresh loader must reject absent/corrupt/backup/future/untrusted host/normalization-rewrite evidence, selected unreadable record. Read callback sees detached cloned getters, no changes to original cache/revision or store bytes. Filelock uses existing temporarylock/permission coordination; no zero-filesystem-effects claim.

Strict existing C1c2 SQL validator reused on OWNED already-open connection under BEGIN DEFERRED/ROLLBACK; no new SQLiteopen, schemaDDL, repair, writes or notifications byread. SQLite may coordinate existing SHM read marks; claim preserved DB/WAL/store durablecontent, not identical SHM bytes. Atomic SQL snapshot reflects committed horizon, not drained provider-event sink. Reject closed/readOnly/schema/projection/identity/handle/fence/repair mismatch. Queued writes preceding read are included; later writes orderedafter. Detached snapshot cannot mutate live journal.

C1b settlement and C1c2 materialization mandatory. Failed settlement no journalaccess. Pending/unknown/missing/expired evidence never authorizes firstcreate. Resample clock after locks and after journal wait; expiry, invalid clock or rollbackUNKNOWN. Local-native folder/worktree supported; SSH/WSL refused. Authenticated RPCscope/policy/client-ID provenance remains separate HOLD.

## Verification

TDD meaningful RED/GREEN. Real temporary file-backed stores/journals with mocked provider only. Fresh external updates vs stalecache, backup/missing/future schema, expiry queuedlock/journalwait, pending/failed/nojournal, concurrent append/close, source corruption, clones, queue continuation after refusal, no sourcepersist/ownergrant or publication fromread. Relevant fullphase tests; node/web TS, Oxfmt, sixlint, globalchanged-code baseline, diff, independent review/preservation/handoff. No app/model/provider/globalconfig changes.

# C1c3 scope amendment

The seven-file exception is extended to eight files: add `src/main/native-chat/agent-session-journal/journal-owned-retained-read.ts`. The repository 300-code-line limit prevents putting the serialized owned-connection reader alongside the existing filesystem-copy reader. Keep ownership/queue/transaction composition in this new small module and reuse the strict SQL validator unchanged. This is local reversible work within C1c3; no public routing or behavior activation.

The existing strict SQL reader is renamed/exported and its callsite updated (three surgical lines, rather than the spec's shorthand “one-line export”). No validation semantics are changed.
