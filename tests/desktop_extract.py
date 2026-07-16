import json
import sys

from yt_dlp import YoutubeDL


video_id = sys.argv[1] if len(sys.argv) > 1 else "A9-t86OAtM0"
options = {
    "quiet": True,
    "no_warnings": True,
    "skip_download": True,
    "noplaylist": True,
    "extractor_args": {
        "youtube": {
            "player_client": ["ios"],
            "player_skip": ["webpage", "configs", "js", "initial_data"],
            "webpage_skip": ["initial_data"],
            "formats": ["missing_pot"],
        }
    },
}

with YoutubeDL(options) as ydl:
    info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)

formats = [item for item in info.get("formats", []) if item.get("url")]
result = {
    "ok": True,
    "id": info.get("id"),
    "title": info.get("title"),
    "duration": info.get("duration"),
    "formatCount": len(formats),
    "directCount": len(formats),
    "maxHeight": max((int(item.get("height") or 0) for item in formats), default=0),
    "hasAudio": any(item.get("acodec") not in (None, "none") for item in formats),
    "itags": sorted(str(item.get("format_id") or "") for item in formats),
}
print(json.dumps(result, ensure_ascii=True))
