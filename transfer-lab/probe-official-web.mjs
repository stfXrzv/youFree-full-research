import { chromium } from "playwright";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
const SAFARI_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.5 Safari/605.1.15,gzip(gfe)";
const homeHtml = await (await fetch("https://www.youtube.com/", { headers: { "User-Agent": CHROME_UA } })).text();
const config = {
  clientVersion: homeHtml.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1] || "",
  visitorData: homeHtml.match(/"visitorData":"([^"]+)"/)?.[1] || "",
  apiKey: homeHtml.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1] || "",
  sts: Number(homeHtml.match(/"STS":(\d+)/)?.[1] || 0)
};
const endpoint = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false&key=" + encodeURIComponent(config.apiKey);
const client = {
  clientName: "WEB",
  clientVersion: config.clientVersion,
  visitorData: config.visitorData,
  userAgent: SAFARI_UA,
  hl: "en",
  gl: "GB"
};
const payload = {
  videoId: "A9-t86OAtM0",
  context: {
    client,
    user: { lockedSafetyMode: false },
    request: { useSsl: true, internalExperimentFlags: [], consistencyTokenJars: [] }
  },
  playbackContext: { contentPlaybackContext: { html5Preference: "HTML5_PREF_WANTS", lactMilliseconds: "-1", signatureTimestamp: config.sts || undefined } },
  contentCheckOk: true,
  racyCheckOk: true
};

function summarize(player) {
  const streaming = player.streamingData || {};
  const all = [...(streaming.formats || []), ...(streaming.adaptiveFormats || [])];
  return {
    playability: player.playabilityStatus,
    streamingKeys: Object.keys(streaming),
    formats: all.map(format => ({
      itag: Number(format.itag || 0),
      qualityLabel: format.qualityLabel || "",
      height: Number(format.height || 0),
      mimeType: format.mimeType || "",
      hasUrl: Boolean(format.url),
      hasCipher: Boolean(format.signatureCipher || format.cipher),
      hasAudio: Boolean(format.audioQuality || format.audioChannels)
    })),
    hasHls: Boolean(streaming.hlsManifestUrl),
    hasDash: Boolean(streaming.dashManifestUrl),
    hasServerAbr: Boolean(streaming.serverAbrStreamingUrl)
  };
}

const nodeResponse = await fetch(endpoint, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Origin": "https://www.youtube.com",
    "Referer": "https://www.youtube.com/",
    "User-Agent": SAFARI_UA,
    "X-Youtube-Client-Name": "1",
    "X-Youtube-Client-Version": config.clientVersion
  },
  body: JSON.stringify(payload)
});
const nodePlayer = await nodeResponse.json();

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const context = await browser.newContext({ userAgent: SAFARI_UA });
const page = await context.newPage();
const browserNetwork = [];
page.on("response", response => {
  if (response.url().includes("/youtubei/v1/player")) browserNetwork.push({ status: response.status(), headers: response.headers() });
});
await page.goto("http://localhost/aaa/ytdwl/_cache_lab/native-probe.html", { waitUntil: "domcontentloaded" });
const browserResult = await page.evaluate(async ({ endpoint, payload, version }) => {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      headers: {
        "Content-Type": "application/json",
        "X-Youtube-Client-Name": "1",
        "X-Youtube-Client-Version": version
      },
      body: JSON.stringify(payload)
    });
    return { ok: true, status: response.status, player: await response.json() };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}, { endpoint, payload, version: config.clientVersion });
await browser.close();

console.log(JSON.stringify({
  config: { clientVersion: config.clientVersion, hasVisitorData: Boolean(config.visitorData), sts: config.sts },
  node: { status: nodeResponse.status, result: summarize(nodePlayer) },
  browser: { pageResult: browserResult.ok ? { ok: true, status: browserResult.status, result: summarize(browserResult.player) } : browserResult, network: browserNetwork }
}, null, 2));
