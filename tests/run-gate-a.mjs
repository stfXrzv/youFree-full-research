import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

const target = process.env.LAB_URL
  || "http://localhost/aaa/vibestream-browser-resolver/lab/";
const video = process.env.VIDEO_ID || "A9-t86OAtM0";
const output = process.env.RESULT_PATH || "";
const useRangeServiceWorker = process.env.RANGE_SW === "1";
const chrome = process.env.CHROME_PATH
  || "C:/Program Files/Google/Chrome/Application/chrome.exe";

function networkShape(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return {
      origin: url.origin,
      path: url.pathname,
      queryKeys: [...new Set([...url.searchParams.keys()])].sort(),
    };
  } catch {
    return { origin: "invalid", path: "", queryKeys: [] };
  }
}

const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ["--autoplay-policy=no-user-gesture-required"],
});

const context = await browser.newContext({
  serviceWorkers: "allow",
});
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("Network.enable");
const diagnostics = [];
const ephemeralMediaRequests = [];
const cdpMediaRequests = new Map();

cdp.on("Network.requestWillBeSent", (event) => {
  try {
    const url = new URL(event.request.url);
    if (url.hostname.endsWith(".googlevideo.com")) {
      cdpMediaRequests.set(event.requestId, networkShape(event.request.url));
    }
  } catch {
    // Ignore malformed diagnostic URLs.
  }
});
cdp.on("Network.responseReceivedExtraInfo", (event) => {
  const request = cdpMediaRequests.get(event.requestId);
  if (!request) return;
  const headers = Object.fromEntries(
    Object.entries(event.headers || {})
      .filter(([name]) => [
        "content-type",
        "content-length",
        "content-range",
        "accept-ranges",
        "access-control-allow-origin",
        "cross-origin-resource-policy",
      ].includes(name.toLowerCase())),
  );
  diagnostics.push({
    type: "cdp_response_extra",
    request,
    status: event.statusCode,
    headers,
  });
});
cdp.on("Network.loadingFailed", (event) => {
  const request = cdpMediaRequests.get(event.requestId);
  if (!request) return;
  diagnostics.push({
    type: "cdp_loading_failed",
    request,
    error: event.errorText,
    blockedReason: event.blockedReason || "",
    corsErrorStatus: event.corsErrorStatus || null,
  });
});

page.on("console", (entry) => {
  if (["error", "warning"].includes(entry.type())) {
    diagnostics.push({ type: `console_${entry.type()}`, text: entry.text() });
  }
});
page.on("pageerror", (error) => {
  diagnostics.push({ type: "page_error", text: error.message });
});
page.on("request", (request) => {
  try {
    const url = new URL(request.url());
    if (url.hostname.endsWith(".googlevideo.com") && ephemeralMediaRequests.length < 4) {
      const headers = request.headers();
      ephemeralMediaRequests.push({
        url: request.url(),
        headers: Object.fromEntries(
          ["origin", "referer", "range", "sec-fetch-dest", "sec-fetch-mode", "user-agent"]
            .filter((name) => headers[name])
            .map((name) => [name, headers[name]]),
        ),
      });
    }
  } catch {
    // Ignore malformed diagnostic URLs.
  }
});
page.on("requestfailed", (request) => {
  diagnostics.push({
    type: "request_failed",
    request: networkShape(request.url()),
    error: request.failure()?.errorText || "unknown",
  });
});

try {
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 15_000 });
  if (useRangeServiceWorker) {
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("./media-range-sw.js", { scope: "./" });
      await navigator.serviceWorker.ready;
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  }
  await page.locator("#video-url").fill(video);
  await page.locator("#run-probe").click();
  await page.waitForFunction(
    () => !["idle", "running"].includes(
      document.querySelector("#gate-verdict")?.dataset.status || "idle",
    ),
    { timeout: 180_000 },
  );

  const result = await page.evaluate(() => ({
    recordedAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    serviceWorkerControlled: Boolean(navigator.serviceWorker.controller),
    verdict: document.querySelector("#gate-verdict")?.textContent || "",
    status: document.querySelector("#gate-verdict")?.dataset.status || "",
    reason: document.querySelector("#gate-reason")?.textContent || "",
    rows: [...document.querySelectorAll("#matrix-body tr")].map((row) =>
      [...row.querySelectorAll("td")].map((cell) => (cell.textContent || "").trim()),
    ),
    events: JSON.parse(document.querySelector("#event-log")?.textContent || "[]"),
  }));

  const rangeProbes = [];
  const requestMap = new Map(ephemeralMediaRequests.map((entry) => [entry.url, entry]));
  for (const entry of requestMap.values()) {
    const variants = [
      { name: "no_range", range: null, headers: {} },
      { name: "one_byte", range: "bytes=0-0", headers: {} },
      { name: "query_64k", range: null, queryEnd: (64 * 1024) - 1, headers: {} },
      { name: "query_512k", range: null, queryEnd: (512 * 1024) - 1, headers: {} },
      { name: "query_chunk", range: null, queryEnd: (2 * 1024 * 1024) - 1, headers: {} },
      { name: "query_chunk_open", range: "bytes=0-", queryEnd: (2 * 1024 * 1024) - 1, headers: {} },
      { name: "query_full_open", range: "bytes=0-", queryRange: "full", headers: {} },
      { name: "open_range", range: "bytes=0-", headers: {} },
      {
        name: "browser_exact",
        range: "bytes=0-",
        headers: { Referer: `${new URL(target).origin}/` },
      },
      {
        name: "page_origin",
        range: "bytes=0-0",
        headers: { Origin: new URL(target).origin },
      },
      {
        name: "youtube_referer",
        range: "bytes=0-0",
        headers: { Referer: "https://www.youtube.com/" },
      },
    ];
    for (const variant of variants) {
      try {
        const probeUrl = new URL(entry.url);
        if (variant.queryRange || Number.isInteger(variant.queryEnd)) {
          const length = Number(probeUrl.searchParams.get("clen") || 0);
          const end = Number.isInteger(variant.queryEnd)
            ? variant.queryEnd
            : variant.queryRange === "full" && length > 0
            ? length - 1
            : (2 * 1024 * 1024) - 1;
          probeUrl.searchParams.set("range", `0-${end}`);
        }
        const headers = {
          "User-Agent": result.userAgent,
          ...variant.headers,
        };
        if (variant.range) headers.Range = variant.range;
        const response = await fetch(probeUrl, {
          headers,
          redirect: "manual",
        });
        rangeProbes.push({
          variant: variant.name,
          browserRequestHeaders: entry.headers,
          request: networkShape(probeUrl),
          status: response.status,
          type: response.headers.get("content-type") || "",
          length: response.headers.get("content-length") || "",
          range: response.headers.get("content-range") || "",
          acceptsRanges: response.headers.get("accept-ranges") || "",
          allowOrigin: response.headers.get("access-control-allow-origin") || "",
          resourcePolicy: response.headers.get("cross-origin-resource-policy") || "",
        });
        await response.body?.cancel();
      } catch (error) {
        rangeProbes.push({
          variant: variant.name,
          browserRequestHeaders: entry.headers,
          request: networkShape(probeUrl),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const report = {
    schema: "vibestream-gate-a-playwright-v1",
    target,
    video,
    useRangeServiceWorker,
    result,
    rangeProbes,
    diagnostics,
  };

  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (output) {
    const destination = resolve(output);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, serialized, "utf8");
  }
  process.stdout.write(serialized);
} finally {
  await browser.close();
}
