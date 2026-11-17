import { CLIENT_PROFILES, evaluateGateA, extractVideoId, redactRecord } from "./core.mjs";

const ui = {
  form: document.querySelector("#probe-form"),
  url: document.querySelector("#video-url"),
  clients: document.querySelector("#client-list"),
  run: document.querySelector("#run-probe"),
  cancel: document.querySelector("#cancel-probe"),
  export: document.querySelector("#export-report"),
  clear: document.querySelector("#clear-report"),
  verdict: document.querySelector("#gate-verdict"),
  verdictReason: document.querySelector("#gate-reason"),
  tbody: document.querySelector("#matrix-body"),
  log: document.querySelector("#event-log"),
  network: document.querySelector("#network-state")
};

const state = {
  worker: null,
  running: false,
  videoId: "",
  startedAt: "",
  finishedAt: "",
  events: [],
  results: [],
  probeClaimed: false,
  pendingProbes: []
};

function renderClientOptions() {
  ui.clients.innerHTML = CLIENT_PROFILES.map(profile => `
    <label class="client-option">
      <input type="checkbox" name="client" value="${profile.id}" checked>
      <span>${profile.label}</span>
      <small>${profile.client.clientName}</small>
    </label>
  `).join("");
}

function record(event) {
  state.events.push(redactRecord(event));
  ui.log.textContent = JSON.stringify(state.events, null, 2);
  ui.log.scrollTop = ui.log.scrollHeight;
}

function setRunning(running) {
  state.running = running;
  ui.run.disabled = running;
  ui.cancel.disabled = !running;
  ui.export.disabled = running || state.results.length === 0;
  ui.network.textContent = running ? "User browser → YouTube metadata" : "No media relay";
}

function statusLabel(result) {
  if (!result.apiReadable) return result.classification || "blocked";
  if (result.playability !== "OK") return result.playability;
  if (result.mediaProbe?.video?.ok || result.mediaProbe?.progressive?.ok) return "playable";
  return result.directCount > 0 ? "direct URLs" : result.cipherCount > 0 ? "ciphered" : "no formats";
}

function renderMatrix() {
  if (!state.results.length) {
    ui.tbody.innerHTML = '<tr><td colspan="7" class="empty">Run the matrix to collect evidence.</td></tr>';
    return;
  }
  ui.tbody.innerHTML = state.results.map(result => `
    <tr>
      <th scope="row">${escapeHtml(result.clientLabel || result.clientId)}</th>
      <td><span class="result-tag ${result.apiReadable ? "ok" : "bad"}">${escapeHtml(statusLabel(result))}</span></td>
      <td>${result.httpStatus || "unknown"}</td>
      <td>${result.directCount ?? 0}</td>
      <td>${result.cipherCount ?? 0}</td>
      <td>${result.maxDirectHeight ? `${result.maxDirectHeight}p` : "-"}</td>
      <td>${result.elapsedMs ? `${result.elapsedMs} ms` : "-"}</td>
    </tr>
  `).join("");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
}

function mediaProbe(url, kind) {
  if (!url) return Promise.resolve({ attempted: false, ok: false, reason: "no_direct_url" });
  return new Promise(resolve => {
    const media = document.createElement(kind === "audio" ? "audio" : "video");
    const started = performance.now();
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      media.removeAttribute("src");
      media.load();
      media.remove();
      resolve({ attempted: true, elapsedMs: Math.round(performance.now() - started), ...result });
    };
    const timer = setTimeout(() => finish({ ok: false, reason: "timeout" }), 8000);
    media.preload = "metadata";
    media.muted = true;
    media.playsInline = true;
    media.addEventListener("loadedmetadata", () => finish({ ok: true, duration: Number.isFinite(media.duration) ? media.duration : null }), { once: true });
    media.addEventListener("error", () => finish({ ok: false, reason: "media_error", code: media.error?.code || 0 }), { once: true });
    media.src = url;
    media.load();
  });
}

async function attachMediaEvidence(result, ephemeral) {
  if (!ephemeral) return;
  const selectedUrl = ephemeral.videoUrl || ephemeral.progressiveUrl || ephemeral.hlsUrl;
  if (!selectedUrl) return;
  const kind = ephemeral.videoUrl ? "video" : ephemeral.progressiveUrl ? "progressive" : "hls";
  record({ at: new Date().toISOString(), type: "media_probe_start", clientId: result.clientId, kind, itag: ephemeral.videoItag || ephemeral.progressiveItag });
  const video = await mediaProbe(selectedUrl, "video");
  const audio = ephemeral.audioUrl ? await mediaProbe(ephemeral.audioUrl, "audio") : { attempted: false, ok: false, reason: "not_needed_or_missing" };
  result.mediaProbe = { [kind]: video, video, audio };
  record({ at: new Date().toISOString(), type: "media_probe_complete", clientId: result.clientId, kind, video, audio });
  renderMatrix();
}

function updateVerdict() {
  const verdict = evaluateGateA(state.results);
  ui.verdict.dataset.status = verdict.status;
  ui.verdict.textContent = verdict.status.toUpperCase();
  ui.verdictReason.textContent = verdict.reason;
  record({ at: new Date().toISOString(), type: "gate_a_verdict", ...verdict });
}

function finishRun() {
  Promise.allSettled(state.pendingProbes).then(() => {
    state.finishedAt = new Date().toISOString();
    setRunning(false);
    updateVerdict();
    renderMatrix();
  });
}

function startWorker(videoId, clientIds) {
  state.worker?.terminate();
  state.worker = new Worker(new URL("./transport-worker.mjs", import.meta.url), { type: "module" });
  state.worker.addEventListener("message", event => {
    const message = event.data || {};
    if (message.type === "event") record(message.event);
    if (message.type === "client_result") {
      const result = redactRecord(message.result);
      state.results.push(result);
      renderMatrix();
      const pending = attachMediaEvidence(result, message.ephemeral).catch(error => {
        record({ at: new Date().toISOString(), type: "media_probe_failed", clientId: result.clientId, message: String(error?.message || error) });
      });
      state.pendingProbes.push(pending);
    }
    if (message.type === "complete") finishRun();
    if (message.type === "fatal") {
      record({ at: new Date().toISOString(), type: "worker_fatal", ...message.error });
      finishRun();
    }
  });
  state.worker.addEventListener("error", event => {
    record({ at: new Date().toISOString(), type: "worker_error", message: event.message || "Worker failed" });
    finishRun();
  });
  state.worker.postMessage({ type: "run", videoId, clientIds });
}

ui.form.addEventListener("submit", event => {
  event.preventDefault();
  const videoId = extractVideoId(ui.url.value);
  const clientIds = [...ui.clients.querySelectorAll('input[name="client"]:checked')].map(input => input.value);
  if (!videoId) {
    ui.verdict.dataset.status = "fail";
    ui.verdict.textContent = "INVALID URL";
    ui.verdictReason.textContent = "Enter a YouTube URL or an 11-character video ID.";
    return;
  }
  if (!clientIds.length) {
    ui.verdictReason.textContent = "Select at least one client profile.";
    return;
  }
  Object.assign(state, {
    videoId,
    startedAt: new Date().toISOString(),
    finishedAt: "",
    events: [],
    results: [],
    probeClaimed: false,
    pendingProbes: []
  });
  ui.verdict.dataset.status = "running";
  ui.verdict.textContent = "RUNNING";
  ui.verdictReason.textContent = "Testing metadata transport from this browser origin.";
  renderMatrix();
  setRunning(true);
  startWorker(videoId, clientIds);
});

ui.cancel.addEventListener("click", () => {
  state.worker?.postMessage({ type: "cancel" });
  state.worker?.terminate();
  record({ at: new Date().toISOString(), type: "run_cancelled" });
  setRunning(false);
  ui.verdict.dataset.status = "candidate";
  ui.verdict.textContent = "CANCELLED";
  ui.verdictReason.textContent = "The local Worker was stopped.";
});

ui.clear.addEventListener("click", () => {
  state.worker?.terminate();
  Object.assign(state, { events: [], results: [], pendingProbes: [], probeClaimed: false, videoId: "", startedAt: "", finishedAt: "" });
  ui.log.textContent = "[]";
  ui.verdict.dataset.status = "idle";
  ui.verdict.textContent = "NOT RUN";
  ui.verdictReason.textContent = "No gate is claimed until a reproducible probe completes.";
  setRunning(false);
  renderMatrix();
});

ui.export.addEventListener("click", () => {
  const report = redactRecord({
    schema: "youFree-gate-a-report-v1",
    videoId: state.videoId,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    origin: location.origin,
    constraints: { browserOnly: true, credentials: "omit", chromeExtension: false, nativeBridge: false, serverMediaRelay: false },
    verdict: evaluateGateA(state.results),
    results: state.results,
    events: state.events
  });
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `youFree-gate-a-${state.videoId || "report"}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});

window.addEventListener("online", () => { ui.network.textContent = "Online · no media relay"; });
window.addEventListener("offline", () => { ui.network.textContent = "Offline"; });

renderClientOptions();
renderMatrix();
setRunning(false);
