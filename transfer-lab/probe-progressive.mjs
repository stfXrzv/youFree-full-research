import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?:([A-Za-z]):)/, "$1:"));
const ARTIFACTS = path.join(ROOT, "artifacts");
const ENDPOINT = "https://release-youtubei.sandbox.googleapis.com/youtubei/v1/player";
const VIDEO_ID = "A9-t86OAtM0";
const CLIENT = {
  clientName: "ANDROID", clientVersion: "21.02.35", androidSdkVersion: 30,
  userAgent: "com.google.android.youtube/21.02.35 (Linux; U; Android 11) gzip",
  osName: "Android", osVersion: "11", hl: "en"
};

const playerResponse = await fetch(ENDPOINT, {
  method: "POST",
  headers: { Origin: "http://localhost" },
  body: JSON.stringify({
    videoId: VIDEO_ID,
    context: {
      client: CLIENT,
      user: { lockedSafetyMode: false },
      request: { useSsl: true, internalExperimentFlags: [], consistencyTokenJars: [] }
    },
    playbackContext: { contentPlaybackContext: { html5Preference: "HTML5_PREF_WANTS", lactMilliseconds: "-1" } },
    contentCheckOk: true,
    racyCheckOk: true
  })
});
const player = await playerResponse.json();
const format = (player.streamingData?.formats || []).find(item => item.url);
if (!format) throw new Error(player.playabilityStatus?.reason || "No progressive URL");

const base = new URL(format.url);
const contentLength = Number(format.contentLength || base.searchParams.get("clen") || 0);

async function probe(label, { queryRange = null, headerRange = null, title = false } = {}) {
  const url = new URL(base);
  url.searchParams.delete("range");
  url.searchParams.delete("title");
  if (queryRange !== null) url.searchParams.set("range", queryRange);
  if (title) url.searchParams.set("title", "freePlay Native Test");
  const headers = {};
  if (headerRange !== null) headers.Range = "bytes=" + headerRange;
  const response = await fetch(url, { headers, redirect: "manual" });
  const result = {
    label,
    status: response.status,
    queryRange,
    headerRange,
    title,
    contentLength: response.headers.get("content-length"),
    contentRange: response.headers.get("content-range"),
    acceptRanges: response.headers.get("accept-ranges"),
    contentType: response.headers.get("content-type"),
    contentDisposition: response.headers.get("content-disposition")
  };
  await response.body?.cancel().catch(() => {});
  return result;
}

const tests = [
  await probe("base"),
  await probe("header-1k", { headerRange: "0-1023" }),
  await probe("header-open", { headerRange: "0-" }),
  await probe("query-1k", { queryRange: "0-1023" }),
  await probe("query-open", { queryRange: "0-" }),
  await probe("query-full", { queryRange: "0-" + Math.max(0, contentLength - 1) }),
  await probe("title-base", { title: true }),
  await probe("title-query-open", { title: true, queryRange: "0-" }),
  await probe("title-query-full", { title: true, queryRange: "0-" + Math.max(0, contentLength - 1) })
];

const report = {
  videoId: VIDEO_ID,
  createdAt: new Date().toISOString(),
  playability: player.playabilityStatus,
  format: {
    itag: Number(format.itag),
    qualityLabel: format.qualityLabel,
    mimeType: format.mimeType,
    contentLength,
    durationMs: Number(format.approxDurationMs || base.searchParams.get("dur") || 0),
    urlHost: base.hostname
  },
  tests
};

await mkdir(ARTIFACTS, { recursive: true });
await writeFile(path.join(ARTIFACTS, "progressive-probe.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

