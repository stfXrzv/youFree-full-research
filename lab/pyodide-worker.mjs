import { loadPyodide } from "https://cdn.jsdelivr.net/pyodide/v314.0.2/full/pyodide.mjs";

const ready = loadPyodide({
  indexURL: "https://cdn.jsdelivr.net/pyodide/v314.0.2/full/",
});
let ytDlpReady;

async function ensureYtDlp(pyodide) {
  if (!ytDlpReady) {
    ytDlpReady = (async () => {
      await pyodide.loadPackage("micropip");
      await pyodide.runPythonAsync(`
import micropip
await micropip.install("yt-dlp==2026.7.4", deps=False)
      `);
      const handlerSource = await (await fetch("./pyodide_xhr_handler.py", {
        cache: "no-store",
      })).text();
      await pyodide.runPythonAsync(handlerSource);
    })();
  }
  return ytDlpReady;
}

self.addEventListener("message", async (event) => {
  const id = event.data?.id;
  try {
    const pyodide = await ready;
    let result;
    if (event.data?.type === "inspect") {
      result = await pyodide.runPythonAsync(`
import inspect
import json
import sys
from pyodide.http import pyxhr

def safe_signature(value):
    try:
        return str(inspect.signature(value))
    except Exception:
        return "unavailable"

json.dumps({
    "python": sys.version.split()[0],
    "pyxhr_type": type(pyxhr).__name__,
    "members": [name for name in dir(pyxhr) if not name.startswith("_")],
    "get_signature": safe_signature(getattr(pyxhr, "get", None)),
    "post_signature": safe_signature(getattr(pyxhr, "post", None)),
    "request_signature": safe_signature(getattr(pyxhr, "request", None)),
    "request_params": {
        name: str(annotation)
        for name, annotation in getattr(pyxhr.XHRRequestParams, "__annotations__", {}).items()
    },
    "response_members": [
        name for name in dir(pyxhr.XHRResponse) if not name.startswith("_")
    ],
    "post_source": inspect.getsource(pyxhr.post),
})
      `);
    } else if (event.data?.type === "player") {
      pyodide.globals.set("probe_video_id", String(event.data.videoId || ""));
      result = await pyodide.runPythonAsync(`
import json
from pyodide.http import pyxhr

body = {
    "videoId": probe_video_id,
    "context": {
        "client": {
            "clientName": "IOS",
            "clientVersion": "21.02.3",
            "deviceMake": "Apple",
            "deviceModel": "iPhone16,2",
            "userAgent": "com.google.ios.youtube/21.02.3 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
            "osName": "iPhone",
            "osVersion": "18.3.2.22D82",
            "hl": "en",
            "gl": "GB",
        },
        "user": {"lockedSafetyMode": False},
        "request": {"useSsl": True, "internalExperimentFlags": [], "consistencyTokenJars": []},
    },
    "playbackContext": {"contentPlaybackContext": {"html5Preference": "HTML5_PREF_WANTS", "lactMilliseconds": "-1"}},
    "contentCheckOk": True,
    "racyCheckOk": True,
}
response = pyxhr.post(
    "https://release-youtubei.sandbox.googleapis.com/youtubei/v1/player",
    headers={"Content-Type": "application/json"},
    json=body,
)
payload = response.json()
streaming = payload.get("streamingData") or {}
formats = [*(streaming.get("formats") or []), *(streaming.get("adaptiveFormats") or [])]
direct = [item for item in formats if item.get("url")]
heights = [int(item.get("height") or 0) for item in direct if item.get("height")]
json.dumps({
    "transport": "pyxhr",
    "status": response.status_code,
    "playability": (payload.get("playabilityStatus") or {}).get("status", "UNKNOWN"),
    "formatCount": len(formats),
    "directCount": len(direct),
    "maxHeight": max(heights) if heights else 0,
    "hasAudio": any(str(item.get("mimeType") or "").startswith("audio/") for item in direct),
})
      `);
    } else if (event.data?.type === "yt_dlp_import") {
      await ensureYtDlp(pyodide);
      result = await pyodide.runPythonAsync(`
import json
import yt_dlp
from yt_dlp.networking.common import RequestHandler, Response

json.dumps({
    "version": yt_dlp.version.__version__,
    "requestHandlerAvailable": RequestHandler is not None,
    "responseAdapterAvailable": Response is not None,
})
      `);
    } else if (event.data?.type === "yt_dlp_extract") {
      await ensureYtDlp(pyodide);
      pyodide.globals.set("probe_video_id", String(event.data.videoId || ""));
      result = await pyodide.runPythonAsync(`
import json
json.dumps(extract_youtube(probe_video_id))
      `);
    } else {
      throw new Error("Unsupported Pyodide probe request.");
    }
    self.postMessage({ id, ok: true, result: JSON.parse(result) });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});
