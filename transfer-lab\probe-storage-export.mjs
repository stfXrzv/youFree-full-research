import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?:([A-Za-z]):)/, "$1:"));
const ARTIFACTS = path.join(ROOT, "artifacts");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PAGE_URL = "http://localhost/aaa/vibestream-browser-resolver/transfer-lab/";
const INPUT_URL = process.env.VBS_TEST_URL || "https://www.youtube.com/watch?v=MryMoDHHf7c";

await mkdir(ARTIFACTS, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: CHROME });
const context = await browser.newContext();
const page = await context.newPage();
await page.goto(PAGE_URL, { waitUntil: "networkidle" });
await page.getByTestId("youtube-url").fill(INPUT_URL);
await page.getByTestId("resolve").click();
await page.waitForFunction(() => window.__vbsV7?.phase === "resolved", null, { timeout: 30000 });
await page.getByTestId("cache").click();
await page.waitForFunction(() => window.__vbsV7?.phase === "cached", null, { timeout: 60000 });

const result = await page.evaluate(async () => {
  const registration = await navigator.serviceWorker.ready;
  const manifest = window.__vbsV7.manifest;
  const cache = await caches.open("vibestream-query-range-v7-media");
  const response = await cache.match(manifest.video.url, { ignoreVary: true });
  const cloneForBlob = response.clone();
  const cloneForBuffer = response.clone();
  const blob = await cloneForBlob.blob();
  const buffer = await cloneForBuffer.arrayBuffer();

  const storage = {
    cacheResponse: {
      type: response.type,
      status: response.status,
      bodyVisible: Boolean(response.body),
      blobBytes: blob.size,
      arrayBufferBytes: buffer.byteLength
    },
    opfsSupported: Boolean(navigator.storage?.getDirectory),
    backgroundFetchSupported: Boolean(registration.backgroundFetch),
    showSaveFilePickerSupported: Boolean(window.showSaveFilePicker)
  };

  if (navigator.storage?.getDirectory) {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle("opaque-export-test.bin", { create: true });
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    const file = await handle.getFile();
    storage.opfsBytesWrittenFromOpaqueBlob = file.size;
    await root.removeEntry("opaque-export-test.bin");
  }

  return storage;
});

const report = { video: INPUT_URL, createdAt: new Date().toISOString(), result };
await writeFile(path.join(ARTIFACTS, "storage-export-probe.json"), JSON.stringify(report, null, 2));
await context.close();
await browser.close();
console.log(JSON.stringify(report, null, 2));
