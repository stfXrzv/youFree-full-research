import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const videoId = process.env.VIDEO_ID || "A9-t86OAtM0";
const output = resolve(process.env.RESULT_PATH || "artifacts/gate-b-compare.json");

function command(name, args, env = {}) {
  return new Promise((resolveCommand, reject) => {
    const child = spawn(name, args, {
      windowsHide: true,
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) resolveCommand(stdout);
      else reject(new Error(`${name} exited with ${code}: ${stderr.slice(-1200)}`));
    });
  });
}

const pyodideEnvelope = JSON.parse(await command(
  process.execPath,
  ["tests/run-pyodide-probe.mjs"],
  { VIDEO_ID: videoId, RESULT_PATH: "artifacts/pyodide-result.json" },
));
const desktop = JSON.parse(await command("python", ["tests/desktop_extract.py", videoId]));
const pyodide = pyodideEnvelope.result;
const stableKeys = [
  "id",
  "title",
  "duration",
  "formatCount",
  "directCount",
  "maxHeight",
  "hasAudio",
];
const comparisons = Object.fromEntries(stableKeys.map(key => [key, {
  pass: JSON.stringify(pyodide[key]) === JSON.stringify(desktop[key]),
  pyodide: pyodide[key],
  desktop: desktop[key],
}]));
comparisons.itags = {
  pass: JSON.stringify([...pyodide.itags].sort()) === JSON.stringify([...desktop.itags].sort()),
  pyodide: [...pyodide.itags].sort(),
  desktop: [...desktop.itags].sort(),
};

const report = {
  schema: "vibestream-gate-b-compare-v1",
  recordedAt: new Date().toISOString(),
  videoId,
  comparisons,
};
report.pass = Object.values(comparisons).every(item => item.pass);
await mkdir(resolve(output, ".."), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.pass) process.exitCode = 1;
