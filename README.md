# youFree — browser-only YouTube playback research

Private implementation and evidence repository. Written AI→AI: everything
below is the minimum needed to port the playback engine into a music player.

**Zero server dependencies for playback:**

- no yt-dlp
- no cookies
- no API key
- no poToken (optional enhancer only — resolve works without it)

Live test page: `https://code2it.com/yft/` — debug bridge via
`?debug=<session>`, remote commands logged to a logger endpoint.
Lab harness: `https://code2it.com/yftlab/` (dedicated proxy SW scope).

> Note: an earlier milestone in this repo's history concluded browser-side
> playback was "not possible" (July 2026, Pyodide/yt-dlp era). The November
> 2026 findings below disproved it — full browser resolution + playback up
> to 4320p60 is verified working on a real iPhone.

## The architecture in one paragraph

1. Resolve stream URLs via YouTube InnerTube `player` API, called from the
   page itself. Two paths:
   - **1-hop "opaque direct"**: ANDROID client → limited formats (<=1080p).
   - **2-hop**: ANDROID hop for `visitorData` -> VISIONOS client hop → the
     full unlocked format list (<=4320p60 HDR, ranges unlocked at any offset).
2. Play through a **dedicated Service Worker proxy** (`/gv?u=<url>`) using
   `fetch(url, {mode:"no-cors"})` — opaque piping defeats CORS and keeps the
   googlevideo session alive on iOS, where direct `<video src>` dies ~30-90s.
3. On iOS, host `<video>`/`<audio>` inside a same-origin iframe on the proxy
   SW's scope — media requests must not share a busy worker with app traffic.
4. Clamp every proxied response to an ~8MB range window or the SW OOMs on
   multi-GB streams.
5. Adaptive formats = video-only element + separate audio element, drift
   correction +-0.35s. Ladder descends only on decoded-frame watchdog death.

## Docs (chronological discoveries)

| # | File | Contents |
|---|---|---|
| 01 | [docs/01-opaque-direct.md](docs/01-opaque-direct.md) | opaque fetch proxy discovery, 1-hop ANDROID resolve, why direct dies on iOS |
| 02 | [docs/02-android-client.md](docs/02-android-client.md) | ANDROID request format, itag inventory, preview-chunk probing |
| 03 | [docs/03-2hop-2k.md](docs/03-2hop-2k.md) | visitorData -> VISIONOS unlock, media-host iframe, ladder + watchdog |
| 04 | [docs/04-2hop-4k-8k.md](docs/04-2hop-4k-8k.md) | 8MB window clamp (OOM fix), 4320p60 results, iOS decoder truths |

## Current status — verified on real iPhone Safari

| Capability | 1-hop (opaque direct) | 2-hop (VISIONOS) |
|---|---|---|
| audio-only (140/251) | working | working |
| 144p-480p | working | working |
| 720p | working (muxed 22) | working |
| 1080p | when offered | working avc1 + av01 |
| 1440p | not offered | working |
| 2160p60 | not offered | working, stable |
| 4320p60 HDR | not offered | working (long-run hits iOS decoder RAM) |
| seek mid-clip | partial | instant, bidirectional |
| survives backgrounding | working | working (iOS pauses hidden decoders) |

## Functions to lift into your player

- `resolveAndroid(videoId)` / `resolve2hop(videoId)` — docs 02/03
- `/gv` SW fetch handler with range clamp — docs 01/04
- Media-host iframe pattern (iOS) — doc 03
- Ladder + `getVideoPlaybackQuality()` watchdog — docs 03/04
- A/V drift correction + winner arbitration — docs 03/04

## Laboratories (earlier research phases)

- `lab/`: Phase 0/1 transport matrix and the Pyodide + `yt-dlp` resolver path.
- `transfer-lab/`: direct Googlevideo streaming, opaque Cache Storage, strict
  offline playback, native download policy, OPFS, Background Fetch, capture.
- `tests/`: deterministic unit and browser runners for Gate A and Gate B.
- `AI_BRIDGE/`: agent-to-agent handoff artifacts and milestone history.
