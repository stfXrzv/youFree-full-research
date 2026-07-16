# Phase 0 — Browser transport research for Gate A

Date: 2026-07-15  
Scope: research and reproducible test design only; no Gate A execution in this document.  
Constraints: browser-only on the user's device and IP; no extension, native bridge/app, Colab, proxy, relay, VPS/webhost media path, or server-side resolver.

## Executive finding

Gate A is **UNTESTED**, not passed and not failed.

The first implementation should test transport before loading Pyodide. A browser can call `youtubei/v1/player` only under ordinary Fetch/CORS rules. A request that produces a readable `Response` can be inspected even when its HTTP status is an error. A rejected fetch does not expose an HTTP status, headers, or body; it must be recorded as `network_or_policy_error` with `status_unknown`, not asserted to be `403` or “CORS” without separate evidence. A `no-cors` request can be useful as a reachability control, but its opaque response cannot satisfy Gate A.

The current yt-dlp client registry has also moved beyond the client names in `PLAN_FINAL_V1.md`. At the pinned source revision below, `android_vr` and `web_safari` are current defaults, while `ios_music`, `android_music`, `tv_embedded`, and `mediaconnect` are not current registered clients. The Phase 0 matrix should therefore prioritize current definitions and retain the plan's four names only as explicitly pinned legacy experiments.

## Source boundary

YouTube's Innertube endpoint and client profiles are not a public, stable browser API. The request shape and client inventory below are confirmed from the current yt-dlp implementation, not from a YouTube compatibility promise.

For reproducibility, this research pins yt-dlp commit [`aefce1eea4d0b6bab1ec2bd3beff09bff91a39c8`](https://github.com/yt-dlp/yt-dlp/commit/aefce1eea4d0b6bab1ec2bd3beff09bff91a39c8) (2026-07-14). Client versions are volatile data: the test implementation must snapshot the selected client definitions and record their source commit plus a deterministic hash.

## Confirmed browser facts

### Fetch and CORS

- `fetch()` is available in `Window` and Web Workers. Moving the same request to a Worker changes scheduling and isolation, not CORS privileges. [Fetch Standard](https://fetch.spec.whatwg.org/)
- A cross-origin `POST` with `Content-Type: application/json` is not a CORS-safelisted request. Adding `X-YouTube-Client-Name`, `X-YouTube-Client-Version`, or `X-Goog-Visitor-Id` also makes the request non-simple. The browser performs an `OPTIONS` preflight before the POST. [CORS-safelisted request headers](https://fetch.spec.whatwg.org/#cors-safelisted-request-header), [CORS-preflight fetch](https://fetch.spec.whatwg.org/#cors-preflight-fetch)
- A JSON string sent as `text/plain;charset=UTF-8`, with no non-safelisted request headers, is a simple-request candidate and avoids preflight. Whether the endpoint accepts and authorizes that shape is an experiment, not a confirmed fact.
- JavaScript cannot set or spoof forbidden browser-controlled headers such as `Origin`, `Host`, `Cookie`, `Content-Length`, or `Sec-*`. In particular, the PWA cannot pretend that its request originated from YouTube. [Forbidden request-header names](https://fetch.spec.whatwg.org/#forbidden-request-header)
- Use `credentials: 'omit'` explicitly. The Phase 0 lab must neither send nor require the user's YouTube cookies.
- If CORS succeeds, Fetch resolves to a readable response even for HTTP 4xx/5xx; `status`, `ok`, a CORS-filtered header set, and the body are observable.
- If preflight fails, the final response fails its CORS check, or a network/policy failure occurs, Fetch rejects and supplies no `Response`. The page cannot distinguish CORS, DNS, TLS, offline state, CSP/mixed-content policy, or certain server/network failures from the rejection alone.
- With `mode: 'no-cors'`, only safelisted methods and headers may be used. The resulting cross-origin response is `opaque`: `status` is `0`, `ok` is `false`, URL and headers are hidden, and `body` is `null`. An opaque 200 and opaque 404 are indistinguishable to script and cannot pass Gate A. [Opaque filtered response](https://fetch.spec.whatwg.org/#concept-filtered-response-opaque)
- `redirect: 'manual'` can produce an `opaqueredirect` response whose status and `Location` are hidden. Use `redirect: 'follow'` for the primary matrix and record `response.redirected` only when a readable response exists.
- `ResourceTiming` without `Timing-Allow-Origin` masks most cross-origin details and cannot recover an HTTP status hidden by Fetch/CORS. An entry's presence or absence may be recorded as diagnostic evidence, never as proof of a particular HTTP outcome. [Resource Timing — cross-origin resources](https://www.w3.org/TR/resource-timing/#sec-cross-origin-resources)

### Cross-origin script execution is not source readability

A classic `<script src>` load, and classic-worker `importScripts()`, may execute a cross-origin classic script without exposing its source text when policy permits; module scripts require CORS. Execution/onload does not reveal the response body, headers, or useful status and therefore is **not** a `base.js readable` result. It also executes remote code with capabilities available in the app's document/worker context, so an `importScripts(base.js)` experiment is out of the initial Gate A path pending a separate security review. [HTML Standard — scripting](https://html.spec.whatwg.org/multipage/scripting.html)

## Confirmed yt-dlp implementation facts

At the pinned revision:

- yt-dlp sends the player request to `https://{host}/youtubei/v1/player?prettyPrint=false`.
- Its player body contains `context`, `videoId`, `playbackContext.contentPlaybackContext.html5Preference = 'HTML5_PREF_WANTS'`, `contentCheckOk = true`, and `racyCheckOk = true`. It may add `signatureTimestamp` and `serviceIntegrityDimensions.poToken` when required.
- Native yt-dlp normally supplies request headers including client name/version, visitor ID, `Origin`, and User-Agent. A browser-only implementation cannot reproduce the forbidden headers exactly and must test browser-valid shapes rather than claim CLI parity.
- Current default clients are `android_vr` and `web_safari`; the JS-less default is `android_vr`.
- Current registered families are `web`, `web_safari`, `web_embedded`, `web_music`, `web_creator`, `android`, `android_vr`, `ios`, `visionos`, `mweb`, `tv`, `tv_downgraded`, and `tv_simply`. [Client definitions](https://github.com/yt-dlp/yt-dlp/blob/aefce1eea4d0b6bab1ec2bd3beff09bff91a39c8/yt_dlp/extractor/youtube/_base.py#L97-L417), [supported clients](https://github.com/yt-dlp/yt-dlp/blob/aefce1eea4d0b6bab1ec2bd3beff09bff91a39c8/README.md#L1859-L1883)
- `tv_embedded` was removed as broken in January 2026. It must not be represented as a current client. [Removal commit](https://github.com/yt-dlp/yt-dlp/commit/8eb794366eb69e7377ff88eed7929c00195c8d74)
- yt-dlp now delegates YouTube JavaScript challenge handling to its external-JS/EJS path; the integration API is documented as private and unstable. That belongs after transport validation, not inside Phase 0. [yt-dlp EJS guide](https://github.com/yt-dlp/yt-dlp/wiki/EJS)
- PO-token requirements and exemptions vary by client and rollout. They are constraints to log, not guarantees. [yt-dlp PO Token guide](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide)

## Canonical player request template

The lab should build one frozen logical payload and vary only the transport shape and client context:

```json
{
  "videoId": "<fixture-id>",
  "context": {
    "client": {
      "clientName": "<snapshot-client-name>",
      "clientVersion": "<snapshot-client-version>"
    }
  },
  "playbackContext": {
    "contentPlaybackContext": {
      "html5Preference": "HTML5_PREF_WANTS"
    }
  },
  "contentCheckOk": true,
  "racyCheckOk": true
}
```

Do not silently add API keys, cookies, visitor IDs, PO tokens, or signed media URLs. If a later experiment adds a non-secret fixture field, version the fixture schema and record it.

### Player transport shapes

| ID | Mode | Content-Type | Custom YouTube headers | Expected browser behavior | Gate value |
|---|---|---|---|---|---|
| `cors_json_xheaders` | `cors` | `application/json` | client name/version only | Preflight, then POST only if allowed | Canonical-parity probe |
| `cors_json_min` | `cors` | `application/json` | none | Preflight due to content type | Isolates custom-header effect |
| `cors_text_min` | `cors` | `text/plain;charset=UTF-8` | none | Simple POST candidate | Best no-preflight readability probe |
| `no_cors_text_min` | `no-cors` | `text/plain;charset=UTF-8` | none | Opaque response if dispatched | Reachability control only; cannot pass |

Fixed fetch options: `credentials:'omit'`, `redirect:'follow'`, `cache:'no-store'`, `referrerPolicy:'no-referrer'`, 15-second timeout. Run each case serially from both `Window` and `DedicatedWorkerGlobalScope`; concurrency would confound rate limits and timing.

Test hosts in this order:

1. `www.youtube.com` — primary implementation host.
2. `youtubei.googleapis.com` — controlled alternative supported by yt-dlp's Innertube host configuration; do not assume equivalent CORS or response policy.
3. `music.youtube.com` — only for a current `web_music` control, not for every client.

## Client matrix

The objective is to test transport and readable schema, not to guess a single “magic client.” Every profile is a frozen fixture taken from the pinned source revision.

| Tier | Client | Why test | Confirmed limitation / expectation |
|---|---|---|---|
| P0 | `android_vr` | Current JS-less default; minimizes base.js dependency | No made-for-kids availability in current implementation notes; future/server rollout behavior remains variable |
| P0 | `web_safari` | Current default; current implementation may expose premerged HLS paths | HLS/PO-token behavior is rollout-sensitive; useful URLs do not imply fetch-readable bytes |
| P0 | `visionos` | Current JS-less mobile-family control | Not a promise of 1080p/1440p or no-token playback |
| P0 | `mweb` | Browser-family transport comparison | Current yt-dlp guidance commonly pairs GVS access with PO-token support |
| P1 | `web` | Baseline web response and challenge markers | Current guidance reports SABR/PO-token constraints |
| P1 | `android`, `ios` | Mobile-native-family response comparison | Player/GVS PO-token enforcement may apply |
| P1 | `tv`, `tv_simply` | Non-mobile controls with different auth/token behavior | DRM/SABR or GVS-token constraints may apply depending on profile |
| P1 | `web_embedded` | Embeddable-video control | Only relevant for embeddable fixtures |
| Legacy | `ios_music`, `android_music`, `tv_embedded`, `mediaconnect` | Preserve original plan hypotheses | Not current registered client names at the pinned revision; run only from exact historical snapshots and label `legacy_plan` |

`tv_embedded` should be disabled by default because it was explicitly removed as broken. Legacy rows must never borrow current versions or fabricated headers.

## `base.js` discovery and readability matrix

Only run this stage when a readable player response contains unresolved signature/challenge evidence or lacks directly usable format URLs.

| Step | Request | Pass assertion |
|---|---|---|
| J1 | `GET` watch page with `mode:'cors'`, credentials omitted | Body text readable; extract `PLAYER_JS_URL` or `WEB_PLAYER_CONTEXT_CONFIGS.*.jsUrl` without persisting the page |
| J2 | `GET https://www.youtube.com/iframe_api` with `mode:'cors'` | Body text readable; extract a player revision only if J1 did not supply one |
| J3 | `GET` the exact discovered `/s/player/<revision>/.../base.js` with `mode:'cors'` | Non-empty source text readable; record SHA-256, byte count, revision, and challenge-marker summary |
| J4 | Same exact URL with `mode:'no-cors'` | Expected opaque control; must be recorded as not readable |
| J5 | Classic `<script src>` load control | `load`/`error` only; never a readability pass |

Do not hard-code a stale player revision as the primary path. yt-dlp's current fallback discovers the revision through the iframe API and constructs a `player_ias.vflset/en_US/base.js` URL. A fixture revision may be used only to validate recorder semantics.

## Recorder schema: observation before diagnosis

Persist confirmed observations and hypotheses in separate fields.

### Confirmed observation fields

| Field | Values / rule |
|---|---|
| `stage` | `construct`, `fetch`, `headers`, `body`, `timing` |
| `settlement` | `response` or `rejection` |
| `outcome` | `readable_response`, `readable_http_error`, `opaque`, `opaqueredirect`, `caller_abort`, `timeout`, `network_or_policy_error`, `body_read_error`, `request_construction_error` |
| `status_visibility` | `known`, `hidden`, `none`; store numeric status only when `known` |
| `response_type` | Browser-provided `basic`, `cors`, `opaque`, `opaqueredirect`, or absent |
| `headers_visibility` | `cors_filtered`, `empty_filtered`, `none`; persist an explicit allowlist only |
| `body_visibility` | `readable`, `filtered_null`, `not_obtained`, `read_failed` |
| Body summary | Byte count, SHA-256 and schema/marker summary; never raw response or signed URLs |
| Error summary | `error.name`; sanitized message for diagnostics; abort signal state/reason |
| Environment | app origin, secure-context flag, Window/Worker, browser engine and exact build, OS/device class, display mode, network class |
| Timing | start/end/duration plus feature-detected ResourceTiming fields; never infer hidden HTTP status |

### Inference fields

Use a separate `hypotheses[]` array such as `cors_or_preflight`, `dns_tcp_tls`, `offline`, `csp_or_mixed_content`, or `server_varied_by_origin`, each with `confidence` and named supporting evidence. The label `cors_blocked_inferred` is permitted only as an inference. A naked `TypeError` must remain `network_or_policy_error` plus `status_unknown`.

Before fetch, record the method and the headers visible on the constructed `Request`. This catches forbidden/stripped header assumptions without logging sensitive values.

## Reproducible execution matrix

Implement in stages so one failure has a narrow meaning.

### Stage R0 — validate the recorder

Use tiny controlled fixtures, never a media proxy:

- same-origin readable 200 and 404;
- cross-origin CORS 200 and CORS 404;
- cross-origin response without ACAO;
- `no-cors` 200 and 404, both expected opaque;
- followed and manual redirect;
- caller abort, deterministic timeout, invalid DNS, and offline run.

Assertions must be automated. In particular, demonstrate that CORS-enabled 404 is readable and opaque 200/404 cannot be distinguished.

### Stage R1 — isolate player transport shape

Use only `android_vr`, one ordinary public VOD, and the four transport shapes. Cross product:

- hosts: `www.youtube.com`, `youtubei.googleapis.com`;
- contexts: Window, Dedicated Worker;
- three serial repetitions per cell.

Advance only a readable shape. Do not spend Pyodide effort if every candidate remains unreadable.

### Stage R2 — compare clients

For every transport shape that passed R1, run P0 clients first, then P1 controls. Run legacy clients only as separately versioned historical fixtures. Store a normalized response summary:

- `playabilityStatus.status` and sanitized reason category;
- matching `videoDetails.videoId`;
- whether `streamingData` exists;
- format counts grouped by progressive/video-only/audio-only/HLS/DASH;
- height, mime/container and codec family;
- direct `url` versus `signatureCipher`/`cipher` counts;
- presence of `s`, `n`, `spc`, PO-token or SABR-related markers;
- whether candidates include `>=1080` and `>=1440` video plus a separate audio stream.

Never persist full media URLs, signatures, visitor data, API keys, tokens, cookies, or raw bodies.

### Stage R3 — discover and read `base.js`

Run J1–J5 only for clients whose readable response demonstrates a need. Pin the discovered revision per run, hash the readable source in memory, and export only structural markers.

### Stage R4 — browser/device matrix

Repeat passing R1/R2 cells on:

- Chromium desktop and Android;
- Firefox desktop and, if available, Android;
- Safari macOS and iOS Safari/PWA.

Record exact builds and test both browser-tab and installed/standalone display modes where supported. Do not assume installation changes CORS. Run on Wi-Fi and mobile data where available because server rollout, IP reputation and CDN routing may vary. Gate conclusions are per engine/platform until the evidence supports a broader claim.

### Fixture roles

Freeze IDs and expected categories in versioned test data:

- ordinary public VOD;
- short public regression VOD;
- made-for-kids control;
- age-restricted unauthenticated negative control;
- live content only in a later, separate matrix.

Fixture availability changes; validate and version replacements rather than silently swapping IDs.

## Gate A decision rule

The direct branch of Gate A may pass for a named browser/platform/client/transport tuple only when a reproducible artifact proves:

1. the Player API response body is readable JavaScript data, valid JSON, and `videoDetails.videoId` matches the fixture; and
2. either:
   - **A-direct:** the readable response contains structurally usable direct candidates for the target: video-only `>=1080p` (and separately report `>=1440p`) plus audio, with no unresolved `signatureCipher`, `s`, or required `n` transformation; or
   - **A-js-transport-candidate:** the response exposes the required challenge inputs and the exact discovered `base.js` source text is readable, non-empty, and pinned by revision/hash.

`A-js-transport-candidate` is **not yet a full Gate A pass**. The JS branch remains `PENDING_SOLVER` until the project reproducibly derives and applies the required `s`/`n` transformations and demonstrates structurally usable output for the same fixture. Phase 0 should establish the transport prerequisite without overstating solver completion.

This is a transport/resolver gate. It does **not** prove that Googlevideo bytes are fetch-readable, downloadable into IndexedDB/OPFS, muxable, or playable. Those remain Gate C/D concerns.

The following are never a Gate A pass:

- DevTools can display the request while page JavaScript cannot read it;
- HTTP status is assumed from a `TypeError`;
- an opaque response was cached;
- `<script onload>` fires or `importScripts()` executes remote code;
- a media element can play a URL;
- a URL exists but still contains an unresolved cipher/challenge;
- a server-side yt-dlp invocation succeeds.

## Confirmed facts versus hypotheses to test

| Statement | Classification |
|---|---|
| Workers and Pyodide do not bypass Fetch/CORS | Confirmed platform fact |
| `application/json` and YouTube `X-*` headers trigger preflight | Confirmed platform fact |
| `text/plain` minimal POST can avoid preflight | Confirmed platform fact |
| YouTube will accept the minimal `text/plain` request and return readable CORS | **Hypothesis** |
| `www.youtube.com` and `youtubei.googleapis.com` expose identical CORS policy | **Hypothesis** |
| A current JS-less client yields directly usable 1080p/1440p URLs without PO token | **Hypothesis** |
| `web_safari` HLS can meet the target on all browsers/IPs | **Hypothesis** |
| Exact discovered `base.js` can be fetched as readable text from the PWA origin | **Hypothesis** |
| An installed PWA has more CORS privilege than a normal tab | False assumption; test only for conformance differences, not privilege |
| An opaque response can be parsed, muxed or placed into IndexedDB by JS | False under the Fetch response model |

## Privacy and safety rules

- No cookies, OAuth credentials, API keys, visitor IDs, PO tokens, signed media URLs, raw player bodies, watch pages, or base.js source are committed.
- Redact query values and hash ephemeral URLs in memory; store only host, path class, parameter-name set, format metadata and normalized challenge markers.
- Use credentials omitted in every Phase 0 request.
- Keep the recorder passive: no retries that bypass access controls, no proxy fallback, no remote media transfer.
- Rate-limit serial runs and identify automated repeats in local UI/logs so the user can stop them.

## Handoff to Codex

1. Implement the Phase 0 recorder and R0 controlled assertions without changing Gate status.
2. Snapshot client definitions from pinned yt-dlp commit `aefce1e...` and hash the fixtures.
3. Run R1 exactly as specified: one ordinary VOD, `android_vr`, four transport shapes, two hosts, Window + Worker, three serial repeats.
4. Export only sanitized JSONL observations with `status_unknown` on rejected fetches.
5. If at least one R1 response body is readable, run P0 client rows and only then J1–J5 when the response proves JavaScript challenges are needed.
6. Report Gate A per browser/platform tuple as `PASS`, `FAIL`, or `BLOCKED`, attaching recorder output and assertions. Until those artifacts exist, keep Gate A `UNTESTED`.

Do not start Pyodide, EJS adaptation, media downloading, muxing, IndexedDB/OPFS transfer, or social-platform work from this research alone.

## Primary sources

- [Fetch Standard](https://fetch.spec.whatwg.org/)
- [HTML Standard — scripting](https://html.spec.whatwg.org/multipage/scripting.html)
- [Resource Timing Level 2](https://www.w3.org/TR/resource-timing/)
- [yt-dlp YouTube client definitions at pinned revision](https://github.com/yt-dlp/yt-dlp/blob/aefce1eea4d0b6bab1ec2bd3beff09bff91a39c8/yt_dlp/extractor/youtube/_base.py#L97-L417)
- [yt-dlp player-request implementation at pinned revision](https://github.com/yt-dlp/yt-dlp/blob/aefce1eea4d0b6bab1ec2bd3beff09bff91a39c8/yt_dlp/extractor/youtube/_video.py#L2681-L3070)
- [yt-dlp player/base.js discovery implementation at pinned revision](https://github.com/yt-dlp/yt-dlp/blob/aefce1eea4d0b6bab1ec2bd3beff09bff91a39c8/yt_dlp/extractor/youtube/_video.py#L1879-L2255)
- [yt-dlp EJS guide](https://github.com/yt-dlp/yt-dlp/wiki/EJS)
- [yt-dlp PO Token guide](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide)

