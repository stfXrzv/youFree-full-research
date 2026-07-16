import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?:([A-Za-z]):)/, "$1:"));
const ARTIFACTS = path.join(ROOT, "artifacts");
const ENDPOINT = "https://release-youtubei.sandbox.googleapis.com/youtubei/v1/player";
const INPUT_URL = process.env.VBS_TEST_URL || "https://www.youtube.com/watch?v=A9-t86OAtM0";
const VIDEO_ID = INPUT_URL.match(/[?&]v=([A-Za-z0-9_-]{11})/)?.[1] || INPUT_URL.match(/([A-Za-z0-9_-]{11})/)?.[1] || INPUT_URL;
const CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
const homeHtml = await (await fetch("https://www.youtube.com/", { headers: { "User-Agent": CHROME_UA } })).text();
const liveConfig = {
  clientVersion: homeHtml.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1] || "2.20260710.06.00",
  visitorData: homeHtml.match(/"visitorData":"([^"]+)"/)?.[1] || "",
  apiKey: homeHtml.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1] || "",
  sts: Number(homeHtml.match(/"STS":(\d+)/)?.[1] || 0),
  playerJsUrl: homeHtml.match(/"PLAYER_JS_URL":"([^"]+)"/)?.[1]?.replace(/\\u0026/g, "&") || ""
};
const CLIENTS = [
  ["android", {
    clientName: "ANDROID", clientVersion: "21.02.35", androidSdkVersion: 30,
    userAgent: "com.google.android.youtube/21.02.35 (Linux; U; Android 11) gzip", osName: "Android", osVersion: "11"
  }],
  ["android_vr", {
    clientName: "ANDROID_VR", clientVersion: "1.65.10", deviceMake: "Oculus", deviceModel: "Quest 3", androidSdkVersion: 32,
    userAgent: "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
    osName: "Android", osVersion: "12L"
  }],
  ["ios", {
    clientName: "IOS", clientVersion: "21.02.3", deviceMake: "Apple", deviceModel: "iPhone16,2",
    userAgent: "com.google.ios.youtube/21.02.3 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)", osName: "iPhone", osVersion: "18.3.2.22D82"
  }],
  ["web", { clientName: "WEB", clientVersion: liveConfig.clientVersion, visitorData: liveConfig.visitorData, hl: "en", gl: "GB" }],
  ["web_safari", {
    clientName: "WEB", clientVersion: liveConfig.clientVersion, visitorData: liveConfig.visitorData, hl: "en", gl: "GB",
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.5 Safari/605.1.15,gzip(gfe)"
  }],
  ["web_embedded", { clientName: "WEB_EMBEDDED_PLAYER", clientVersion: "1.20260115.01.00", hl: "en" }],
  ["mweb", {
    clientName: "MWEB", clientVersion: "2.20260115.01.00", hl: "en",
    userAgent: "Mozilla/5.0 (iPad; CPU OS 16_7_10 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1,gzip(gfe)"
  }],
  ["tv", {
    clientName: "TVHTML5", clientVersion: "7.20260114.12.00", hl: "en",
    userAgent: "Mozilla/5.0 (ChromiumStylePlatform) Cobalt/25.lts.30.1034943-gold (unlike Gecko), Unknown_TV_Unknown_0/Unknown (Unknown, Unknown)"
  }],
  ["tv_simply", { clientName: "TVHTML5_SIMPLY", clientVersion: "1.0", hl: "en" }]
];

function formatSummary(format) {
  let host = "";
  let urlShape = null;
  try {
    const url = new URL(format.url || "");
    host = url.hostname;
    urlShape = {
      client: url.searchParams.get("c") || "",
      gir: url.searchParams.get("gir") || "",
      clen: url.searchParams.has("clen"),
      cnr: url.searchParams.has("cnr"),
      xtags: url.searchParams.has("xtags"),
      sparams: url.searchParams.get("sparams") || ""
    };
  } catch (_) {}
  return {
    itag: Number(format.itag || 0),
    qualityLabel: format.qualityLabel || "",
    height: Number(format.height || 0),
    mimeType: format.mimeType || "",
    hasUrl: Boolean(format.url),
    hasCipher: Boolean(format.signatureCipher || format.cipher),
    hasAudio: Boolean(format.audioQuality || format.audioChannels),
    contentLength: Number(format.contentLength || 0),
    host,
    urlShape
  };
}

async function probe(label, client) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Origin: "http://localhost", "User-Agent": client.userAgent || CHROME_UA },
    body: JSON.stringify({
      videoId: VIDEO_ID,
      context: {
        client,
        thirdParty: label === "web_embedded" ? { embedUrl: "https://www.youtube.com/" } : undefined,
        user: { lockedSafetyMode: false },
        request: { useSsl: true, internalExperimentFlags: [], consistencyTokenJars: [] }
      },
      playbackContext: { contentPlaybackContext: { html5Preference: "HTML5_PREF_WANTS", lactMilliseconds: "-1", signatureTimestamp: liveConfig.sts || undefined } },
      contentCheckOk: true,
      racyCheckOk: true
    })
  });
  const player = await response.json();
  const streaming = player.streamingData || {};
  return {
    label,
    httpStatus: response.status,
    playability: player.playabilityStatus || null,
    streamingKeys: Object.keys(streaming),
    formats: (streaming.formats || []).map(formatSummary),
    adaptiveFormats: (streaming.adaptiveFormats || []).map(formatSummary),
    hlsManifestUrl: streaming.hlsManifestUrl ? { host: new URL(streaming.hlsManifestUrl).hostname } : null,
    dashManifestUrl: streaming.dashManifestUrl ? { host: new URL(streaming.dashManifestUrl).hostname } : null,
    serverAbr: Boolean(streaming.serverAbrStreamingUrl)
  };
}

const report = {
  videoId: VIDEO_ID,
  createdAt: new Date().toISOString(),
  liveConfig: { clientVersion: liveConfig.clientVersion, hasVisitorData: Boolean(liveConfig.visitorData), hasApiKey: Boolean(liveConfig.apiKey), sts: liveConfig.sts, hasPlayerJs: Boolean(liveConfig.playerJsUrl) },
  clients: []
};
for (const [label, client] of CLIENTS) {
  try { report.clients.push(await probe(label, client)); }
  catch (error) { report.clients.push({ label, error: error.message }); }
}

await mkdir(ARTIFACTS, { recursive: true });
await writeFile(path.join(ARTIFACTS, "client-probe.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
