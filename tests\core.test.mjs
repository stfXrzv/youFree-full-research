import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateGateA,
  extractVideoId,
  redactRecord,
  safeUrlShape,
  summarizeFormat
} from "../lab/core.mjs";

test("extractVideoId supports watch, short, and bare IDs", () => {
  assert.equal(extractVideoId("A9-t86OAtM0"), "A9-t86OAtM0");
  assert.equal(extractVideoId("https://www.youtube.com/watch?v=A9-t86OAtM0&list=RD"), "A9-t86OAtM0");
  assert.equal(extractVideoId("https://youtu.be/A9-t86OAtM0"), "A9-t86OAtM0");
  assert.equal(extractVideoId("https://www.youtube.com/shorts/A9-t86OAtM0"), "A9-t86OAtM0");
});

test("safeUrlShape exposes flags without leaking signatures", () => {
  const shape = safeUrlShape("https://r1.googlevideo.com/videoplayback?expire=123&sig=secret&n=value&gir=yes&clen=99");
  assert.deepEqual(shape, {
    host: "r1.googlevideo.com",
    path: "/videoplayback",
    client: "",
    hasN: true,
    hasSig: true,
    hasRateBypass: false,
    chunked: true,
    hasContentLength: true,
    expiresAt: 123
  });
  assert.equal(JSON.stringify(shape).includes("secret"), false);
});

test("summarizeFormat records cipher flags without cipher values", () => {
  const summary = summarizeFormat({
    itag: 137,
    mimeType: 'video/mp4; codecs="avc1"',
    height: 1080,
    signatureCipher: "url=https%3A%2F%2Fr1.googlevideo.com%2Fvideoplayback&s=secret&sp=sig"
  });
  assert.equal(summary.hasCipher, true);
  assert.deepEqual(summary.cipherFlags, { hasUrl: true, hasS: true, hasSp: true });
  assert.equal(JSON.stringify(summary).includes("secret"), false);
});

test("redactRecord removes URL and credential fields recursively", () => {
  const redacted = redactRecord({
    url: "https://r1.googlevideo.com/videoplayback?sig=secret",
    nested: { visitorData: "private", cookie: "private" },
    status: "OK"
  });
  const text = JSON.stringify(redacted);
  assert.equal(text.includes("secret"), false);
  assert.equal(text.includes("private"), false);
  assert.equal(redacted.status, "OK");
});

test("Gate A only passes after a direct media metadata probe succeeds", () => {
  assert.equal(evaluateGateA([{ apiReadable: true, clientLabel: "VR", directCount: 4 }]).status, "candidate");
  assert.equal(evaluateGateA([{
    apiReadable: true,
    clientLabel: "VR",
    directCount: 4,
    mediaProbe: { video: { ok: true } }
  }]).status, "pass");
  assert.equal(evaluateGateA([{ apiReadable: false }]).status, "fail");
});
