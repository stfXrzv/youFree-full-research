import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";
import { CLIENT_PROFILES, PLAYER_ENDPOINT, safeUrlShape } from "../lab/core.mjs";
import { resolveWithValidation } from "../lab/resilient-resolve.mjs";

const target = process.env.LAB_URL
  || "http://localhost/aaa/vibestream-browser-resolver/lab/";
const videoId = process.env.VIDEO_ID || "A9-t86OAtM0";
const output = process.env.RESULT_PATH || "artifacts/gate-c-result.json";
const chrome = process.env.CHROME_PATH
  || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const ios = CLIENT_PROFILES.find(profile => profile.id === "ios_music");

if (!ios) throw new Error("The iOS client profile is missing");

function expireUrl(rawUrl) {
  const url = new URL(rawUrl);
  url.searchParams.set("expire", "1");
  return url.href;
}

async function finiteProbe(rawUrl) {
  try {
    const response = await fetch(rawUrl, {
      headers: { Range: "bytes=0-0" },
      redirect: "manual",
    });
    const result = {
      ok: response.status === 206,
      status: response.status,
      type: response.headers.get("content-type") || "",
      range: response.headers.get("content-range") || "",
    };
    await response.body?.cancel().catch(() => {});
    return result;
  } catch (error) {
    return { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage();

async function resolveInBrowser() {
  return page.evaluate(async ({ endpoint, videoId: id, client }) => {
    const response = await fetch(endpoint, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      body: JSON.stringify({
        videoId: id,
        context: {
          client,
          user: { lockedSafetyMode: false },
          request: { useSsl: true, internalExperimentFlags: [], consistencyTokenJars: [] },
        },
        playbackContext: {
          contentPlaybackContext: {
            html5Preference: "HTML5_PREF_WANTS",
            lactMilliseconds: "-1",
          },
        },
        contentCheckOk: true,
        racyCheckOk: true,
      }),
    });
    const payload = await response.json();
    const formats = [
      ...(payload.streamingData?.formats || []),
      ...(payload.streamingData?.adaptiveFormats || []),
    ].filter(format => format.url);
    const video = formats
      .filter(format => String(format.mimeType || "").startsWith("video/") && Number(format.height || 0) > 0)
      .sort((a, b) => Number(b.height || 0) - Number(a.height || 0) || Number(a.contentLength || Infinity) - Number(b.contentLength || Infinity))[0];
    const audio = formats
      .filter(format => String(format.mimeType || "").startsWith("audio/"))
      .sort((a, b) => Number(b.bitrate || 0) - Number(a.bitrate || 0))[0];
    if (!video || !audio) {
      throw new Error(payload.playabilityStatus?.reason || "No direct adaptive pair");
    }
    return {
      title: payload.videoDetails?.title || id,
      video: {
        url: video.url,
        itag: Number(video.itag),
        height: Number(video.height || 0),
        mimeType: String(video.mimeType || ""),
      },
      audio: {
        url: audio.url,
        itag: Number(audio.itag),
        mimeType: String(audio.mimeType || ""),
      },
      formatCount: formats.length,
      playability: payload.playabilityStatus?.status || "UNKNOWN",
    };
  }, { endpoint: PLAYER_ENDPOINT, videoId, client: ios.client });
}

async function nativeMediaProbe(rawUrl) {
  return page.evaluate(async url => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    document.body.append(video);
    const result = await new Promise(resolveResult => {
      const finish = value => {
        clearTimeout(timer);
        video.pause();
        video.removeAttribute("src");
        video.load();
        video.remove();
        resolveResult(value);
      };
      const timer = setTimeout(() => finish({ ok: false, reason: "timeout" }), 7000);
      video.addEventListener("loadedmetadata", () => finish({ ok: true, duration: video.duration }), { once: true });
      video.addEventListener("error", () => finish({
        ok: false,
        reason: "media_error",
        code: video.error?.code || 0,
      }), { once: true });
      video.src = url;
      video.load();
    });
    return result;
  }, rawUrl);
}

try {
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 15_000 });
  const initial = await resolveInBrowser();
  const initialVideo = await finiteProbe(initial.video.url);
  const initialAudio = await finiteProbe(initial.audio.url);
  const nativeAdaptivePlayback = await nativeMediaProbe(initial.video.url);
  const stale = {
    ...initial,
    video: { ...initial.video, url: expireUrl(initial.video.url) },
  };

  let resolveCalls = 0;
  const recovered = await resolveWithValidation({
    resolve: async ({ attempt }) => {
      resolveCalls += 1;
      return attempt === 1 ? stale : resolveInBrowser();
    },
    validate: async candidate => {
      const video = await finiteProbe(candidate.video.url);
      const audio = await finiteProbe(candidate.audio.url);
      return { ok: video.ok && audio.ok, videoStatus: video.status, audioStatus: audio.status };
    },
    summarize: candidate => ({
      videoItag: candidate.video.itag,
      videoHeight: candidate.video.height,
      audioItag: candidate.audio.itag,
      expiresAt: safeUrlShape(candidate.video.url).expiresAt,
    }),
  });

  const report = {
    schema: "vibestream-gate-c-v1",
    recordedAt: new Date().toISOString(),
    target,
    videoId,
    resolver: "browser-player-api",
    mediaRelayUsed: false,
    initial: {
      title: initial.title,
      playability: initial.playability,
      formatCount: initial.formatCount,
      video: {
        itag: initial.video.itag,
        height: initial.video.height,
        mimeType: initial.video.mimeType,
        probe: initialVideo,
      },
      audio: {
        itag: initial.audio.itag,
        mimeType: initial.audio.mimeType,
        probe: initialAudio,
      },
    },
    nativeAdaptivePlayback,
    recovery: {
      ok: recovered.ok,
      resolveCalls,
      attempts: recovered.attempts,
    },
  };
  report.gateC = {
    pass: initial.video.height >= 1080
      && initialVideo.ok
      && initialAudio.ok
      && recovered.ok
      && recovered.attempts.length === 2,
    adaptiveNativePlayback: nativeAdaptivePlayback.ok,
    reason: nativeAdaptivePlayback.ok
      ? "Adaptive URLs resolved, probed and recovered after rejection."
      : "Resolver and automatic recovery pass; native adaptive playback remains blocked by Googlevideo open-range behavior.",
  };

  const destination = resolve(output);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await browser.close();
}
