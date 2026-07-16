import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { ytmuxMuxAuto } from "../lab/ytmux.mjs";

const outputDir = resolve("artifacts/mux-fmp4-proof");
const fixture = resolve("tests/fixtures/sample.mp4");
const videoPath = resolve(outputDir, "video-fragmented.mp4");
const audioPath = resolve(outputDir, "audio-fragmented.m4a");
const muxedPath = resolve(outputDir, "muxed-fragmented.mp4");
const fragmentFlags = "+frag_keyframe+empty_moov+default_base_moof";

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
await command("ffmpeg", [
  "-y", "-v", "error", "-i", fixture,
  "-map", "0:v:0", "-c", "copy", "-movflags", fragmentFlags, videoPath,
]);
await command("ffmpeg", [
  "-y", "-v", "error", "-i", fixture,
  "-map", "0:a:0", "-c", "copy", "-movflags", fragmentFlags, audioPath,
]);

const videoBlob = new Blob([await readFile(videoPath)], { type: "video/mp4" });
const audioBlob = new Blob([await readFile(audioPath)], { type: "audio/mp4" });
const muxedBlob = await ytmuxMuxAuto(videoBlob, audioBlob);
await writeFile(muxedPath, new Uint8Array(await muxedBlob.arrayBuffer()));

const probe = await command("ffprobe", [
  "-v", "error",
  "-show_entries", "stream=index,codec_type,codec_name",
  "-show_entries", "format=duration,size",
  "-of", "json",
  muxedPath,
]);
const media = JSON.parse(probe.stdout);
const streams = media.streams || [];
const muxedStat = await stat(muxedPath);
const report = {
  schema: "vibestream-fmp4-mux-proof-v1",
  recordedAt: new Date().toISOString(),
  input: { videoBytes: videoBlob.size, audioBytes: audioBlob.size },
  output: {
    bytes: muxedStat.size,
    duration: Number(media.format?.duration || 0),
    streams: streams.map(stream => ({
      index: stream.index,
      type: stream.codec_type,
      codec: stream.codec_name,
    })),
  },
};
report.pass = streams.some(stream => stream.codec_type === "video")
  && streams.some(stream => stream.codec_type === "audio")
  && report.output.duration > 0;

await writeFile(resolve(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.pass) process.exitCode = 1;
