import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const chrome = process.env.CHROME_PATH
  || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const target = process.env.LAB_URL
  || "http://localhost/aaa/youFree-browser-resolver/lab/";
const outputDir = resolve("artifacts/mux-proof");
const fixture = resolve("tests/fixtures/sample.mp4");
const videoPath = resolve(outputDir, "video.mp4");
const audioPath = resolve(outputDir, "audio.m4a");
const muxedPath = resolve(outputDir, "muxed.mp4");

function command(name, args) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(name, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) resolveCommand({ stdout, stderr });
      else reject(new Error(`${name} exited with ${code}: ${stderr.slice(-1200)}`));
    });
  });
}

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
await command("ffmpeg", ["-y", "-v", "error", "-i", fixture, "-map", "0:v:0", "-c", "copy", videoPath]);
await command("ffmpeg", ["-y", "-v", "error", "-i", fixture, "-map", "0:a:0", "-c", "copy", audioPath]);

const browser = await chromium.launch({ executablePath: chrome, headless: true });
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
let browserResult;

try {
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 15_000 });
  browserResult = await page.evaluate(async () => {
    const module = await import("./ytmux.mjs");
    const [videoResponse, audioResponse] = await Promise.all([
      fetch("../artifacts/mux-proof/video.mp4"),
      fetch("../artifacts/mux-proof/audio.m4a"),
    ]);
    const videoBlob = await videoResponse.blob();
    const audioBlob = await audioResponse.blob();
    const muxedBlob = await module.ytmuxMuxAuto(videoBlob, audioBlob);
    window.__youFreeMuxProof = muxedBlob;

    const database = await new Promise((resolveDb, rejectDb) => {
      const request = indexedDB.open("youFree-mux-proof", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("assets");
      request.onsuccess = () => resolveDb(request.result);
      request.onerror = () => rejectDb(request.error);
    });
    await new Promise((resolveWrite, rejectWrite) => {
      const transaction = database.transaction("assets", "readwrite");
      transaction.objectStore("assets").put(muxedBlob, "muxed");
      transaction.oncomplete = resolveWrite;
      transaction.onerror = () => rejectWrite(transaction.error);
    });
    const storedBlob = await new Promise((resolveRead, rejectRead) => {
      const request = database.transaction("assets", "readonly").objectStore("assets").get("muxed");
      request.onsuccess = () => resolveRead(request.result);
      request.onerror = () => rejectRead(request.error);
    });
    database.close();

    const digest = await crypto.subtle.digest("SHA-256", await storedBlob.arrayBuffer());
    const sha256 = [...new Uint8Array(digest)]
      .map(value => value.toString(16).padStart(2, "0"))
      .join("");
    const playback = await new Promise(resolvePlayback => {
      const player = document.createElement("video");
      const source = URL.createObjectURL(storedBlob);
      player.muted = true;
      player.playsInline = true;
      document.body.append(player);
      const finish = result => {
        clearTimeout(timer);
        player.pause();
        player.removeAttribute("src");
        player.load();
        player.remove();
        URL.revokeObjectURL(source);
        resolvePlayback(result);
      };
      const timer = setTimeout(() => finish({ ok: false, reason: "timeout" }), 8000);
      player.addEventListener("error", () => finish({
        ok: false,
        reason: "media_error",
        code: player.error?.code || 0,
      }), { once: true });
      player.addEventListener("loadedmetadata", async () => {
        try {
          await player.play();
          setTimeout(() => finish({
            ok: player.readyState >= 2,
            duration: player.duration,
            currentTime: player.currentTime,
            videoWidth: player.videoWidth,
            videoHeight: player.videoHeight,
          }), 500);
        } catch (error) {
          finish({ ok: false, reason: error.message });
        }
      }, { once: true });
      player.src = source;
      player.load();
    });
    return {
      videoBytes: videoBlob.size,
      audioBytes: audioBlob.size,
      outputBytes: muxedBlob.size,
      outputType: muxedBlob.type,
      indexedDbBytes: storedBlob.size,
      sha256,
      playback,
    };
  });

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15_000 }),
    page.evaluate(() => {
      const link = document.createElement("a");
      link.href = URL.createObjectURL(window.__youFreeMuxProof);
      link.download = "muxed.mp4";
      link.click();
    }),
  ]);
  await download.saveAs(muxedPath);
} finally {
  await context.close();
  await browser.close();
}

const probe = await command("ffprobe", [
  "-v", "error",
  "-show_entries", "stream=index,codec_type,codec_name",
  "-show_entries", "format=duration,size",
  "-of", "json",
  muxedPath,
]);
const media = JSON.parse(probe.stdout);
const streams = media.streams || [];
const signature = (await readFile(muxedPath)).subarray(0, 32).toString("hex");
const muxedStat = await stat(muxedPath);
const report = {
  schema: "youFree-mux-proof-v1",
  recordedAt: new Date().toISOString(),
  runtime: "Chrome browser Blob mux",
  browserResult,
  output: {
    bytes: muxedStat.size,
    signature,
    duration: Number(media.format?.duration || 0),
    streams: streams.map(stream => ({
      index: stream.index,
      type: stream.codec_type,
      codec: stream.codec_name,
    })),
  },
};
report.pass = browserResult.outputType === "video/mp4"
  && browserResult.outputBytes === muxedStat.size
  && browserResult.indexedDbBytes === muxedStat.size
  && /^[a-f0-9]{64}$/.test(browserResult.sha256)
  && browserResult.playback.ok
  && streams.some(stream => stream.codec_type === "video")
  && streams.some(stream => stream.codec_type === "audio")
  && signature.includes("66747970");

await writeFile(resolve(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.pass) process.exitCode = 1;
