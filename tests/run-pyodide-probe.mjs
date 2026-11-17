import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const target = process.env.LAB_URL
  || "http://localhost/aaa/youFree-browser-resolver/lab/";
const chrome = process.env.CHROME_PATH
  || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const action = process.env.PYODIDE_ACTION || "yt_dlp_extract";
const videoId = process.env.VIDEO_ID || "A9-t86OAtM0";
const output = process.env.RESULT_PATH || "artifacts/pyodide-result.json";

const browser = await chromium.launch({ executablePath: chrome, headless: true });
const page = await browser.newPage();
try {
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 15_000 });
  const result = await page.evaluate(({ action, videoId }) => new Promise((resolve, reject) => {
    const worker = new Worker("./pyodide-worker.mjs", { type: "module" });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error("Pyodide probe timed out."));
    }, 180_000);
    worker.addEventListener("message", (event) => {
      if (event.data?.id !== "inspect-1") return;
      clearTimeout(timer);
      worker.terminate();
      resolve(event.data);
    });
    worker.addEventListener("error", (event) => {
      clearTimeout(timer);
      worker.terminate();
      reject(new Error(event.message || "Pyodide worker failed."));
    });
    worker.postMessage({ id: "inspect-1", type: action, videoId });
  }), { action, videoId });
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  const destination = resolve(output);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, serialized, "utf8");
  process.stdout.write(serialized);
} finally {
  await browser.close();
}
