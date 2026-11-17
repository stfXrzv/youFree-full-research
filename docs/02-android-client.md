# 02 — The ANDROID client + preview-chunk probing

## Why ANDROID

The InnerTube `player` endpoint accepts a `context.client` identity. The
ANDROID identity is the easiest useful one:

- Returns streamable URLs (not just signatures) — most clients now return
  `signatureCipher`/`n`-scrambled URLs that need JS de-scrambling; ANDROID
  URLs are usable as-is.
- Needs nothing else: no cookies, no API key, no OAuth, no poToken.
- Stable across regions/accounts — it behaves like an unauthenticated app.

## Request

```http
POST https://youtubei.googleapis.com/youtubei/v1/player?prettyPrint=false
Content-Type: application/json

{
  "context": {
    "client": {
      "clientName": "ANDROID",
      "clientVersion": "20.10.38",
      "androidSdkVersion": 30,
      "hl": "en",
      "timeZone": "UTC",
      "utcOffsetMinutes": 0
    }
  },
  "videoId": "<id>",
  "playbackContext": {
    "contentPlaybackContext": { "html5Preference": "HTML5_PREF_WANTS" }
  },
  "contentCheckOk": true,
  "racyCheckOk": true
}
```

Response fields that matter:

- `streamingData.formats[]` — muxed (audio+video in one file)
- `streamingData.adaptiveFormats[]` — separate video-only / audio-only
- `responseContext.visitorData` — **keep this**; it is the key to hop 2 (see 03)
- `playabilityStatus` — check `.status === "OK"` before trusting streams

## Format inventory (ANDROID)

| itag | kind | codec | note |
|---|---|---|---|
| 18 | muxed 360p | avc1+mp4a | always present |
| 22 | muxed 720p | avc1+mp4a | not on every video |
| 136/137 | video-only 720p/1080p | avc1 | adaptive |
| 398/399 | video-only 720p/1080p | av01 | adaptive |
| 140 | audio 128k | mp4a | most compatible |
| 251 | audio ~160k | opus | better quality |
| 249/250 | audio ~50/70k | opus | low bw |

Premium rungs (1440p+, 60fps, HDR) are absent — that is what hop 2 unlocks.

## The preview-chunk technique

Before committing a `<video>` element to a URL, **probe it with a tiny Range
request through the proxy**:

```js
// cheap URL validation + session priming
await fetch("/gv?u=" + encodeURIComponent(url), {
  headers: { Range: "bytes=0-1" }, // 2-byte preview chunk
});
```

What it buys you:

- Validates the URL cheaply (2 bytes vs committing a decoder).
- Primes the googlevideo session so the element's first real request is fast.
- Measures first-byte latency → pick the fastest mirror/format.
- An opaque response can't be inspected, so success = "no error + the
  follow-up range fetch works" — verified by `sw-hit bytes=0-1` in SW logs.

This is how the test page achieves ~400ms resolve→first-frame: probe, then
attach only the rung that answered.

## Failure handling

- `playabilityStatus.status !== "OK"` → age-gate/members-only/region lock.
  Fall back to your server-side resolver or skip.
- URLs expire (`streamingData.expiresInSeconds`, ~6h) — resolve per play,
  don't cache the JSON long-term.
- `signatureCipher`-only responses mean YouTube rotated the client's
  requirements — bump `clientVersion` or switch client.
