# Lab

`index.html` is the Phase 0/1 Gate A browser lab.

- The Player API requests run in a module Web Worker.
- Requests use `credentials: omit` and do not use cookies.
- No Chrome extension, native bridge, Colab, or server media relay is involved.
- A VPS/webhost may serve these static files, but media probes go directly from the user device to the media host.
- Runtime signed URLs stay in memory only and are removed from exported reports.

Run through HTTP, for example:

```text
http://localhost/aaa/youFree-browser-resolver/lab/
```

Use **Export redacted JSON** to capture reproducible evidence, then append only the measured verdict to `AI_BRIDGE/TEST_RESULTS.jsonl`.
