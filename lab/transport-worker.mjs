import {
  CLIENT_PROFILES,
  PLAYER_ENDPOINT,
  classifyTransportError,
  redactRecord,
  summarizePlayerPayload
} from "./core.mjs";

let activeController = null;

function emit(type, detail = {}) {
  self.postMessage({ type: "event", event: redactRecord({ at: new Date().toISOString(), type, ...detail }) });
}

function requestBody(videoId, profile) {
  const context = {
    client: profile.client,
    user: { lockedSafetyMode: false },
    request: { useSsl: true, internalExperimentFlags: [], consistencyTokenJars: [] }
  };
  if (profile.thirdParty) context.thirdParty = profile.thirdParty;
  return {
    videoId,
    context,
    playbackContext: {
      contentPlaybackContext: {
        html5Preference: "HTML5_PREF_WANTS",
        lactMilliseconds: "-1"
      }
    },
    contentCheckOk: true,
    racyCheckOk: true
  };
}

async function probePlayerJs(path, signal) {
  if (!path) return { attempted: false, readable: false, classification: "not_available" };
  const target = new URL(path, "https://www.youtube.com");
  const started = performance.now();
  try {
    const response = await fetch(target, {
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      signal
    });
    const text = await response.text();
    return {
      attempted: true,
      readable: response.ok && text.length > 0,
      status: response.status,
      responseType: response.type,
      bytesRead: text.length,
      elapsedMs: Math.round(performance.now() - started)
    };
  } catch (error) {
    return { attempted: true, readable: false, elapsedMs: Math.round(performance.now() - started), ...classifyTransportError(error) };
  }
}

async function runClient(videoId, profile, signal) {
  const started = performance.now();
  emit("player_request_start", {
    clientId: profile.id,
    endpoint: new URL(PLAYER_ENDPOINT).origin + new URL(PLAYER_ENDPOINT).pathname,
    credentials: "omit",
    transport: "browser_worker"
  });
  try {
    const response = await fetch(PLAYER_ENDPOINT, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      body: JSON.stringify(requestBody(videoId, profile)),
      signal
    });
    const responseType = response.type;
    const status = response.status;
    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`Player response was not JSON (HTTP ${status}).`);
    }
    const summary = summarizePlayerPayload(payload, profile);
    let baseJsProbe = { attempted: false, readable: false, classification: "not_required" };
    if (summary.result.needsChallenge && summary.playerJsPath) {
      baseJsProbe = await probePlayerJs(summary.playerJsPath, signal);
    }
    const result = {
      ...summary.result,
      httpStatus: status,
      responseType,
      responseBytes: text.length,
      elapsedMs: Math.round(performance.now() - started),
      baseJsProbe
    };
    emit("player_request_complete", {
      clientId: profile.id,
      httpStatus: status,
      responseType,
      playability: result.playability,
      directCount: result.directCount,
      cipherCount: result.cipherCount,
      elapsedMs: result.elapsedMs
    });
    self.postMessage({ type: "client_result", result: redactRecord(result), ephemeral: summary.ephemeral });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    const failure = {
      clientId: profile.id,
      clientLabel: profile.label,
      clientName: profile.client.clientName,
      apiReadable: false,
      elapsedMs: Math.round(performance.now() - started),
      ...classifyTransportError(error)
    };
    emit("player_request_failed", failure);
    self.postMessage({ type: "client_result", result: redactRecord(failure), ephemeral: null });
  }
}

async function run(data) {
  activeController?.abort();
  activeController = new AbortController();
  const profiles = CLIENT_PROFILES.filter(profile => data.clientIds.includes(profile.id));
  emit("run_start", { videoId: data.videoId, clients: profiles.map(profile => profile.id) });
  for (const profile of profiles) {
    await runClient(data.videoId, profile, activeController.signal);
  }
  emit("run_complete", { videoId: data.videoId, clientCount: profiles.length });
  self.postMessage({ type: "complete" });
}

self.addEventListener("message", event => {
  if (event.data?.type === "cancel") {
    activeController?.abort();
    return;
  }
  if (event.data?.type === "run") {
    run(event.data).catch(error => {
      if (error?.name !== "AbortError") self.postMessage({ type: "fatal", error: classifyTransportError(error) });
    });
  }
});
