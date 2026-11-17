# youFree Browser Resolver

Private implementation and evidence repository for the browser-only resolver experiment.

This repository is the shared source of truth for Codex and ChatGPT Work. It intentionally excludes cookies, OAuth credentials, signed media URLs, private logs, and large generated artifacts.

## Laboratories

- `lab/`: Phase 0/1 transport matrix and the Pyodide + `yt-dlp` resolver path.
- `transfer-lab/`: direct Googlevideo streaming, opaque Cache Storage, strict offline playback, native download policy, OPFS, Background Fetch and capture probes.
- `tests/`: deterministic unit and browser runners for Gate A and Gate B.

Local entry points:

- `http://localhost/aaa/youFree-browser-resolver/lab/`
- `http://localhost/aaa/youFree-browser-resolver/transfer-lab/`

Useful commands:

```text
npm test
npm run test:gate-a
npm run test:gate-b
npm run test:pyodide
npm run test:transfer
npm run test:storage
npm run test:capture
npm run test:background
npm run test:mux
npm run test:mux:fmp4
```

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

