# Codex status

Updated: 2026-07-16 19:30 Europe/London

- Phase 0/1 transport recorder and client matrix: complete.
- Gate A: pass.
- Gate B: pass. Pyodide yt-dlp matches desktop yt-dlp for the measured iOS extraction.
- Gate C: resolver/recovery pass; native 1080p adaptive playback remains blocked by open-range 403 behavior.
- Direct progressive transfer: pass at 360p for tested videos, including opaque Cache Storage and strict offline playback.
- Gate D1: partial. Native MP4 works only when Googlevideo serves attachment behavior.
- Gate D2: fail. Opaque media cannot become readable Blob, ArrayBuffer, OPFS data or captureStream output.
- Gate D3: pass when readable Blob inputs exist, including IndexedDB, SHA-256, playback and fragmented MP4 validation.
- Gate D overall: fail because D2 is mandatory.
- Mobile 390px QA: pass.
- Watchdog remains disabled as requested.
- Final evidence: `AI_BRIDGE/FINAL_RESULTS_V1.md`.
