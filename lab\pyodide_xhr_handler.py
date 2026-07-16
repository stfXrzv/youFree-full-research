import io
import json
import re
import urllib.parse

from pyodide.http import pyxhr
from yt_dlp import YoutubeDL
from yt_dlp.extractor.youtube import YoutubeIE
from yt_dlp.networking.common import (
    RequestHandler,
    Response,
    _REQUEST_HANDLERS,
    register_preference,
    register_rh,
)
from yt_dlp.networking.exceptions import HTTPError, TransportError


TRACE = []
FORBIDDEN_REQUEST_HEADERS = {
    "accept-encoding",
    "connection",
    "content-length",
    "cookie",
    "host",
    "origin",
    "referer",
    "user-agent",
    "x-youtube-client-name",
    "x-youtube-client-version",
}


def _safe_error(error):
    message = f"{type(error).__name__}: {error}"
    return re.sub(r"https?://\S+", "[url]", message)[:1000]


def _request_shape(url):
    parsed = urllib.parse.urlsplit(url)
    return {
        "host": parsed.hostname or "",
        "path": parsed.path,
        "queryKeys": sorted(urllib.parse.parse_qs(parsed.query).keys()),
    }


def _browser_endpoint(url):
    parsed = urllib.parse.urlsplit(url)
    if parsed.path.startswith("/youtubei/v1/"):
        return urllib.parse.urlunsplit((
            "https",
            "release-youtubei.sandbox.googleapis.com",
            parsed.path,
            parsed.query,
            "",
        ))
    return url


def _request_data(data):
    if data is None or isinstance(data, bytes):
        return data
    if hasattr(data, "read"):
        return data.read()
    return b"".join(data)


class PyodideXHRRH(RequestHandler):
    RH_NAME = "pyodide_xhr"
    _SUPPORTED_URL_SCHEMES = ("http", "https")
    _SUPPORTED_PROXY_SCHEMES = ()
    _SUPPORTED_FEATURES = ()

    def _check_extensions(self, extensions):
        super()._check_extensions(extensions)
        extensions.pop("cookiejar", None)
        extensions.pop("timeout", None)
        extensions.pop("legacy_ssl", None)
        extensions.pop("keep_header_casing", None)

    def _send(self, request):
        target = _browser_endpoint(request.url)
        headers = {
            name: value
            for name, value in self._get_headers(request).items()
            if name.lower() not in FORBIDDEN_REQUEST_HEADERS
            and not name.lower().startswith("sec-")
        }
        method = request.method.lower()
        sender = getattr(pyxhr, method, None)
        if sender is None:
            raise TransportError(cause=ValueError(f"Unsupported XHR method: {method}"))

        kwargs = {"headers": headers}
        data = _request_data(request.data)
        json_payload = None
        if _request_shape(request.url)["path"] == "/youtubei/v1/player" and data:
            try:
                normalized = json.loads(data)
                context = normalized.setdefault("context", {})
                context.setdefault("user", {"lockedSafetyMode": False})
                context.setdefault("request", {
                    "useSsl": True,
                    "internalExperimentFlags": [],
                    "consistencyTokenJars": [],
                })
                playback = normalized.setdefault("playbackContext", {}).setdefault(
                    "contentPlaybackContext", {})
                playback.setdefault("lactMilliseconds", "-1")
                json_payload = normalized
                data = None
                headers.pop("X-YouTube-Client-Name", None)
                headers.pop("X-YouTube-Client-Version", None)
            except Exception:
                pass
        if json_payload is not None:
            kwargs["json"] = json_payload
        elif data is not None:
            kwargs["data"] = data

        trace = {
            "method": request.method,
            "original": _request_shape(request.url),
            "target": _request_shape(target),
            "headerNames": sorted(name.lower() for name in headers),
        }
        body_for_trace = json_payload if json_payload is not None else data
        if trace["original"]["path"] == "/youtubei/v1/player" and body_for_trace:
            try:
                body = body_for_trace if isinstance(body_for_trace, dict) else json.loads(body_for_trace)
                client = ((body.get("context") or {}).get("client") or {})
                playback = ((body.get("playbackContext") or {}).get("contentPlaybackContext") or {})
                trace["bodyShape"] = {
                    "topKeys": sorted(body.keys()),
                    "clientName": client.get("clientName") or "",
                    "clientVersion": client.get("clientVersion") or "",
                    "clientKeys": sorted(client.keys()),
                    "playbackKeys": sorted(playback.keys()),
                    "hasVisitorData": bool(client.get("visitorData")),
                    "hasPoToken": "poToken" in body,
                }
            except Exception:
                trace["bodyShape"] = {"parse": "failed"}
        try:
            xhr_response = sender(target, **kwargs)
        except Exception as error:
            trace.update({"result": "network_error", "error": _safe_error(error)})
            TRACE.append(trace)
            raise TransportError(cause=error) from error

        trace.update({"result": "response", "status": int(xhr_response.status_code)})
        TRACE.append(trace)
        response = Response(
            io.BytesIO(bytes(xhr_response.content)),
            str(xhr_response.url),
            dict(xhr_response.headers),
            status=int(xhr_response.status_code),
        )
        if not 200 <= response.status < 300:
            raise HTTPError(response)
        return response


if "PyodideXHR" not in _REQUEST_HANDLERS:
    register_rh(PyodideXHRRH)

    @register_preference(PyodideXHRRH)
    def _prefer_pyodide_xhr(handler, request):
        return 10_000


def extract_youtube(video_id):
    TRACE.clear()
    url = f"https://www.youtube.com/watch?v={video_id}"
    options = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noplaylist": True,
        "cachedir": False,
        "extractor_args": {
            "youtube": {
                "player_client": ["ios"],
                "player_skip": ["webpage", "configs", "js", "initial_data"],
                "webpage_skip": ["initial_data"],
                "formats": ["missing_pot"],
            },
        },
    }
    try:
        with YoutubeDL(options) as ydl:
            inspector = YoutubeIE(ydl)
            TRACE.append({
                "configuration": {
                    "player_client": inspector._configuration_arg("player_client"),
                    "player_skip": inspector._configuration_arg("player_skip"),
                    "webpage_skip": inspector._configuration_arg("webpage_skip"),
                },
            })
            info = ydl.extract_info(url, download=False)
        formats = info.get("formats") or []
        direct = [item for item in formats if item.get("url")]
        heights = [int(item.get("height") or 0) for item in direct if item.get("height")]
        return {
            "ok": True,
            "id": info.get("id") or "",
            "title": info.get("title") or "",
            "duration": info.get("duration") or 0,
            "formatCount": len(formats),
            "directCount": len(direct),
            "maxHeight": max(heights) if heights else 0,
            "hasAudio": any(item.get("acodec") not in (None, "none") for item in direct),
            "itags": sorted({str(item.get("format_id") or "") for item in direct}),
            "trace": list(TRACE),
        }
    except Exception as error:
        return {
            "ok": False,
            "error": _safe_error(error),
            "trace": list(TRACE),
        }
