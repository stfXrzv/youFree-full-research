import { chromium } from "playwright";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?:([A-Za-z]):)/, "$1:"));
const PROFILE = path.join(ROOT, ".chrome-profile");
const ARTIFACTS = path.join(ROOT, "artifacts");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const TEST_URL = "http://localhost/aaa/youFree-browser-resolver/transfer-lab/";
const INPUT_URL = process.env.VBS_TEST_URL || "https://www.youtube.com/watch?v=A9-t86OAtM0";
const TEST_DIRECT = process.env.VBS_TEST_DIRECT !== "0";
const VIDEO_SLUG = (INPUT_URL.match(/[?&]v=([A-Za-z0-9_-]{11})/)?.[1] || INPUT_URL.match(/([A-Za-z0-9_-]{11})/)?.[1] || "unknown").replace(/[^A-Za-z0-9_-]/g, "");

await rm(PROFILE, { recursive: true, force: true });
await mkdir(PROFILE, { recursive: true });
await mkdir(ARTIFACTS, { recursive: true });

const report = {
  startedAt: new Date().toISOString(),
  target: TEST_URL,
  inputUrl: INPUT_URL,
  requirements: {
    maxMediaBytes: 100 * 1024 * 1024,
    noExtension: true,
    noMediaRelay: true
  },
  console: [],
  requests: [],
  responses: [],
  checks: {}
};

function mediaSummary(rawUrl) {
  const url = new URL(rawUrl);
  return {
    host: url.hostname,
    path: url.pathname,
    itag: url.searchParams.get("itag") || "",
    range: url.searchParams.get("range") || "",
    hasTitle: url.searchParams.has("title")
  };
}

const context = await chromium.launchPersistentContext(PROFILE, {
  executablePath: CHROME,
  headless: true,
  acceptDownloads: true,
  serviceWorkers: "allow",
  viewport: { width: 1280, height: 900 },
  args: ["--autoplay-policy=no-user-gesture-required"]
});

try {
  const page = context.pages()[0] || await context.newPage();

  page.on("console", message => {
    const text = message.text();
    if (text.includes("[VBS-V7]")) report.console.push(text.slice(0, 1200));
  });
  page.on("request", request => {
    const url = request.url();
    if (url.includes("googlevideo.com/videoplayback") || url.includes("youtubei") || url.startsWith(TEST_URL)) {
      report.requests.push({ at: Date.now(), resourceType: request.resourceType(), rangeHeader: request.headers()["range"] || "", ...mediaSummary(url) });
    }
  });
  page.on("response", response => {
    const url = response.url();
    if (url.includes("googlevideo.com/videoplayback") || url.includes("youtubei")) {
      report.responses.push({
        at: Date.now(),
        status: response.status(),
        fromServiceWorker: response.fromServiceWorker(),
        ...mediaSummary(url)
      });
    }
  });

  await page.goto(TEST_URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__vbsV7?.phase === "ready", null, { timeout: 15000 });
  await page.getByTestId("youtube-url").fill(INPUT_URL);
  report.checks.boot = { pass: true, title: await page.title() };

  await page.getByTestId("resolve").click();
  await page.waitForFunction(() => ["resolved", "resolve-error"].includes(window.__vbsV7?.phase), null, { timeout: 30000 });
  const resolved = await page.evaluate(() => {
    const state = window.__vbsV7;
    const project = format => format ? {
      itag: format.itag,
      client: format.client,
      mimeType: format.mimeType,
      height: format.height,
      contentLength: format.contentLength,
      estimatedContentLength: format.estimatedContentLength
    } : null;
    return {
      phase: state.phase,
      lastError: state.lastError,
      attempts: state.attempts,
      title: state.selected?.title || "",
      video: project(state.selected?.video),
      audio: project(state.selected?.audio),
      progressive: project(state.selected?.progressive)
    };
  });
  report.resolve = resolved;
  if (resolved.phase !== "resolved") throw new Error("Resolve failed: " + resolved.lastError);
  const adaptiveBytes = resolved.video.contentLength + (resolved.audio?.contentLength || 0);
  report.checks.resolveUnder100Mb = { pass: adaptiveBytes < report.requirements.maxMediaBytes, bytes: adaptiveBytes };

  if (TEST_DIRECT) {
    const streamRequestMarker = report.requests.length;
    const streamResponseMarker = report.responses.length;
    await page.getByTestId("stream").click();
    await page.waitForFunction(() => ["online-playback-pass", "online-playback-fail", "stream-error"].includes(window.__vbsV7?.phase), null, { timeout: 45000 });
    const onlineStream = await page.evaluate(() => {
      const result = [...window.__vbsV7.events].reverse().find(event => event.type === "online-playback-result");
      return {
        phase: window.__vbsV7.phase,
        lastError: window.__vbsV7.lastError,
        result: result || null
      };
    });
    report.onlineStream = onlineStream;
    const streamResponses = report.responses.slice(streamResponseMarker).filter(item => item.host.endsWith("googlevideo.com"));
    report.checks.onlineDirectPlayback = {
      pass: onlineStream.phase === "online-playback-pass" && Boolean(resolved.progressive) && streamResponses.length >= 1 && streamResponses.every(item => [200, 206].includes(item.status)),
      phase: onlineStream.phase,
      detectedHeight: resolved.video.height,
      playableHeight: resolved.progressive?.height || 0,
      mediaHosts: [...new Set(report.requests.slice(streamRequestMarker).filter(item => item.itag).map(item => item.host))],
      responses: streamResponses,
      result: onlineStream.result
    };
    await page.evaluate(() => {
      const video = document.querySelector("#video");
      const audio = document.querySelector("#audio");
      video.pause();
      audio.pause();
      video.removeAttribute("src");
      audio.removeAttribute("src");
      video.load();
      audio.load();
    });
  } else {
    report.onlineStream = { skipped: true, reason: "Direct playback disabled by test configuration" };
  }

  const requestMarker = report.requests.length;
  const responseMarker = report.responses.length;
  await page.getByTestId("cache").click();
  await page.waitForFunction(() => ["cached", "cache-error"].includes(window.__vbsV7?.phase), null, { timeout: 180000 });
  const cached = await page.evaluate(async () => {
    const state = window.__vbsV7;
    const cache = await caches.open("youFree-query-range-v7-media");
    const keys = await cache.keys();
    return {
      phase: state.phase,
      lastError: state.lastError,
      manifest: state.manifest ? {
        videoId: state.manifest.videoId,
        expectedBytes: state.manifest.expectedBytes,
        video: state.manifest.video && { itag: state.manifest.video.format.itag, observed: state.manifest.video.observed },
        audio: state.manifest.audio && { itag: state.manifest.audio.format.itag, observed: state.manifest.audio.observed },
        storageBefore: state.manifest.storageBefore,
        storageAfter: state.manifest.storageAfter
      } : null,
      cacheKeys: keys.map(request => {
        const url = new URL(request.url);
        return { host: url.hostname, itag: url.searchParams.get("itag"), range: url.searchParams.get("range") };
      })
    };
  });
  report.cache = cached;
  if (cached.phase !== "cached") throw new Error("Cache failed: " + cached.lastError);

  const cacheNetwork = report.responses.slice(responseMarker).filter(item => item.host.endsWith("googlevideo.com"));
  report.checks.directGooglevideoTransfer = {
    pass: cacheNetwork.length >= 1 && cacheNetwork.every(item => item.host.endsWith("googlevideo.com") && item.status === 200),
    mediaResponses: cacheNetwork
  };
  report.checks.opaqueCache = {
    pass: cached.cacheKeys.length >= 1 && cached.manifest?.video?.observed?.type === "opaque",
    entries: cached.cacheKeys.length
  };
  report.checks.noMediaRelay = {
    pass: report.requests.slice(requestMarker).filter(item => item.itag).every(item => item.host.endsWith("googlevideo.com")),
    observedMediaHosts: [...new Set(report.requests.slice(requestMarker).filter(item => item.itag).map(item => item.host))]
  };

  const playbackRequestMarker = report.requests.length;
  const playbackResponseMarker = report.responses.length;
  await context.setOffline(true);
  await page.getByTestId("play").click();
  await page.waitForFunction(() => ["cache-playback-pass", "cache-playback-fail", "play-error"].includes(window.__vbsV7?.phase), null, { timeout: 45000 });
  const playback = await page.evaluate(() => ({
    phase: window.__vbsV7.phase,
    lastError: window.__vbsV7.lastError,
    video: {
      readyState: document.querySelector("#video").readyState,
      networkState: document.querySelector("#video").networkState,
      duration: document.querySelector("#video").duration,
      currentTime: document.querySelector("#video").currentTime,
      error: document.querySelector("#video").error && {
        code: document.querySelector("#video").error.code,
        message: document.querySelector("#video").error.message
      }
    },
    audio: {
      readyState: document.querySelector("#audio").readyState,
      currentTime: document.querySelector("#audio").currentTime,
      error: document.querySelector("#audio").error && {
        code: document.querySelector("#audio").error.code,
        message: document.querySelector("#audio").error.message
      }
    },
    serviceWorkerEvents: window.__vbsV7.events.filter(event => event.type === "service-worker").slice(-10)
  }));
  report.playback = playback;
  const playbackResponses = report.responses.slice(playbackResponseMarker).filter(item => item.host.endsWith("googlevideo.com"));
  report.checks.offlinePlayback = {
    pass: playback.phase === "cache-playback-pass" && playback.video.readyState >= 2 && playback.video.currentTime > 0,
    phase: playback.phase,
    newNetworkRequests: report.requests.slice(playbackRequestMarker).filter(item => item.host.endsWith("googlevideo.com")).length,
    serviceWorkerResponses: playbackResponses
  };

  await page.screenshot({ path: path.join(ARTIFACTS, "v7-result-" + VIDEO_SLUG + ".png"), fullPage: true });

  await context.setOffline(false);
  await page.evaluate(() => window.swCommand?.({ type: "set-strict-offline", enabled: false })).catch(() => {});
  const nativeHref = await page.getByTestId("native-download").getAttribute("href");
  const nativeDisabled = await page.getByTestId("native-download").getAttribute("aria-disabled") === "true";
  report.nativeDownload = { available: !nativeDisabled, href: nativeHref && nativeHref !== "#" ? mediaSummary(nativeHref) : null };
  if (nativeDisabled) {
    report.checks.nativeDispositionPolicy = {
      pass: true,
      available: false,
      reason: "Googlevideo serves this asset inline; the UI does not promise a browser-only file export"
    };
  } else {
    try {
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 45000 }),
        page.getByTestId("native-download").click({ noWaitAfter: true })
      ]);
      const failure = await download.failure();
      if (failure) throw new Error("Native download failed: " + failure);
      const downloadedPath = await download.path();
      const downloadedStat = await stat(downloadedPath);
      const signature = (await readFile(downloadedPath)).subarray(0, 32).toString("hex");
      report.nativeDownload = {
        ...report.nativeDownload,
        suggestedFilename: download.suggestedFilename(),
        bytes: downloadedStat.size,
        first32Hex: signature
      };
      report.checks.nativeMp4 = {
        pass: downloadedStat.size > 1024 && signature.includes("66747970"),
        directBrowserDownload: true,
        bytes: downloadedStat.size
      };
    } catch (error) {
      report.nativeDownload.error = error.message;
      report.checks.nativeMp4 = { pass: false, directBrowserDownload: false, error: error.message };
    }
  }
} catch (error) {
  report.fatal = { message: error.message, stack: error.stack };
} finally {
  await context.setOffline(false).catch(() => {});
  report.finishedAt = new Date().toISOString();
  report.pass = !report.fatal && Object.values(report.checks).every(check => check.pass === true);
  await writeFile(path.join(ARTIFACTS, "v7-result-" + VIDEO_SLUG + ".json"), JSON.stringify(report, null, 2));
  await context.close();
}

console.log(JSON.stringify({
  pass: report.pass,
  fatal: report.fatal?.message || null,
  checks: report.checks,
  resolve: report.resolve,
  nativeDownload: report.nativeDownload,
  cache: report.cache,
  playback: report.playback,
  artifacts: ARTIFACTS
}, null, 2));
