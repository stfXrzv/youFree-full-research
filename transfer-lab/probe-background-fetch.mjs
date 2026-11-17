import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?:([A-Za-z]):)/, "$1:"));
const ARTIFACTS = path.join(ROOT, "artifacts");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PAGE_URL = "http://localhost/aaa/youFree-browser-resolver/transfer-lab/";
const INPUT_URL = process.env.VBS_TEST_URL || "https://www.youtube.com/watch?v=MryMoDHHf7c";

await mkdir(ARTIFACTS, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: CHROME });
const context = await browser.newContext();
const page = await context.newPage();
const network = [];

page.on("response", response => {
  if (!response.url().includes("googlevideo.com/videoplayback")) return;
  network.push({ status: response.status(), host: new URL(response.url()).hostname, fromServiceWorker: response.fromServiceWorker() });
});

await page.goto(PAGE_URL, { waitUntil: "networkidle" });
await page.getByTestId("youtube-url").fill(INPUT_URL);
await page.getByTestId("resolve").click();
await page.waitForFunction(() => window.__vbsV7?.phase === "resolved", null, { timeout: 30000 });

const result = await page.evaluate(async () => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const registration = await navigator.serviceWorker.ready;
  if (!registration.backgroundFetch) throw new Error("Background Fetch unavailable");
  const selected = window.__vbsV7.selected;
  const target = window.__vbsV7.downloadTarget.directUrl;
  const id = "vbs-bg-" + selected.videoId + "-" + Date.now();
  const expectedBytes = Number(selected.progressive.contentLength || 0);
  const request = new Request(target, {
    method: "GET",
    mode: "cors",
    credentials: "omit",
    cache: "no-store",
    redirect: "follow",
    referrerPolicy: "no-referrer"
  });
  const background = await registration.backgroundFetch.fetch(id, [request], {
    title: selected.title,
    downloadTotal: expectedBytes
  });
  const progress = [];
  background.addEventListener("progress", () => {
    progress.push({ downloaded: background.downloaded, downloadTotal: background.downloadTotal, result: background.result || "" });
    if (progress.length > 40) progress.shift();
  });

  const deadline = Date.now() + 90000;
  while (!background.result && Date.now() < deadline) await sleep(250);
  let records = [];
  let recordsError = "";
  try { records = await background.matchAll(); }
  catch (error) { recordsError = error.name + ": " + error.message; }
  const inspected = [];
  for (const record of records) {
    try {
      const response = await record.responseReady;
      const blob = await response.clone().blob();
      const buffer = await response.clone().arrayBuffer();
      inspected.push({
        requestHost: new URL(record.request.url).hostname,
        responseType: response.type,
        status: response.status,
        bodyVisible: Boolean(response.body),
        blobBytes: blob.size,
        arrayBufferBytes: buffer.byteLength
      });
    } catch (error) {
      inspected.push({ error: error.name + ": " + error.message });
    }
  }

  return {
    id,
    expectedBytes,
    result: background.result || "timeout",
    failureReason: background.failureReason || "",
    downloaded: background.downloaded,
    downloadTotal: background.downloadTotal,
    uploaded: background.uploaded,
    recordsError,
    records: inspected,
    progress
  };
});

const report = { video: INPUT_URL, createdAt: new Date().toISOString(), result, network };
await writeFile(path.join(ARTIFACTS, "background-fetch-probe.json"), JSON.stringify(report, null, 2));
await context.close();
await browser.close();
console.log(JSON.stringify(report, null, 2));
