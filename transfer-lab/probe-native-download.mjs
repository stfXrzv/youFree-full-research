import { chromium } from "playwright";
import https from "node:https";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?:([A-Za-z]):)/, "$1:"));
const ARTIFACTS = path.join(ROOT, "artifacts");
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PAGE_URL = "http://localhost/aaa/youFree-browser-resolver/transfer-lab/";
const VIDEO_URL = process.env.VBS_TEST_URL || "https://www.youtube.com/watch?v=MryMoDHHf7c";

function inspectHeaders(url, redirectCount = 0) {
  return new Promise(resolve => {
    const request = https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138.0.0.0 Safari/537.36",
        Range: "bytes=0-0"
      }
    }, response => {
      const location = response.headers.location;
      if (location && response.statusCode >= 300 && response.statusCode < 400 && redirectCount < 4) {
        response.destroy();
        inspectHeaders(new URL(location, url).href, redirectCount + 1).then(result => resolve({ ...result, redirects: redirectCount + 1 }));
        return;
      }
      resolve({
        status: response.statusCode,
        type: response.headers["content-type"] || "",
        disposition: response.headers["content-disposition"] || "",
        length: response.headers["content-length"] || "",
        range: response.headers["content-range"] || ""
      });
      response.destroy();
    });
    request.on("error", error => resolve({ error: error.message }));
    request.setTimeout(15000, () => request.destroy(new Error("header timeout")));
  });
}

await mkdir(ARTIFACTS, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: CHROME });
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
const result = { video: VIDEO_URL, variants: [] };

try {
  await page.goto(PAGE_URL, { waitUntil: "networkidle" });
  await page.getByTestId("youtube-url").fill(VIDEO_URL);
  await page.getByTestId("resolve").click();
  await page.waitForFunction(() => window.__vbsV7?.phase === "resolved", null, { timeout: 30000 });

  const resolved = await page.evaluate(() => ({
    title: window.__vbsV7.selected.title,
    direct: window.__vbsV7.downloadTarget.directUrl
  }));
  result.title = resolved.title;

  const plain = new URL(resolved.direct);
  result.urlShape = {
    host: plain.hostname,
    keys: [...plain.searchParams.keys()].sort(),
    client: plain.searchParams.get("c") || "",
    source: plain.searchParams.get("source") || "",
    itag: plain.searchParams.get("itag") || "",
    mime: plain.searchParams.get("mime") || "",
    requiresSsl: plain.searchParams.get("requiressl") || "",
    rqh: plain.searchParams.get("rqh") || "",
    gir: plain.searchParams.get("gir") || "",
    cnr: plain.searchParams.get("cnr") || "",
    xtags: plain.searchParams.get("xtags") || "",
    vprv: plain.searchParams.get("vprv") || "",
    svpuc: plain.searchParams.get("svpuc") || "",
    sparams: plain.searchParams.get("sparams") || "",
    lsparams: plain.searchParams.get("lsparams") || ""
  };
  plain.searchParams.delete("range");
  plain.searchParams.delete("title");
  const cleanTitle = resolved.title.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  const candidates = [
    ["base-no-title", "", {}],
    ["title-short", "youFree Test", {}],
    ["title-48", cleanTitle.slice(0, 48).trim(), {}],
    ["title-64", cleanTitle.slice(0, 64).trim(), {}],
    ["title-80", cleanTitle.slice(0, 80).trim(), {}],
    ["title-full", cleanTitle, {}],
    ["title-cnr", "youFree Test", { cnr: "14" }],
    ["title-xtags", "youFree Test", { xtags: "heaudio=true" }],
    ["title-cnr-xtags", "youFree Test", { cnr: "14", xtags: "heaudio=true" }],
    ["title-player-tail", "youFree Test", { alr: "yes", cpn: "VBSCLIENTTEST1", rn: "1", rbuf: "0" }],
    ["title-download", "youFree Test", { download: "1" }],
    ["title-response-disposition", "youFree Test", { "response-content-disposition": "attachment; filename=youFree.mp4" }],
    ["title-content-disposition", "youFree Test", { "content-disposition": "attachment" }],
    ["title-redirector", "youFree Test", { $host: "redirector.googlevideo.com" }],
    ["title-youtube-host", "youFree Test", { $host: "www.youtube.com" }]
  ];

  for (const [name, candidateTitle, additions] of candidates) {
    const target = new URL(plain);
    if (candidateTitle) target.searchParams.set("title", candidateTitle);
    if (additions.$host) target.hostname = additions.$host;
    for (const [key, value] of Object.entries(additions)) {
      if (!key.startsWith("$")) target.searchParams.set(key, value);
    }
    const headers = await inspectHeaders(target.href);
    const network = [];
    const onResponse = response => {
      if (response.url().includes("googlevideo.com/videoplayback")) {
        network.push({ status: response.status(), headers: response.headers() });
      }
    };
    page.on("response", onResponse);

    const anchor = await page.evaluateHandle(({ href, filename }) => {
      const link = document.createElement("a");
      link.href = href;
      link.download = filename;
      link.textContent = "probe";
      document.body.appendChild(link);
      return link;
    }, { href: target.href, filename: "probe.mp4" });

    let download = null;
    let failure = "";
    if (headers.disposition) {
      try {
        const [event] = await Promise.all([
          page.waitForEvent("download", { timeout: 12000 }),
          anchor.asElement().click({ noWaitAfter: true })
        ]);
        download = {
          filename: event.suggestedFilename(),
          failure: await event.failure().catch(() => null)
        };
        await event.cancel().catch(() => {});
      } catch (error) {
        failure = error.message.split("\n")[0];
      }
    }

    result.variants.push({
      name,
      titleLength: candidateTitle.length,
      queryRange: target.searchParams.get("range") || "",
      hasTitle: target.searchParams.has("title"),
      headers,
      chromeResponses: network.map(item => ({
        status: item.status,
        type: item.headers["content-type"] || "",
        disposition: item.headers["content-disposition"] || ""
      })),
      download,
      failure,
      finalPageHost: new URL(page.url()).hostname
    });
    page.off("response", onResponse);
    await anchor.dispose();
    if (page.url() !== PAGE_URL) await page.goto(PAGE_URL, { waitUntil: "domcontentloaded" });
  }
} finally {
  await context.close();
  await browser.close();
}

await writeFile(path.join(ARTIFACTS, "native-download-probe.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));

