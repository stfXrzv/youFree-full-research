import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?:([A-Za-z]):)/, "$1:"));
const ARTIFACTS = path.join(ROOT, "artifacts");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PAGE_URL = "http://localhost/aaa/youFree-browser-resolver/transfer-lab/";
const VIDEO_URL = process.env.VBS_TEST_URL || "https://www.youtube.com/watch?v=MryMoDHHf7c";

async function recordVariant(page, label, source) {
  const result = await page.evaluate(async ({ label, source }) => {
    const video = document.querySelector("#video");
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const waitFor = (target, type, timeout = 15000) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(type + " timeout")), timeout);
      target.addEventListener(type, () => { clearTimeout(timer); resolve(); }, { once: true });
      target.addEventListener("error", () => { clearTimeout(timer); reject(new Error(video.error?.message || "media error")); }, { once: true });
    });

    video.pause();
    video.removeAttribute("crossorigin");
    video.src = source;
    video.muted = false;
    video.load();
    if (video.readyState < 2) await waitFor(video, "loadeddata");
    await video.play();
    await sleep(1000);

    let canvasReadable = false;
    let canvasError = "";
    try {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(video.videoWidth, 1);
      canvas.height = Math.max(video.videoHeight, 1);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(video, 0, 0);
      context.getImageData(0, 0, 1, 1);
      canvasReadable = true;
    } catch (error) {
      canvasError = error.name + ": " + error.message;
    }

    const capture = video.captureStream || video.mozCaptureStream;
    if (!capture) throw new Error("HTMLMediaElement.captureStream is unavailable");
    const stream = capture.call(video);
    const tracks = stream.getTracks().map(track => ({ kind: track.kind, muted: track.muted, readyState: track.readyState }));
    const mimeCandidates = [
      "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
      "video/webm;codecs=vp8,opus",
      "video/webm"
    ];
    const mimeType = mimeCandidates.find(type => MediaRecorder.isTypeSupported(type)) || "";
    const chunks = [];
    let recorderError = "";
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorder.addEventListener("dataavailable", event => { if (event.data.size) chunks.push(event.data); });
    recorder.addEventListener("error", event => { recorderError = event.error?.name + ": " + event.error?.message; });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("MediaRecorder stop timeout")), 8000);
      recorder.addEventListener("stop", () => { clearTimeout(timer); resolve(); }, { once: true });
      try {
        recorder.start(250);
      } catch (error) {
        clearTimeout(timer);
        reject(error);
        return;
      }
      setTimeout(() => {
        if (recorder.state !== "inactive") recorder.stop();
      }, 3000);
    });

    const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || "video/webm" });
    window.__vbsCaptureBlob = blob;
    video.pause();
    return {
      label,
      sourceHost: new URL(source).hostname,
      readyState: video.readyState,
      duration: video.duration,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      canvasReadable,
      canvasError,
      tracks,
      mimeType: blob.type,
      blobBytes: blob.size,
      chunks: chunks.length,
      recorderError
    };
  }, { label, source });

  if (result.blobBytes > 0) {
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 10000 }),
      page.evaluate(filename => {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(window.__vbsCaptureBlob);
        link.download = filename;
        link.click();
      }, "capture-" + label + (result.mimeType.includes("mp4") ? ".mp4" : ".webm"))
    ]);
    const extension = result.mimeType.includes("mp4") ? ".mp4" : ".webm";
    const output = path.join(ARTIFACTS, "capture-" + label + extension);
    await download.saveAs(output);
    result.output = output;
    result.downloadFailure = await download.failure();
  }
  return result;
}

await mkdir(ARTIFACTS, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: CHROME });
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
const report = { video: VIDEO_URL, createdAt: new Date().toISOString(), variants: [] };

try {
  await page.goto(PAGE_URL, { waitUntil: "networkidle" });
  await page.getByTestId("youtube-url").fill(VIDEO_URL);
  await page.getByTestId("resolve").click();
  await page.waitForFunction(() => window.__vbsV7?.phase === "resolved", null, { timeout: 30000 });
  await page.getByTestId("cache").click();
  await page.waitForFunction(() => window.__vbsV7?.phase === "cached", null, { timeout: 60000 });

  const manifest = await page.evaluate(() => window.__vbsV7.manifest);
  report.manifest = { videoId: manifest.videoId, expectedBytes: manifest.expectedBytes, opaque: manifest.video.observed.type === "opaque" };
  await page.evaluate(() => window.swCommand({ type: "set-strict-offline", enabled: true }));

  try {
    report.variants.push(await recordVariant(page, "cross-origin-cache", manifest.video.url));
  } catch (error) {
    report.variants.push({ label: "cross-origin-cache", error: error.name + ": " + error.message });
  }

  const aliasId = manifest.videoId + "-capture";
  const aliasResult = await page.evaluate(({ aliasId, url }) => window.swCommand({ type: "register-media-alias", id: aliasId, url }), { aliasId, url: manifest.video.url });
  report.aliasRegistration = aliasResult;
  const aliasUrl = new URL("virtual-media/" + aliasId, PAGE_URL).href;
  try {
    report.variants.push(await recordVariant(page, "same-origin-alias", aliasUrl));
  } catch (error) {
    report.variants.push({ label: "same-origin-alias", error: error.name + ": " + error.message });
  }
} finally {
  await page.evaluate(() => window.swCommand?.({ type: "set-strict-offline", enabled: false })).catch(() => {});
  await writeFile(path.join(ARTIFACTS, "capture-probe.json"), JSON.stringify(report, null, 2));
  await context.close();
  await browser.close();
}

console.log(JSON.stringify(report, null, 2));
