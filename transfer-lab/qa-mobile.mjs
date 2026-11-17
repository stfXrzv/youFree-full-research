import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?:([A-Za-z]):)/, "$1:"));
const ARTIFACTS = path.join(ROOT, "artifacts");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PAGE_URL = "http://localhost/aaa/youFree-browser-resolver/transfer-lab/";

await mkdir(ARTIFACTS, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: CHROME });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true
});
const page = await context.newPage();
const consoleErrors = [];
page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
page.on("pageerror", error => consoleErrors.push(error.message));

await page.goto(PAGE_URL, { waitUntil: "networkidle" });
await page.getByTestId("youtube-url").fill("https://www.youtube.com/watch?v=A9-t86OAtM0");
await page.getByTestId("resolve").click();
await page.waitForFunction(() => window.__vbsV7?.phase === "resolved", null, { timeout: 30000 });
const layout = await page.evaluate(() => ({
  viewportWidth: innerWidth,
  documentWidth: document.documentElement.scrollWidth,
  horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
  controls: [...document.querySelectorAll("button, .download-link")].map(element => {
    const rect = element.getBoundingClientRect();
    return { text: element.textContent.trim(), left: rect.left, right: rect.right, width: rect.width, scrollWidth: element.scrollWidth, clippedText: element.scrollWidth > element.clientWidth + 1 };
  })
}));
await page.screenshot({ path: path.join(ARTIFACTS, "mobile-resolved.png"), fullPage: true });
const report = { createdAt: new Date().toISOString(), layout, consoleErrors, pass: !layout.horizontalOverflow && !layout.controls.some(control => control.clippedText) && consoleErrors.length === 0 };
await writeFile(path.join(ARTIFACTS, "mobile-qa.json"), JSON.stringify(report, null, 2));
await context.close();
await browser.close();
console.log(JSON.stringify(report, null, 2));
