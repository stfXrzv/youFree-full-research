import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?:([A-Za-z]):)/, "$1:"));
const ARTIFACTS = path.join(ROOT, "artifacts");
const ENDPOINT = "https://release-youtubei.sandbox.googleapis.com/youtubei/v1/player";
const VIDEO_ID = "A9-t86OAtM0";
const CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
const IOS = {
  clientName: "IOS", clientVersion: "21.02.3", deviceMake: "Apple", deviceModel: "iPhone16,2",
  userAgent: "com.google.ios.youtube/21.02.3 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
  osName: "iPhone", osVersion: "18.3.2.22D82", hl: "en"
};

async function resolveFormats() {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Origin": "http://localhost",
      "User-Agent": CHROME_UA
    },
    body: JSON.stringify({
      videoId: VIDEO_ID,
      context: {
        client: IOS,
        user: { lockedSafetyMode: false },
        request: { useSsl: true, internalExperimentFlags: [], consistencyTokenJars: [] }
      },
      playbackContext: { contentPlaybackContext: { html5Preference: "HTML5_PREF_WANTS", lactMilliseconds: "-1" } },
      contentCheckOk: true,
      racyCheckOk: true
    })
  });
  const player = await response.json();
  if (player.playabilityStatus?.status !== "OK") throw new Error(player.playabilityStatus?.reason || "Player response failed");
  return [...(player.streamingData?.formats || []), ...(player.streamingData?.adaptiveFormats || [])]
    .filter(format => format.url && Number(format.contentLength || 0) > 0);
}

async function probe(label, baseUrl, options = {}) {
  const url = new URL(baseUrl);
  url.searchParams.delete("range");
  if (options.queryRange) url.searchParams.set("range", options.queryRange);
  if (options.extra) {
    for (const [name, value] of Object.entries(options.extra)) url.searchParams.set(name, value);
  }
  const headers = { "User-Agent": CHROME_UA };
  if (options.headerRange) headers.Range = "bytes=" + options.headerRange;
  const startedAt = performance.now();
  try {
    const response = await fetch(url, { headers, redirect: "manual" });
    const result = {
      label,
      status: response.status,
      elapsedMs: Math.round(performance.now() - startedAt),
      queryRange: options.queryRange || "",
      headerRange: options.headerRange || "",
      contentLength: response.headers.get("content-length"),
      contentRange: response.headers.get("content-range"),
      acceptRanges: response.headers.get("accept-ranges"),
      contentType: response.headers.get("content-type"),
      contentDisposition: response.headers.get("content-disposition")
    };
    await response.body?.cancel().catch(() => {});
    return result;
  } catch (error) {
    return { label, error: error.message, elapsedMs: Math.round(performance.now() - startedAt) };
  }
}

const formats = await resolveFormats();
const videoTarget = formats
  .filter(format => Number(format.height || 0) > 0 && !format.audioQuality && !format.audioChannels)
  .sort((a, b) => {
    const rank = format => Number(format.height) === 1080 ? 0 : Number(format.height) > 1080 ? 10000 + Number(format.height) : 20000 - Number(format.height);
    return rank(a) - rank(b) || Number(a.contentLength) - Number(b.contentLength);
  })[0];
const audioTarget = formats
  .filter(format => String(format.mimeType || "").startsWith("audio/"))
  .sort((a, b) => Number(b.contentLength) - Number(a.contentLength))[0];
const targets = [videoTarget, audioTarget].filter(Boolean);
const report = {
  videoId: VIDEO_ID,
  createdAt: new Date().toISOString(),
  available: formats.map(format => ({ itag: Number(format.itag), height: Number(format.height || 0), mimeType: format.mimeType, contentLength: Number(format.contentLength) })),
  targets: []
};

for (const format of targets) {
  const length = Number(format.contentLength);
  const sizes = [
    1024,
    64 * 1024,
    256 * 1024,
    1024 * 1024,
    2 * 1024 * 1024,
    4 * 1024 * 1024,
    8 * 1024 * 1024,
    12 * 1024 * 1024,
    16 * 1024 * 1024,
    24 * 1024 * 1024,
    length
  ].filter((value, index, list) => value <= length && list.indexOf(value) === index);
  const tests = [];
  tests.push(await probe("header-1k", format.url, { headerRange: "0-1023" }));
  tests.push(await probe("base-no-range", format.url));
  tests.push(await probe("query-open", format.url, { queryRange: "0-" }));
  tests.push(await probe("query-open-title", format.url, { queryRange: "0-", extra: { title: "freePlay Adaptive Test" } }));
  for (const size of sizes) {
    tests.push(await probe("query-" + size, format.url, { queryRange: "0-" + (size - 1) }));
  }
  if (length > 2 * 1024 * 1024) {
    tests.push(await probe("query-middle-1m", format.url, { queryRange: (1024 * 1024) + "-" + (2 * 1024 * 1024 - 1) }));
    tests.push(await probe("query-middle-1k", format.url, { queryRange: (1024 * 1024) + "-" + (1024 * 1024 + 1023) }));
    tests.push(await probe("query-middle-rn1", format.url, { queryRange: (1024 * 1024) + "-" + (2 * 1024 * 1024 - 1), extra: { rn: "1", rbuf: "0" } }));
    tests.push(await probe("query-middle-rn2", format.url, { queryRange: (1024 * 1024) + "-" + (2 * 1024 * 1024 - 1), extra: { rn: "2", rbuf: "0" } }));
    tests.push(await probe("query-middle-alr", format.url, { queryRange: (1024 * 1024) + "-" + (2 * 1024 * 1024 - 1), extra: { rn: "2", rbuf: "0", alr: "yes" } }));
    tests.push(await probe("query-1m-rn", format.url, { queryRange: "0-" + (1024 * 1024 - 1), extra: { rn: "1", rbuf: "0" } }));
  }
  report.targets.push({
    itag: Number(format.itag),
    mimeType: format.mimeType,
    contentLength: length,
    initRange: format.initRange || null,
    indexRange: format.indexRange || null,
    tests
  });
}

await mkdir(ARTIFACTS, { recursive: true });
await writeFile(path.join(ARTIFACTS, "range-probe.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

