import { chromium } from "playwright";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?:([A-Za-z]):)/, "$1:"));
const ARTIFACTS = path.join(ROOT, "artifacts");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PAGE_URL = "http://localhost/aaa/youFree-browser-resolver/transfer-lab/";
const INPUT_URL = process.env.VBS_TEST_URL || "https://www.youtube.com/watch?v=MryMoDHHf7c";

await mkdir(ARTIFACTS, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: CHROME });
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("Network.enable");
await cdp.send("ServiceWorker.enable");
const report = { video: INPUT_URL, createdAt: new Date().toISOString(), media: [], swEvents: [], requests: [], failures: [], cdpFailures: [], workerErrors: [] };

page.on("request", request => {
  if (request.url().includes("virtual-opaque-download")) report.requests.push({ url: request.url(), method: request.method(), resourceType: request.resourceType() });
});
page.on("requestfailed", request => {
  if (request.url().includes("virtual-opaque-download")) report.failures.push({ url: request.url(), failure: request.failure() });
});
cdp.on("Network.loadingFailed", event => report.cdpFailures.push({ errorText: event.errorText, blockedReason: event.blockedReason || "", canceled: event.canceled || false, type: event.type || "" }));
cdp.on("ServiceWorker.workerErrorReported", event => report.workerErrors.push(event.errorMessage));

page.on("response", response => {
  if (!response.url().includes("googlevideo.com/videoplayback")) return;
  report.media.push({
    status: response.status(),
    host: new URL(response.url()).hostname,
    fromServiceWorker: response.fromServiceWorker(),
    type: response.headers()["content-type"] || "",
    disposition: response.headers()["content-disposition"] || ""
  });
});

try {
  await page.goto(PAGE_URL, { waitUntil: "networkidle" });
  await page.getByTestId("youtube-url").fill(INPUT_URL);
  await page.getByTestId("resolve").click();
  await page.waitForFunction(() => window.__vbsV7?.phase === "resolved", null, { timeout: 30000 });
  const resolved = await page.evaluate(() => ({
    videoId: window.__vbsV7.selected.videoId,
    title: window.__vbsV7.selected.title,
    target: window.__vbsV7.downloadTarget.directUrl
  }));
  report.resolved = { videoId: resolved.videoId, title: resolved.title, targetHost: new URL(resolved.target).hostname };

  const id = resolved.videoId + "-opaque";
  report.registration = await page.evaluate(({ id, url }) => window.swCommand({ type: "register-download", id, url }), { id, url: resolved.target });
  report.serviceWorker = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return {
      controller: navigator.serviceWorker.controller?.scriptURL || "",
      active: registration.active?.scriptURL || "",
      state: registration.active?.state || "",
      status: await window.swCommand({ type: "status" })
    };
  });
  const filename = resolved.title.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 100) + ".mp4";
  const virtualUrl = new URL("virtual-opaque-download/" + id + ".mp4", PAGE_URL).href;
  await page.evaluate(({ virtualUrl, filename }) => {
    const link = document.createElement("a");
    link.id = "opaque-download-probe";
    link.href = virtualUrl;
    link.download = filename;
    link.textContent = "opaque download probe";
    document.body.appendChild(link);
    navigator.serviceWorker.addEventListener("message", event => {
      if (event.data?.type === "vbs-opaque-download") window.__opaqueDownloadEvent = event.data;
    });
  }, { virtualUrl, filename });

  try {
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 60000 }),
      page.locator("#opaque-download-probe").click({ noWaitAfter: true })
    ]);
    const failure = await download.failure();
    report.download = { suggestedFilename: download.suggestedFilename(), failure };
    if (!failure) {
      const output = path.join(ARTIFACTS, "opaque-download-probe.mp4");
      await download.saveAs(output);
      const fileStat = await stat(output);
      const signature = (await readFile(output)).subarray(0, 32).toString("hex");
      report.download.bytes = fileStat.size;
      report.download.first32Hex = signature;
      report.download.validMp4 = fileStat.size > 1024 && signature.includes("66747970");
      report.download.output = output;
    }
  } catch (error) {
    report.download = { error: error.name + ": " + error.message };
  }

  report.swEvent = await page.evaluate(() => window.__opaqueDownloadEvent || null).catch(() => null);
} finally {
  await writeFile(path.join(ARTIFACTS, "opaque-download-probe.json"), JSON.stringify(report, null, 2));
  await context.close();
  await browser.close();
}

console.log(JSON.stringify(report, null, 2));
