# C1c1 — transactional first selected reservation

Root sole writer; native architecture/review read-only. Exactly five files: transaction queue, record store, reservation admission, new selected-reservation module/test. No public RPC/registry/UI/host.attach wiring.

Current APIs await lock/disk refresh; validate at synchronous transaction apply, before token mint or durable writes. Optional host-only admission rejects current backup recovery before fence changes, refreshes clock, forbids every existing/unreadable record and all pending/expired/released replay continuations; legacy callers without admission retain their behavior. No ledger/schema migration.

Internal first-attempt factory mints fresh host-only session/operation IDs using existing shared helpers and copies pinned host scope/account/selection. It returns a one-shot reserve closure, never accepts external retry IDs and never treats C1b UNKNOWN as fresh. Sync C1a validation checks live host scope/catalog against exact reservation after lock refresh. No new ticket automatically on failure/retry; process restart loses the ticket. This fresh capability is an internal alternative; integration with existing client-owned wire IDs/provenance is still HOLD.

Acceptance: genuine RED tests followed by targeted tests including legacy reservation, C1a/C1b, queued clock/catalog/scope drift, current-disk backup recovery, existing/unreadable records, replay continuation refusal, one-shot behavior and zero rejected token/state effects. Node/web/Oxfmt/six focused lint/global gate, native independent verification and preservation hashes.

C1c2 safe retained-journal/wire replay follows separately: ordinary journal open creates/repairs/reconciles and is not read-only. No acquire, attach, journal open/delivery/tab publication in C1c1. No launch/install/credentials/config/commit/deploy/production authority.
