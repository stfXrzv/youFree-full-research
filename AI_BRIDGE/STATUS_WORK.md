# ChatGPT Work status

Updated: 2026-07-15

- Phase 0 Gate A transport research is complete: `AI_BRIDGE/to_codex/PHASE0_TRANSPORT_RESEARCH.md` (research commit `18fcdc9983ded647eca342eb5a3482a61fe69753`).
- Gate A remains **UNTESTED**: this task produced source-backed research and a reproducible matrix, not live browser evidence.
- Key boundary: rejected Fetch is `network_or_policy_error` with `status_unknown`; an opaque response cannot satisfy Gate A.
- Client fixtures must be pinned. Test current profiles first; keep `ios_music`, `android_music`, `tv_embedded`, and `mediaconnect` as separately labeled legacy probes only.
- Codex handoff: implement recorder controls (R0), freeze and hash client fixtures, then run R1 with `android_vr` across four request shapes, two hosts, Window + Dedicated Worker, three serial confirmations for readable candidates.
- Do not start Pyodide/EJS or media transfer until the transport evidence justifies it. The JS branch remains `PENDING_SOLVER` when `base.js` is readable but `s/n` transformations have not been proven.
- Absolute scope preserved: browser-only on the user's device/IP; no extension, native bridge/app, Colab, proxy, relay, or VPS/webhost media path.
