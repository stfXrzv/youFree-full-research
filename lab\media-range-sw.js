const CHUNK_BYTES = 2 * 1024 * 1024;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  let url;
  try {
    url = new URL(event.request.url);
  } catch {
    return;
  }

  if (!url.hostname.endsWith(".googlevideo.com")) return;
  if (!["video", "audio"].includes(event.request.destination)) return;

  const range = event.request.headers.get("range") || "";
  const openRange = /^bytes=(\d+)-$/i.exec(range);
  if (!openRange) return;

  const start = Number(openRange[1]);
  if (!Number.isSafeInteger(start) || start < 0) return;
  const end = start + CHUNK_BYTES - 1;

  event.respondWith((async () => {
    const headers = new Headers();
    headers.set("Range", `bytes=${start}-${end}`);
    const request = new Request(event.request.url, {
      method: "GET",
      headers,
      mode: "no-cors",
      credentials: "omit",
      cache: "no-store",
      redirect: "follow",
      referrer: event.request.referrer || "about:client",
    });
    return fetch(request);
  })());
});
