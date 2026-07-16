import { chromium } from "playwright";

const ENDPOINT = "https://release-youtubei.sandbox.googleapis.com/youtubei/v1/player";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const CLIENT = {
  clientName: "IOS", clientVersion: "21.02.3", deviceMake: "Apple", deviceModel: "iPhone16,2",
  userAgent: "com.google.ios.youtube/21.02.3 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
  osName: "iPhone", osVersion: "18.3.2.22D82", hl: "en"
};

const playerResponse = await fetch(ENDPOINT, {
  method: "POST",
  headers: {
    Origin: "http://localhost",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36"
  },
  body: JSON.stringify({
    videoId: "A9-t86OAtM0",
    context: { client: CLIENT, user: { lockedSafetyMode: false }, request: { useSsl: true, internalExperimentFlags: [], consistencyTokenJars: [] } },
    playbackContext: { contentPlaybackContext: { html5Preference: "HTML5_PREF_WANTS", lactMilliseconds: "-1" } },
    contentCheckOk: true,
    racyCheckOk: true
  })
});
const player = await playerResponse.json();
const format = [...(player.streamingData?.adaptiveFormats || [])]
  .filter(item => Number(item.height || 0) === 1080 && item.url)
  .sort((a, b) => Number(a.contentLength || 0) - Number(b.contentLength || 0))[0];
if (!format) throw new Error("No direct 1080p URL");

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
const responses = [];
const requests = [];
const failures = [];
await page.goto("http://localhost/aaa/ytdwl/_cache_lab/native-probe.html", { waitUntil: "domcontentloaded" });
page.on("request", request => {
  if (request.url().includes("googlevideo.com/videoplayback")) {
    requests.push({ resourceType: request.resourceType(), rangeHeader: request.headers()["range"] || "" });
  }
});
page.on("requestfailed", request => {
  if (request.url().includes("googlevideo.com/videoplayback")) {
    failures.push({ resourceType: request.resourceType(), rangeHeader: request.headers()["range"] || "", failure: request.failure() });
  }
});
page.on("response", response => {
  if (response.url().includes("googlevideo.com/videoplayback")) {
    responses.push({ status: response.status(), fromServiceWorker: response.fromServiceWorker() });
  }
});

const tests = [];
for (const range of ["", "bytes=0-1023", "bytes=0-1048575"]) {
  const result = await page.evaluate(async ({ url, range }) => {
    try {
      const options = { mode: "no-cors", credentials: "omit", cache: "no-store" };
      if (range) options.headers = { Range: range };
      const response = await fetch(url, options);
      return { ok: true, type: response.type, status: response.status, bodyVisible: Boolean(response.body) };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }, { url: format.url, range });
  await page.waitForTimeout(200);
  tests.push({ range: range || "none", pageResult: result, networkResponse: responses[responses.length - 1] || null });
}

const beforeMediaResponses = responses.length;
const beforeMediaRequests = requests.length;
const beforeMediaFailures = failures.length;
const mediaElement = await page.evaluate(async url => {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  document.body.append(video);
  try { await video.play(); } catch (_) {}
  await new Promise(resolve => setTimeout(resolve, 2500));
  return {
    readyState: video.readyState,
    networkState: video.networkState,
    currentTime: video.currentTime,
    duration: video.duration,
    error: video.error && { code: video.error.code, message: video.error.message }
  };
}, format.url);
tests.push({
  range: "native-media-element",
  mediaElement,
  networkRequests: requests.slice(beforeMediaRequests),
  networkResponses: responses.slice(beforeMediaResponses),
  failures: failures.slice(beforeMediaFailures)
});

await browser.close();
console.log(JSON.stringify({ itag: Number(format.itag), tests }, null, 2));
