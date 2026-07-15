# VibeStream Browser Resolver

Private coordination repository for the browser-only resolver experiment.

This repository is the shared source of truth for Codex and ChatGPT Work. It intentionally excludes cookies, OAuth credentials, signed media URLs, private logs, and large generated artifacts.

## Agent workflow

At the start of every task:

1. Read `AI_BRIDGE/PLAN_FINAL_V1.md`.
2. Read `AI_BRIDGE/DECISIONS.jsonl` and both status files.
3. Read the inbox addressed to you.

At the end of every task:

1. Update only your status file.
2. Append new decisions and test results; do not rewrite history.
3. Add a handoff for the other agent.
4. Never commit secrets, cookies, OAuth data, signed media URLs, or raw private traces.

## Ownership

- Codex writes `STATUS_CODEX.md` and `to_work/`.
- ChatGPT Work writes `STATUS_WORK.md` and `to_codex/`.
- `PLAN_FINAL_V1.md` is canonical and changes only with an explicit recorded decision.

