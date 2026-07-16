import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?:([A-Za-z]):)/, "$1:"));
const ARTIFACTS = path.join(ROOT, "artifacts");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PAGE_URL = "http://localhost/aaa/vibestream-browser-resolver/transfer-lab/";
const INPUT_URL = process.env.VBS_TEST_URL || "https://www.youtube.com/watch?v=MryMoDHHf7c";
const VIDEO_ID = INPUT_URL.match(/[?&]v=([A-Za-z0-9_-]{11})/)?.[1] || INPUT_URL.match(/([A-Za-z0-9_-]{11})/)?.[1] || INPUT_URL;
const CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36";
const homeHtml = await (await fetch("https://www.youtube.com/", { headers: { "User-Agent": CHROME_UA } })).text();
const webClient = {
  clientName: "WEB",
  clientVersion: homeHtml.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1] || "2.20260710.06.00",
  visitorData: homeHtml.match(/"visitorData":"([^"]+)"/)?.[1] || "",
  hl: "en",
  gl: "GB",
  userAgent: CHROME_UA
};
const nodeWebPlayerResponse = await fetch("https://release-youtubei.sandbox.googleapis.com/youtubei/v1/player", {
  method: "POST",
  headers: { Origin: "http://localhost", "User-Agent": CHROME_UA },
  body: JSON.stringify({
    videoId: VIDEO_ID,
    context: { client: webClient, user: { lockedSafetyMode: false }, request: { useSsl: true, internalExperimentFlags: [], consistencyTokenJars: [] } },
    playbackContext: { contentPlaybackContext: { html5Preference: "HTML5_PREF_WANTS", lactMilliseconds: "-1" } },
    contentCheckOk: true,
    racyCheckOk: true
  })
});
const nodeWebPlayer = await nodeWebPlayerResponse.json();
const nodeWebSabr = nodeWebPlayer.streamingData?.serverAbrStreamingUrl || "";

await mkdir(ARTIFACTS, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: CHROME });
const context = await browser.newContext();
const page = await context.newPage();
const network = [];

page.on("response", async response => {
  if (!response.url().includes("googlevideo.com/videoplayback")) return;
  const headers = response.headers();
  network.push({
    method: response.request().method(),
    status: response.status(),
    host: new URL(response.url()).hostname,
    type: headers["content-type"] || "",
    allowOrigin: headers["access-control-allow-origin"] || "",
    allowHeaders: headers["access-control-allow-headers"] || "",
    allowMethods: headers["access-control-allow-methods"] || ""
  });
});

await page.goto(PAGE_URL, { waitUntil: "domcontentloaded" });
const browserResult = await page.evaluate(async ({ videoId, webClient, nodeWebSabr }) => {
  const endpoint = "https://release-youtubei.sandbox.googleapis.com/youtubei/v1/player";
  const clients = [
    ["WEB", webClient],
    ["IOS", {
      clientName: "IOS", clientVersion: "21.02.3", deviceMake: "Apple", deviceModel: "iPhone16,2",
      userAgent: "com.google.ios.youtube/21.02.3 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
      osName: "iPhone", osVersion: "18.3.2.22D82", hl: "en"
    }],
    ["ANDROID", {
      clientName: "ANDROID", clientVersion: "21.02.35", androidSdkVersion: 30,
      userAgent: "com.google.android.youtube/21.02.35 (Linux; U; Android 11) gzip",
      osName: "Android", osVersion: "11", hl: "en"
    }]
  ];

  async function attempt(label, url, init) {
    try {
      const response = await fetch(url, init);
      let bytes = null;
      let readError = "";
      try { bytes = (await response.arrayBuffer()).byteLength; }
      catch (error) { readError = error.name + ": " + error.message; }
      return { label, ok: true, type: response.type, status: response.status, bodyVisible: Boolean(response.body), bytes, readError };
    } catch (error) {
      return { label, ok: false, error: error.name + ": " + error.message };
    }
  }

  const result = [];
  if (nodeWebSabr) {
    const nodeResolved = {
      client: "WEB_NODE_RESOLVED",
      playability: "OK",
      hasSabr: true,
      sabrHost: new URL(nodeWebSabr).hostname,
      attempts: []
    };
    nodeResolved.attempts.push(await attempt("cors-get", nodeWebSabr, { method: "GET", mode: "cors", credentials: "omit" }));
    nodeResolved.attempts.push(await attempt("cors-post-simple", nodeWebSabr, { method: "POST", mode: "cors", credentials: "omit", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: new Uint8Array() }));
    nodeResolved.attempts.push(await attempt("cors-post-protobuf", nodeWebSabr, { method: "POST", mode: "cors", credentials: "omit", headers: { "Content-Type": "application/x-protobuf" }, body: new Uint8Array() }));
    nodeResolved.attempts.push(await attempt("no-cors-post", nodeWebSabr, { method: "POST", mode: "no-cors", credentials: "omit", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: new Uint8Array() }));
    result.push(nodeResolved);
  }
  for (const [label, client] of clients) {
    const playerResponse = await fetch(endpoint, {
      method: "POST",
      body: JSON.stringify({
        videoId,
        context: { client, user: { lockedSafetyMode: false }, request: { useSsl: true, internalExperimentFlags: [], consistencyTokenJars: [] } },
        playbackContext: { contentPlaybackContext: { html5Preference: "HTML5_PREF_WANTS", lactMilliseconds: "-1" } },
        contentCheckOk: true,
        racyCheckOk: true
      })
    });
    const player = await playerResponse.json();
    const sabr = player.streamingData?.serverAbrStreamingUrl || "";
    const item = {
      client: label,
      playability: player.playabilityStatus?.status || "",
      hasSabr: Boolean(sabr),
      sabrHost: sabr ? new URL(sabr).hostname : "",
      attempts: []
    };
    if (sabr) {
      item.attempts.push(await attempt("cors-get", sabr, { method: "GET", mode: "cors", credentials: "omit" }));
      item.attempts.push(await attempt("cors-post-simple", sabr, { method: "POST", mode: "cors", credentials: "omit", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: new Uint8Array() }));
      item.attempts.push(await attempt("cors-post-protobuf", sabr, { method: "POST", mode: "cors", credentials: "omit", headers: { "Content-Type": "application/x-protobuf" }, body: new Uint8Array() }));
      item.attempts.push(await attempt("no-cors-post", sabr, { method: "POST", mode: "no-cors", credentials: "omit", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: new Uint8Array() }));
    }
    result.push(item);
  }
  return result;
}, { videoId: VIDEO_ID, webClient, nodeWebSabr });

await page.waitForTimeout(1000);
const report = {
  videoId: VIDEO_ID,
  createdAt: new Date().toISOString(),
  nodeWeb: { httpStatus: nodeWebPlayerResponse.status, playability: nodeWebPlayer.playabilityStatus?.status || "", hasSabr: Boolean(nodeWebSabr) },
  browserResult,
  network
};
await writeFile(path.join(ARTIFACTS, "sabr-cors-probe.json"), JSON.stringify(report, null, 2));
await context.close();
await browser.close();
console.log(JSON.stringify(report, null, 2));
