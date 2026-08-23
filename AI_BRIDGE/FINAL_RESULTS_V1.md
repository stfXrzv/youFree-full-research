# Final Results V1

Date: 2026-07-16

Constraints tested:

- browser/PWA only;
- no Chrome extension;
- no native/local companion;
- no VPS or webhost media relay;
- large media traffic stays between Googlevideo and the user's device;
- test downloads remain below 100 MB.

## Gate matrix

| Gate | Result | Evidence |
| --- | --- | --- |
| A: browser transport | PASS | Player API is CORS-readable. Android exposes progressive 360p; iOS exposes direct adaptive formats up to 1080p plus audio. |
| B: Pyodide yt-dlp | PASS FOR GETURL ONLY | Pyodide/pyxhr URL extraction matches desktop yt-dlp exactly for title, duration, 24 direct formats and itags; it does not download media bytes into the browser. |
| C: local resolver | PASS WITH PLAYBACK LIMIT | Finite 1080p video/audio probes return 206 and automatic re-resolve recovers from an expired URL. Native adaptive playback fails because Chrome requests `Range: bytes=0-` and Googlevideo returns 403. |
| D1: native file download | PARTIAL | A valid MP4 downloaded directly for some assets. Other assets remain inline and cannot be forced into attachment behavior. |
| D2: automatic byte access | FAIL | Opaque response converts to zero-byte Blob/ArrayBuffer and writes zero bytes to OPFS. Background Fetch and captureStream also fail. |
| D3: local mux/persistence | PASS IF D2 INPUT EXISTS | Browser mux, IndexedDB round-trip, SHA-256 and playback pass with readable inputs. Regular MP4 and fragmented MP4 branches both validate. |

Gate D is failed overall because D2 is mandatory for automatic adaptive download.

## What works now

1. Resolve YouTube metadata and direct URLs on the user's own IP in a JavaScript Worker; this is the `geturl`/resolver result, not a browser-side yt-dlp download.
2. Run the Pyodide/pyxhr path only as a browser-side `geturl`/URL-resolution fallback.
3. Detect 1080p adaptive video and separate audio and refresh rejected/expired URLs automatically.
4. Stream a combined progressive MP4 directly from Googlevideo with audio.
5. Save the combined progressive response opaquely in Cache Storage.
6. Play that cached response with the browser offline and with zero Googlevideo network requests.
7. Download a real MP4 directly when the signed asset itself returns attachment behavior.
8. Mux readable video/audio Blobs locally and persist the final MP4 in IndexedDB.

## What does not work under the strict constraints

1. Reading adaptive Googlevideo bytes with JavaScript when CORS is withheld.
2. Turning an opaque Cache Storage response into a readable Blob or ArrayBuffer.
3. Copying opaque bytes into OPFS or IndexedDB as a real media Blob.
4. Capturing the cross-origin playback through `captureStream()` or a same-origin Service Worker alias.
5. Using Background Fetch to bypass the same cross-origin failure.
6. Forcing universal `Content-Disposition: attachment` with `title`, `cnr`, `xtags`, download-like parameters, redirects or a Service Worker.
7. Universal automatic 1080p/1440p file export without a relay or privileged client component.

## Product-safe architecture

Primary path:

```text
PWA JS Worker -> YouTube Player API -> direct progressive URL
Browser -> Googlevideo -> media element / opaque Cache Storage
```

Optional resolver fallback:

```text
PWA Worker -> Pyodide + yt-dlp + pyxhr -> direct URLs
```

User-visible policy:

- Offer direct streaming and app-private offline playback when a progressive format exists.
- Offer `Download MP4` only after attachment capability is positively detected.
- Keep 1080p metadata and URL re-resolution available, but do not label it as downloadable until D2 changes.
- Do not route media through PHP/VPS merely to make the UI report success.

## Reproduction

```text
npm test
npm run test:gate-a
npm run test:pyodide
npm run test:gate-c
npm run test:transfer
npm run test:storage
npm run test:capture
npm run test:background
npm run test:mux
npm run test:mux:fmp4
```

Sanitized evidence is stored under `artifacts/` and `transfer-lab/artifacts/`. No signed media URL, cookie, OAuth credential or API secret is committed.
