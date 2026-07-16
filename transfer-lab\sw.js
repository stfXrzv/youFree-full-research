"use strict";

const MEDIA_CACHE = "vibestream-query-range-v7-media";
const DOWNLOAD_TARGET_CACHE = "vibestream-query-range-v7-download-targets";
let strictOffline = false;

self.addEventListener("install", event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", event => {
  const data = event.data || {};

  if (data.type === "set-strict-offline") {
    strictOffline = Boolean(data.enabled);
    event.ports[0]?.postMessage({ ok: true, strictOffline });
    return;
  }

  if (data.type === "status") {
    event.ports[0]?.postMessage({ ok: true, strictOffline, cache: MEDIA_CACHE });
    return;
  }

  if (data.type === "register-download") {
    event.waitUntil((async () => {
      try {
        const target = new URL(String(data.url || ""));
        if (!/(^|\.)googlevideo\.com$/i.test(target.hostname) || target.pathname !== "/videoplayback") {
          throw new Error("Invalid download target");
        }
        const id = String(data.id || "").replace(/[^A-Za-z0-9_-]/g, "");
        if (!id) throw new Error("Invalid download id");
        const cache = await caches.open(DOWNLOAD_TARGET_CACHE);
        const key = new URL("./__download-target/" + id, self.registration.scope).href;
        await cache.put(key, new Response(target.href, { headers: { "Content-Type": "text/plain" } }));
        event.ports[0]?.postMessage({ ok: true, id });
      } catch (error) {
        event.ports[0]?.postMessage({ ok: false, error: error.message });
      }
    })());
    return;
  }

  if (data.type === "register-media-alias") {
    event.waitUntil((async () => {
      try {
        const target = new URL(String(data.url || ""));
        if (!/(^|\.)googlevideo\.com$/i.test(target.hostname) || target.pathname !== "/videoplayback") {
          throw new Error("Invalid media alias target");
        }
        const id = String(data.id || "").replace(/[^A-Za-z0-9_-]/g, "");
        if (!id) throw new Error("Invalid media alias id");
        const cache = await caches.open(DOWNLOAD_TARGET_CACHE);
        const key = new URL("./__media-alias/" + id, self.registration.scope).href;
        await cache.put(key, new Response(target.href, { headers: { "Content-Type": "text/plain" } }));
        event.ports[0]?.postMessage({ ok: true, id });
      } catch (error) {
        event.ports[0]?.postMessage({ ok: false, error: error.message });
      }
    })());
  }
});

async function broadcast(payload) {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of windows) client.postMessage(payload);
}

function isGoogleVideo(requestUrl) {
  const url = new URL(requestUrl);
  return /(^|\.)googlevideo\.com$/i.test(url.hostname) && url.pathname === "/videoplayback";
}

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  const scopePath = new URL(self.registration.scope).pathname;
  if (requestUrl.origin === self.location.origin && requestUrl.pathname.startsWith(scopePath + "virtual-download/")) {
    event.respondWith((async () => {
      const id = decodeURIComponent(requestUrl.pathname.slice((scopePath + "virtual-download/").length)).replace(/[^A-Za-z0-9_-]/g, "");
      const cache = await caches.open(DOWNLOAD_TARGET_CACHE);
      const key = new URL("./__download-target/" + id, self.registration.scope).href;
      const stored = await cache.match(key);
      if (!stored) return new Response("Download target expired", { status: 404 });
      const target = await stored.text();
      return Response.redirect(target, 302);
    })());
    return;
  }
  if (requestUrl.origin === self.location.origin && requestUrl.pathname.startsWith(scopePath + "virtual-opaque-download/")) {
    event.respondWith((async () => {
      const rawId = requestUrl.pathname.slice((scopePath + "virtual-opaque-download/").length).replace(/\.[A-Za-z0-9]+$/, "");
      const id = decodeURIComponent(rawId).replace(/[^A-Za-z0-9_-]/g, "");
      const cache = await caches.open(DOWNLOAD_TARGET_CACHE);
      const key = new URL("./__download-target/" + id, self.registration.scope).href;
      const stored = await cache.match(key);
      if (!stored) return new Response("Download target expired", { status: 404 });
      const target = await stored.text();
      const response = await fetch(target, {
        method: "GET",
        mode: "no-cors",
        credentials: "omit",
        cache: "no-store",
        redirect: "follow",
        referrerPolicy: "no-referrer"
      });
      await broadcast({
        type: "vbs-opaque-download",
        id,
        responseType: response.type,
        status: response.status,
        requestMode: event.request.mode,
        requestDestination: event.request.destination
      });
      return response;
    })());
    return;
  }
  if (requestUrl.origin === self.location.origin && requestUrl.pathname.startsWith(scopePath + "virtual-media/")) {
    event.respondWith((async () => {
      const id = decodeURIComponent(requestUrl.pathname.slice((scopePath + "virtual-media/").length)).replace(/[^A-Za-z0-9_-]/g, "");
      const aliases = await caches.open(DOWNLOAD_TARGET_CACHE);
      const aliasKey = new URL("./__media-alias/" + id, self.registration.scope).href;
      const stored = await aliases.match(aliasKey);
      if (!stored) return new Response("Media alias expired", { status: 404 });
      const target = await stored.text();
      const media = await caches.open(MEDIA_CACHE);
      const hit = await media.match(target, { ignoreVary: true });
      if (!hit) return new Response("Cached media missing", { status: 404 });
      await broadcast({ type: "vbs-virtual-media", id, source: "opaque-cache-hit", responseType: hit.type });
      return hit;
    })());
    return;
  }
  if (!isGoogleVideo(event.request.url)) return;

  event.respondWith((async () => {
    const cache = await caches.open(MEDIA_CACHE);
    const hit = await cache.match(event.request.url, { ignoreVary: true });
    const url = new URL(event.request.url);
    const detail = {
      type: "vbs-media-request",
      itag: url.searchParams.get("itag") || "",
      rangeQuery: url.searchParams.get("range") || "",
      rangeHeader: event.request.headers.get("range") || "",
      destination: event.request.destination || "",
      strictOffline
    };

    if (hit) {
      await broadcast({ ...detail, source: "cache-hit" });
      return hit;
    }

    if (strictOffline) {
      await broadcast({ ...detail, source: "blocked-network-miss" });
      throw new Error("Strict offline mode blocked a Googlevideo network request");
    }

    let networkRequest = event.request;
    let injectedRange = "";
    if (!detail.rangeQuery && !detail.rangeHeader) {
      const headers = new Headers(event.request.headers);
      headers.set("Range", "bytes=0-1048575");
      networkRequest = new Request(event.request.url, {
        method: "GET",
        mode: "no-cors",
        credentials: "omit",
        cache: "no-store",
        redirect: "follow",
        headers
      });
      injectedRange = "bytes=0-1048575";
    }
    const response = await fetch(networkRequest);
    await broadcast({ ...detail, source: "network", injectedRange, responseType: response.type, status: response.status });
    return response;
  })());
});
