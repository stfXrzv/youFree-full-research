# Shared Agent Instructions

## Resume after a Codex restart

Before resuming work, read:

- `C:\Users\Stf x Rzv\.codex\codex_watchdog\state.json`
- the final line of `C:\Users\Stf x Rzv\.codex\codex_watchdog\events.log`

If the last event is `crashed_restarted`, continue from the latest recorded
checkpoint instead of restarting the investigation.

`AI_BRIDGE/PLAN_FINAL_V1.md` is the canonical plan.

At the beginning of each task:

1. Read the canonical plan.
2. Read `DECISIONS.jsonl`, `STATUS_CODEX.md`, and `STATUS_WORK.md`.
3. Read the inbox addressed to the active agent.

At the end of each task:

1. Update only the active agent's status file.
2. Append decisions to `DECISIONS.jsonl`.
3. Append measured evidence to `TEST_RESULTS.jsonl`.
4. Write a dated handoff for the other agent.

Rules:

- Do not silently change accepted decisions.
- Separate resolver success from readable media-byte success.
- Do not claim a gate passed without reproducible evidence.
- Never store cookies, OAuth credentials, API secrets, signed media URLs, or raw private traces in this repository.
- Do not edit the same mutable file concurrently. Use the ownership boundaries in `README.md`.
