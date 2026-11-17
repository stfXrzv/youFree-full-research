# Browser Resolver Milestone Closure

Status: resolved / not possible under the strict constraints
Date: 2026-07-18 Europe/London
Repository: `stfXrzv/youFree-browser-resolver`

## User requirement that was tested

Resolve YouTube media on the user's own browser/IP, keep heavy media traffic
off VPS/webhost, avoid Chrome extensions and native companions, then download
adaptive 1080p/1440p video plus audio automatically into browser storage and
mux it locally.

## Final result

- Browser transport and local resolver: working.
- Pyodide plus the custom `pyxhr` yt-dlp path: working for the measured `geturl`/URL-resolution case only; it did not download media bytes in the browser.
- Direct progressive streaming: working with the user's traffic.
- 1080p/1440p URLs: resolvable/probeable in finite ranges, but native adaptive
  playback has an open-range 403 limitation.
- Native file download: partial and dependent on the signed asset's attachment
  behavior.
- Readable adaptive bytes from page JavaScript: not working when Googlevideo
  withholds CORS.
- Opaque Cache Storage, OPFS, Background Fetch and captureStream do not turn
  those bytes into readable Blob/ArrayBuffer data.
- Local mux and IndexedDB persistence: working when readable video/audio Blob
  inputs already exist, but it cannot manufacture those inputs from opaque media.

## Decisive boundary

```text
resolver success != readable media bytes
direct streaming success != automatic offline download
```

The only reliable choices are:

1. Direct progressive stream/offline cache on the user device when the browser
   accepts that source.
2. A same-origin media relay for guaranteed readable bytes and local muxing.
3. A privileged client component such as an extension or native app.

The strict combination of zero media relay, no extension, no native companion,
automatic byte access, and universal adaptive 1080p/1440p download is closed as
not possible with the tested browser APIs and current YouTube responses.

## Future retrieval rule

For any future task touching this topic, read these files first:

1. `AI_BRIDGE/CLOSED_SUMMARY_V1.md`
2. `AI_BRIDGE/PLAN_FINAL_V1.md`
3. `AI_BRIDGE/STATUS_CODEX.md`
4. `AI_BRIDGE/DECISIONS.jsonl`
5. `AI_BRIDGE/TEST_RESULTS.jsonl`

Do not restart the investigation or claim a gate passed without new evidence.
Reopen only if the user explicitly requests it or changes the constraints.

No cookies, OAuth credentials, API secrets, signed media URLs or raw private
traces belong in this repository.
