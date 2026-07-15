# Plan comun final v1

## Objective

Resolve media URLs on the user's IP in a browser-only PWA, then independently prove whether media bytes can be acquired automatically for local storage and muxing.

The resolver and byte transfer are separate gates. A working resolver does not prove that IndexedDB or local muxing works.

## Phase 0 - Recorder and criteria

Build a JavaScript lab that records:

- request and observable response data;
- `cors_blocked`, `opaque`, or `status_unknown` when HTTP details are hidden;
- YouTube client and `playabilityStatus`;
- formats, itags, codecs, dimensions, content length, and expiry;
- `signatureCipher`, `n`, `s`, and known request headers;
- errors and timings.

Never store or transmit cookies. Signed media URLs remain local and must not be committed.

## Phase 1 - JavaScript Worker transport

From a Web Worker, without Pyodide, test:

- `youtubei/v1/player`;
- `android_vr`, `ios_music`, `android_music`, `tv_embedded`, and `mediaconnect`;
- `credentials: omit` and no cookies;
- player `base.js` only when direct URLs are unavailable;
- resulting video and audio URLs.

For each client record whether the API is readable, whether `streamingData` exists, whether URLs are direct or ciphered, whether `n` or `sig` is required, whether `base.js` is readable, and which qualities are exposed.

## Gate A - Browser transport

Continue only when the Player API is readable and either:

- usable direct URLs are returned; or
- `base.js` is readable and the challenges can be solved.

If every required endpoint is blocked by CORS, Pyodide cannot change that result.

## Phase 2 - Pyodide request handler

When Gate A passes:

- load Pyodide in a Worker;
- implement a yt-dlp networking handler based on `pyxhr`;
- avoid traditional `urllib`, sockets, and SSL transports;
- call the Python integration API, not the full CLI;
- use `YoutubeDL(options).extract_info(url, download=False)`;
- disable downloads, post-processing, FFmpeg, subprocesses, and playlists unless needed;
- connect every network and extractor decision to the recorder.

## Gate B - yt-dlp compatibility

Compare desktop yt-dlp with Pyodide yt-dlp for the same video:

- title and duration;
- formats and itags;
- codecs and content lengths;
- selected player client;
- URL structure after normalizing volatile parameters such as `ip`, `expire`, `sig`, `lsig`, `n`, `spc`, CDN host, and tokens.

## Phase 3 - EJS in the browser

Only when required by `n` or signature challenges:

- package the required EJS components as local PWA assets;
- run them in a separate JavaScript Worker;
- let Python send challenge input and receive the transformed result;
- do not use Deno, Node, or subprocesses in the browser;
- compare outputs against desktop EJS for identical inputs.

## Gate C - Local resolver

Resolver success requires:

- 1080p or 1440p video-only URL;
- separate audio URL;
- URLs produced from the user's network/IP;
- successful media playback or probe before expiry;
- automatic re-resolve after IP change, expiry, or media error.

After Gate C, Colab and VPS are removed from URL resolution.

## Phase 4 - Mini wheel

Only after Gate C:

- trace actual imports;
- keep YouTube extraction and required utilities only;
- remove unused extractors, downloaders, and post-processors;
- build `yt_resolver_mini.whl`;
- cache Pyodide, the wheel, and EJS with versioned rollback.

## Phase 5 - Media bytes and mux

Test the media path independently:

```text
range + title
-> native browser download
-> authorized Downloads access
-> readable bytes or FileSystemHandle
-> local mux
-> IndexedDB or OPFS playback
```

### Gate D1 - Native download

The browser downloads the video and audio files directly from the media host using the user's traffic.

### Gate D2 - Automatic byte access

The PWA receives readable bytes or an authorized `FileSystemHandle` without an extension, native companion, or manual re-import.

### Gate D3 - Mux and offline persistence

- exact sizes and hashes match;
- local mux completes;
- final media is stored;
- offline playback succeeds from IndexedDB or OPFS.

Do not claim 1080p or 1440p download support until D1, D2, and D3 all pass.

## Phase 6 - Social media

Add each platform separately with its own matrix:

- browser-readable API;
- CORS behavior;
- authentication;
- signature or challenge;
- direct media URL;
- IP binding;
- automatic downloadability.

## Execution order

```text
JS Worker transport
-> Gate A
-> PyodideRequestHandler
-> Gate B
-> EJS browser if required
-> Gate C
-> mini wheel
-> Gate D1
-> Gate D2
-> Gate D3
-> social media platforms
```

