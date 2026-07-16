import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?:([A-Za-z]):)/, "$1:"));
const ARTIFACTS = path.join(ROOT, "artifacts");
const ENDPOINT = "https://release-youtubei.sandbox.googleapis.com/youtubei/v1/player";
const VIDEO_ID = "A9-t86OAtM0";
const CLIENTS = [
  ["IOS", {
    clientName: "IOS", clientVersion: "21.02.3", deviceMake: "Apple", deviceModel: "iPhone16,2",
    userAgent: "com.google.ios.youtube/21.02.3 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
    osName: "iPhone", osVersion: "18.3.2.22D82", hl: "en"
  }],
  ["ANDROID_VR", {
    clientName: "ANDROID_VR", clientVersion: "1.65.10", deviceMake: "Oculus", deviceModel: "Quest 3",
    androidSdkVersion: 32, userAgent: "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L) gzip",
    osName: "Android", osVersion: "12L", hl: "en"
  }],
  ["ANDROID", {
    clientName: "ANDROID", clientVersion: "21.02.35", androidSdkVersion: 30,
    userAgent: "com.google.android.youtube/21.02.35 (Linux; U; Android 11) gzip",
    osName: "Android", osVersion: "11", hl: "en"
  }]
];

async function player(client) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Origin: "http://localhost" },
    body: JSON.stringify({
      videoId: VIDEO_ID,
      context: {
        client,
        user: { lockedSafetyMode: false },
        request: { useSsl: true, internalExperimentFlags: [], consistencyTokenJars: [] }
      },
      playbackContext: { contentPlaybackContext: { html5Preference: "HTML5_PREF_WANTS", lactMilliseconds: "-1" } },
      contentCheckOk: true,
      racyCheckOk: true
    })
  });
  return { httpStatus: response.status, data: await response.json() };
}

async function inspectManifest(rawUrl) {
  if (!rawUrl) return null;
  const url = new URL(rawUrl);
  const response = await fetch(url);
  const text = await response.text();
  const lines = text.split(/\r?\n/).filter(Boolean);
  const absoluteUrls = lines.filter(line => /^https?:\/\//i.test(line));
  const variants = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].startsWith("#EXT-X-STREAM-INF")) continue;
    variants.push({ info: lines[index], url: lines[index + 1] || "" });
  }
  return {
    host: url.hostname,
    status: response.status,
    contentType: response.headers.get("content-type"),
    bytes: Buffer.byteLength(text),
    firstLines: lines.slice(0, 30),
    absoluteUrlCount: absoluteUrls.length,
    variants: variants.slice(0, 20)
  };
}

const report = { videoId: VIDEO_ID, createdAt: new Date().toISOString(), clients: [] };
for (const [label, client] of CLIENTS) {
  try {
    const result = await player(client);
    const streaming = result.data.streamingData || {};
    report.clients.push({
      label,
      httpStatus: result.httpStatus,
      playability: result.data.playabilityStatus || null,
      streamingKeys: Object.keys(streaming),
      directFormats: (streaming.formats || []).filter(format => format.url).length,
      directAdaptiveFormats: (streaming.adaptiveFormats || []).filter(format => format.url).length,
      hls: await inspectManifest(streaming.hlsManifestUrl || ""),
      hasDashManifest: Boolean(streaming.dashManifestUrl),
      hasServerAbr: Boolean(streaming.serverAbrStreamingUrl)
    });
  } catch (error) {
    report.clients.push({ label, error: error.message });
  }
}

await mkdir(ARTIFACTS, { recursive: true });
await writeFile(path.join(ARTIFACTS, "manifest-probe.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
