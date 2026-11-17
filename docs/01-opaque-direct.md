# 01 — Opaque direct playback (1-hop)

Audience: an AI agent integrating YouTube audio/video playback into a music
player. All findings verified on real iOS Safari + desktop Chrome.

## The problem

YouTube stream URLs (googlevideo.com) cannot be fetched cross-origin: no CORS
headers, so `fetch()` from a page fails. Pointing a media element straight at
the URL works on desktop, but on iOS it dies ~30–90s in: the URLs are
session-bound and AVPlayer re-requests byte ranges over a fresh transport,
which YouTube rejects (`403` / `ERR_CONTENT_LENGTH_MISMATCH`).

## The discovery

A **Service Worker can proxy googlevideo with an opaque fetch** and the media
element plays full-length:

```js
// inside the Service Worker fetch handler
if (url.pathname.endsWith("/gv")) {
  const real = new URL(url.searchParams.get("u"));
  const range = e.request.headers.get("range");
  const upstream = await fetch(real, {
    mode: "no-cors",
    headers: range ? { Range: range } : {},
  });
  return upstream; // opaque Response — pipe it straight back
}
```

Opaque = you cannot read status/headers — you only pipe bytes. That is exactly
what a media element needs. iOS plays the proxied stream to the end of the
clip because every range request goes back through the same SW → same
session → YouTube stays happy.

## Resolution (1 hop)

One InnerTube `player` call with the **ANDROID** client — no cookies, no API
key required, no auth:

```js
async function resolveAndroid(videoId) {
  const r = await fetch(
    "https://youtubei.googleapis.com/youtubei/v1/player?prettyPrint=false",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "ANDROID",
            clientVersion: "20.10.38",
            androidSdkVersion: 30,
            hl: "en",
          },
        },
        videoId,
      }),
    }
  );
  const j = await r.json();
  return j.streamingData; // { formats, adaptiveFormats, expiresInSeconds }
}
```

The returned `formats`/`adaptiveFormats[].url` are fed to the media element
via the proxy route: `video.src = "/gv?u=" + encodeURIComponent(url)`.

## What you get

- Muxed (progressive) formats: itag 18 (360p) / 22 (720p) — single URL, audio
  included, instant start.
- Adaptive formats: avc1/av01 video-only up to ~1080p + audio-only itags
  (140 m4a, 251 opus) — needs a separate `<audio>` element kept in sync.
- Seek: works within the ranges ANDROID unlocks (partial).
- Ceiling: ANDROID does not return 1440p/2160p or 60fps premium formats.

## Verified

- Full-length playback through the opaque proxy on iOS: 5886 frames, 0 drops.
- Same path on desktop: works.
- Un-proxied element on iOS: dies ~30–90s — always proxy.

## Integration notes

- The proxy route must live in a Service Worker that controls the page (or a
  dedicated-scope iframe — see 03).
- Keep media traffic out of a busy SW shared with app fetches — on iOS the
  stream starves (~7s). Dedicated worker or dedicated scope.
- Audio+video sync for adaptive formats: one `<audio>` element + drift
  correction `|a.currentTime - v.currentTime| > 0.35 → resync`.
