export const PLAYER_ENDPOINT = "https://release-youtubei.sandbox.googleapis.com/youtubei/v1/player";

export const CLIENT_PROFILES = Object.freeze([
  {
    id: "web",
    label: "Web",
    client: {
      clientName: "WEB",
      clientVersion: "2.20260114.08.00",
      hl: "en",
      gl: "GB"
    }
  },
  {
    id: "web_safari",
    label: "Web Safari HLS",
    client: {
      clientName: "WEB",
      clientVersion: "2.20260114.08.00",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.5 Safari/605.1.15,gzip(gfe)",
      hl: "en",
      gl: "GB"
    }
  },
  {
    id: "web_embedded",
    label: "Web embedded",
    client: {
      clientName: "WEB_EMBEDDED_PLAYER",
      clientVersion: "1.20260115.01.00",
      clientScreen: "EMBED",
      hl: "en",
      gl: "GB"
    },
    thirdParty: { embedUrl: "https://www.youtube.com/" }
  },
  {
    id: "android",
    label: "Android",
    client: {
      clientName: "ANDROID",
      clientVersion: "21.02.35",
      androidSdkVersion: 30,
      userAgent: "com.google.android.youtube/21.02.35 (Linux; U; Android 11) gzip",
      osName: "Android",
      osVersion: "11",
      hl: "en",
      gl: "GB"
    }
  },
  {
    id: "android_vr",
    label: "Android VR",
    client: {
      clientName: "ANDROID_VR",
      clientVersion: "1.65.10",
      deviceMake: "Oculus",
      deviceModel: "Quest 3",
      androidSdkVersion: 32,
      userAgent: "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L) gzip",
      osName: "Android",
      osVersion: "12L",
      hl: "en",
      gl: "GB"
    }
  },
  {
    id: "ios_music",
    label: "iOS music route",
    client: {
      clientName: "IOS",
      clientVersion: "21.02.3",
      deviceMake: "Apple",
      deviceModel: "iPhone16,2",
      userAgent: "com.google.ios.youtube/21.02.3 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
      osName: "iPhone",
      osVersion: "18.3.2.22D82",
      hl: "en",
      gl: "GB"
    }
  },
  {
    id: "android_music",
    label: "Android Music",
    client: {
      clientName: "ANDROID_MUSIC",
      clientVersion: "8.10.51",
      androidSdkVersion: 30,
      userAgent: "com.google.android.apps.youtube.music/8.10.51 (Linux; U; Android 11) gzip",
      osName: "Android",
      osVersion: "11",
      hl: "en",
      gl: "GB"
    }
  },
  {
    id: "tv_embedded",
    label: "TV embedded",
    client: {
      clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
      clientVersion: "2.0",
      clientScreen: "EMBED",
      hl: "en",
      gl: "GB"
    },
    thirdParty: { embedUrl: "https://www.youtube.com/" }
  },
  {
    id: "mediaconnect",
    label: "Media Connect",
    client: {
      clientName: "MEDIA_CONNECT_FRONTEND",
      clientVersion: "0.1",
      hl: "en",
      gl: "GB"
    }
  }
]);

const SECRET_KEYS = /cookie|authorization|oauth|token|visitorData|apiKey|signatureCipher|cipher|\burl\b/i;

export function extractVideoId(value) {
  const input = String(value || "").trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(input)) return input;
  try {
    const url = new URL(input);
    if (url.hostname === "youtu.be") return url.pathname.split("/").filter(Boolean)[0] || "";
    const parts = url.pathname.split("/").filter(Boolean);
    if (["shorts", "embed", "live"].includes(parts[0])) return parts[1] || "";
    return url.searchParams.get("v") || "";
  } catch {
    return "";
  }
}

export function safeUrlShape(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return {
      host: url.hostname,
      path: url.pathname,
      client: url.searchParams.get("c") || "",
      hasN: url.searchParams.has("n"),
      hasSig: url.searchParams.has("sig") || url.searchParams.has("lsig"),
      hasRateBypass: url.searchParams.get("ratebypass") === "yes",
      chunked: url.searchParams.get("gir") === "yes",
      hasContentLength: url.searchParams.has("clen"),
      expiresAt: Number(url.searchParams.get("expire") || 0) || null
    };
  } catch {
    return null;
  }
}

export function summarizeFormat(format) {
  const mimeType = String(format?.mimeType || "");
  const cipher = String(format?.signatureCipher || format?.cipher || "");
  let cipherFlags = { hasUrl: false, hasS: false, hasSp: false };
  if (cipher) {
    const params = new URLSearchParams(cipher);
    cipherFlags = {
      hasUrl: params.has("url"),
      hasS: params.has("s"),
      hasSp: params.has("sp")
    };
  }
  return {
    itag: Number(format?.itag || 0),
    mimeType,
    width: Number(format?.width || 0),
    height: Number(format?.height || 0),
    fps: Number(format?.fps || 0),
    qualityLabel: String(format?.qualityLabel || ""),
    audioQuality: String(format?.audioQuality || ""),
    bitrate: Number(format?.bitrate || format?.averageBitrate || 0),
    contentLength: Number(format?.contentLength || 0),
    isVideo: mimeType.startsWith("video/") || Number(format?.height || 0) > 0,
    isAudio: mimeType.startsWith("audio/") || Boolean(format?.audioQuality || format?.audioChannels),
    hasDirectUrl: Boolean(format?.url),
    hasCipher: Boolean(cipher),
    cipherFlags,
    urlShape: format?.url ? safeUrlShape(format.url) : null
  };
}

function pickEphemeral(rawFormats, streaming) {
  const direct = rawFormats.filter(item => item?.url);
  const videos = direct
    .filter(item => String(item.mimeType || "").startsWith("video/") && !item.audioQuality)
    .sort((a, b) => Number(b.height || 0) - Number(a.height || 0));
  const audio = direct
    .filter(item => String(item.mimeType || "").startsWith("audio/") || item.audioQuality)
    .sort((a, b) => Number(b.bitrate || 0) - Number(a.bitrate || 0));
  const progressive = direct
    .filter(item => String(item.mimeType || "").startsWith("video/") && Boolean(item.audioQuality || item.audioChannels))
    .sort((a, b) => Number(b.height || 0) - Number(a.height || 0));
  return {
    videoUrl: videos[0]?.url || "",
    videoItag: Number(videos[0]?.itag || 0),
    videoHeight: Number(videos[0]?.height || 0),
    audioUrl: audio[0]?.url || "",
    audioItag: Number(audio[0]?.itag || 0),
    progressiveUrl: progressive[0]?.url || "",
    progressiveItag: Number(progressive[0]?.itag || 0),
    hlsUrl: String(streaming?.hlsManifestUrl || ""),
    dashUrl: String(streaming?.dashManifestUrl || "")
  };
}

export function summarizePlayerPayload(payload, profile) {
  const streaming = payload?.streamingData || {};
  const rawFormats = [...(streaming.formats || []), ...(streaming.adaptiveFormats || [])];
  const formats = rawFormats.map(summarizeFormat);
  const direct = formats.filter(item => item.hasDirectUrl);
  const ciphered = formats.filter(item => item.hasCipher && !item.hasDirectUrl);
  const videoHeights = direct.filter(item => item.isVideo).map(item => item.height).filter(Boolean);
  const playerJsPath = String(payload?.assets?.js || "");
  return {
    result: {
      clientId: profile.id,
      clientLabel: profile.label,
      clientName: profile.client.clientName,
      apiReadable: true,
      playability: String(payload?.playabilityStatus?.status || "UNKNOWN"),
      reason: String(payload?.playabilityStatus?.reason || ""),
      title: String(payload?.videoDetails?.title || ""),
      durationSeconds: Number(payload?.videoDetails?.lengthSeconds || 0),
      formatCount: formats.length,
      directCount: direct.length,
      cipherCount: ciphered.length,
      maxDirectHeight: videoHeights.length ? Math.max(...videoHeights) : 0,
      has1080: videoHeights.some(height => height >= 1080),
      hasAudio: direct.some(item => item.isAudio),
      hasProgressive: direct.some(item => item.isVideo && item.isAudio),
      hasHls: Boolean(streaming.hlsManifestUrl),
      hasDash: Boolean(streaming.dashManifestUrl),
      hasServerAbr: Boolean(streaming.serverAbrStreamingUrl),
      playerJsAvailable: Boolean(playerJsPath),
      needsChallenge: ciphered.length > 0 || direct.some(item => item.urlShape?.hasN),
      formats
    },
    ephemeral: pickEphemeral(rawFormats, streaming),
    playerJsPath
  };
}

export function classifyTransportError(error) {
  const message = String(error?.message || error || "Unknown error");
  const corsLike = error?.name === "TypeError" || /fetch|network|cors|failed/i.test(message);
  return {
    classification: corsLike ? "cors_blocked_or_network" : "client_error",
    status: "status_unknown",
    message
  };
}

export function redactRecord(value, key = "") {
  if (value === null || value === undefined) return value;
  if (SECRET_KEYS.test(key)) {
    if (typeof value === "string" && /^https?:/i.test(value)) {
      const shape = safeUrlShape(value);
      return shape ? `[redacted-url ${shape.host}${shape.path}]` : "[redacted-url]";
    }
    return "[redacted]";
  }
  if (Array.isArray(value)) return value.map(item => redactRecord(item));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, redactRecord(childValue, childKey)]));
  }
  if (typeof value === "string" && /https?:\/\/[^\s]+(?:sig|lsig|spc|expire)=/i.test(value)) return "[redacted-signed-url]";
  return value;
}

export function evaluateGateA(results) {
  const readable = results.filter(item => item.apiReadable);
  const playable = readable.find(item => item.mediaProbe?.video?.ok || item.mediaProbe?.progressive?.ok);
  if (playable) {
    return { status: "pass", reason: `${playable.clientLabel} returned a direct URL that reached loadedmetadata on this device.` };
  }
  const direct = readable.find(item => item.directCount > 0);
  if (direct) {
    return { status: "candidate", reason: `${direct.clientLabel} returned direct URLs, but browser media usability is not proven yet.` };
  }
  const challenge = readable.find(item => item.cipherCount > 0 && item.baseJsProbe?.readable);
  if (challenge) {
    return { status: "candidate", reason: `${challenge.clientLabel} exposed ciphered formats and readable player JavaScript; challenge solving remains.` };
  }
  return { status: "fail", reason: readable.length ? "Player responses were readable but yielded no usable direct or solvable route." : "No Player API response was readable from this browser origin." };
}
