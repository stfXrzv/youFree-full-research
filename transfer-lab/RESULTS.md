# youFree Browser Transfer Lab

Local URL: `http://localhost/aaa/youFree-browser-resolver/transfer-lab/`

## Confirmed working

- The browser resolves YouTube formats on the user's own IP.
- The combined MP4 fallback transfers directly from `googlevideo.com` to the browser.
- The full opaque response is stored in Cache Storage; metadata is stored in IndexedDB.
- Strict offline playback succeeds with zero new Googlevideo requests.
- No extension, native companion, VPS media relay, or webhost media relay is used.
- Native MP4 download succeeds when Googlevideo returns `Content-Disposition: attachment` for the signed asset.

## Final matrix

| Video | Adaptive detected | Combined direct/offline | Native MP4 |
| --- | ---: | ---: | --- |
| `A9-t86OAtM0` | 1080p | 360p | PASS, 11,454,973 bytes |
| `nZvY6EaKfh8` | about 1080p | about 360p | PASS, 14,927,857 bytes |
| `MryMoDHHf7c` | 1080p | 360p | Not exposed: Googlevideo serves this asset inline |

All three passed direct playback, opaque cache verification, no-relay host verification, and strict offline playback.

## Browser boundaries confirmed by tests

- Adaptive 1080p video/audio responses are not CORS-readable and custom playback is blocked by ORB.
- An opaque Cache Storage response becomes a zero-byte Blob and writes zero bytes to OPFS.
- `captureStream()` throws `SecurityError` for both the original opaque response and a same-origin Service Worker alias.
- Browser downloads bypass/reject the Service Worker opaque passthrough; the download is canceled before media transfer.
- Background Fetch rejects `no-cors`; in `cors` mode it fails with `fetch-error` and downloads zero bytes.
- SABR responses have no `Access-Control-Allow-Origin`; `cors` fails and `no-cors` stays opaque.
- A same-origin PHP or Service Worker redirect cannot preserve `Content-Disposition` after the final cross-origin response.

## Verdict

Pure mobile PWA can provide automatic direct streaming and app-private offline playback without server media traffic. It cannot universally export a real MP4 file or mux adaptive 1080p when Googlevideo withholds CORS and attachment headers.

A universal real-file export requires at least one relaxed constraint: a media relay/CDN, a privileged client component (extension/native/local bridge), or an additional manual browser save action.

## Evidence

- `artifacts/v7-result-A9-t86OAtM0.json`
- `artifacts/v7-result-nZvY6EaKfh8.json`
- `artifacts/v7-result-MryMoDHHf7c.json`
- `artifacts/mobile-qa.json`
- `artifacts/storage-export-probe.json`
- `artifacts/capture-probe.json`
- `artifacts/sabr-cors-probe.json`
- `artifacts/background-fetch-probe.json`
- `artifacts/opaque-download-probe.json`

