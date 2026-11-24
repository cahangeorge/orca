# Conversation tab installation checkpoint

2026-10-03T05:11:19.913119+00:00 · Codex · source commit 2383e6225d139488dfbd903666c8093ebb95d02b

User `continua` authorizes the offered local installation/restart step. Runtime inspection found concurrent work: 43 workspaces, 2 live PTYs, 9 working Native Chat agents including this conversation. Restart interrupts structured providers. A timing question is pending: wait for other conversations or interrupt now. No app/provider/daemon stopped and no /opt file changed.

PASS: installed archive equals original backup SHA256; original unpacked backup byte inventory equals installed tree; candidate archive and all 2105 external files match manifest.
PASS: installer check mode. Temporary filesystem proof covers check, install, rollback, and rollback after synthetic failure following first rename. Production mutation paths have not run.

Installer: /home/gion/.local/state/orca-conversation-tab-phases-20261002/install-pair.py
Usage: `python3 .../install-pair.py check`; elevated `install` or `rollback` only after normal app and warm daemon shutdown. The installer refuses live Orca processes and unknown archive drift, preserves ownership, restores the original pair on synchronous transaction failure. Interrupted transactions leave named files for inspection; do not blindly retry. This script does not quit, kill or relaunch Orca.

Existing app PID observed: 765801; runtimeId 50bea9de-140c-4600-add1-6043a4f1cfda. Revalidate before any action. Warm daemon PID observed: 89632; contains live PTYs. Do not terminate it without explicit interruption scope or established idle state. Sandbox CLI runtime_unavailable was false-negative; host-side CLI was ready.

Implementation checks and full-suite FAIL/incomplete remain as in 2026-10-02 handoff. Six tracked dirty title-fix files and four untracked title helpers remain preserved; .omx and active-plan metadata also untracked. Index untouched. Installed=false, activated=false.

Next step: resolve pending restart timing, then normal shutdown, verified pair installation and background launch verification.
