function u32(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, false);
}

function setU32(bytes, offset, value) {
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    .setUint32(offset, Number(value) >>> 0, false);
}

function u64(bytes, offset) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(offset, false) * 4294967296 + view.getUint32(offset + 4, false);
}

function setU64(bytes, offset, value) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const safe = Number(value);
  view.setUint32(offset, Math.floor(safe / 4294967296) >>> 0, false);
  view.setUint32(offset + 4, safe >>> 0, false);
}

function typeAt(bytes, offset) {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

function ascii(value) {
  return new Uint8Array([...value].map(char => char.charCodeAt(0)));
}

function uint32Bytes(value) {
  const result = new Uint8Array(4);
  setU32(result, 0, value);
  return result;
}

function concatBytes(parts) {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function makeBox(type, payload) {
  return concatBytes([uint32Bytes(8 + payload.byteLength), ascii(type), payload]);
}

function collectAllBoxes(bytes) {
  const boxes = [];
  let position = 0;
  while (position < bytes.byteLength - 8) {
    let size = u32(bytes, position);
    const type = typeAt(bytes, position + 4);
    if (size === 1) size = u64(bytes, position + 8);
    else if (size === 0) size = bytes.byteLength - position;
    if (size < 8 || position + size > bytes.byteLength) break;
    boxes.push({ type, pos: position, size });
    position += size;
  }
  return boxes;
}

function findBox(bytes, type, from, to) {
  let position = from;
  while (position < to - 8) {
    const size = u32(bytes, position);
    const foundType = typeAt(bytes, position + 4);
    if (size < 8 || position + size > to + 1) break;
    if (foundType === type) return { pos: position, size };
    position += size;
  }
  return null;
}

function findDeep(bytes, type, from, to) {
  const containers = new Set(["moov", "trak", "mdia", "minf", "stbl", "udta", "meta", "dinf"]);
  let position = from;
  while (position < to - 8) {
    const size = u32(bytes, position);
    const foundType = typeAt(bytes, position + 4);
    if (size < 8 || position + size > to + 16) break;
    if (foundType === type) return { pos: position, size };
    if (containers.has(foundType)) {
      const result = findDeep(bytes, type, position + 8, position + size);
      if (result) return result;
    }
    position += size;
  }
  return null;
}

function adjustStco(trakInput, delta) {
  const trak = trakInput.slice();
  for (const [type, width] of [["stco", 4], ["co64", 8]]) {
    const box = findDeep(trak, type, 8, trak.byteLength);
    if (!box) continue;
    const count = u32(trak, box.pos + 12);
    for (let index = 0; index < count; index += 1) {
      const offset = box.pos + 16 + index * width;
      if (width === 4) setU32(trak, offset, u32(trak, offset) + delta);
      else setU64(trak, offset, u64(trak, offset) + delta);
    }
    break;
  }
  return trak;
}

function remapTrakId(trakInput, oldId, newId) {
  const trak = trakInput.slice();
  const box = findBox(trak, "tkhd", 8, trak.byteLength);
  if (!box) return trak;
  const version = trak[box.pos + 8];
  const offset = box.pos + 8 + 4 + (version === 1 ? 16 : 8);
  if (u32(trak, offset) === oldId) setU32(trak, offset, newId);
  return trak;
}

function remapMoofId(moofInput, oldId, newId) {
  const moof = moofInput.slice();
  const traf = findBox(moof, "traf", 8, moof.byteLength);
  if (!traf) return moof;
  const tfhd = findBox(moof, "tfhd", traf.pos + 8, traf.pos + traf.size);
  if (!tfhd) return moof;
  const offset = tfhd.pos + 12;
  if (u32(moof, offset) === oldId) setU32(moof, offset, newId);
  return moof;
}

function topBoxMap(bytes) {
  const map = {};
  for (const box of collectAllBoxes(bytes)) map[box.type] = box;
  return map;
}

function trex(trackId) {
  const payload = new Uint8Array(24);
  setU32(payload, 4, trackId);
  setU32(payload, 8, 1);
  return makeBox("trex", payload);
}

function muxFmp4Bytes(video, audio) {
  const videoBoxes = collectAllBoxes(video);
  const audioBoxes = collectAllBoxes(audio);
  const videoFtyp = videoBoxes.find(box => box.type === "ftyp");
  const videoMoov = videoBoxes.find(box => box.type === "moov");
  const audioMoov = audioBoxes.find(box => box.type === "moov");
  if (!videoMoov) throw new Error("Video missing moov box.");
  if (!audioMoov) throw new Error("Audio missing moov box.");

  const videoMoovData = video.slice(videoMoov.pos, videoMoov.pos + videoMoov.size);
  const audioMoovData = audio.slice(audioMoov.pos, audioMoov.pos + audioMoov.size);
  const videoContent = videoMoovData.slice(8);
  const videoMvhdMeta = findBox(videoContent, "mvhd", 0, videoContent.byteLength);
  const videoTrakMeta = findBox(videoContent, "trak", 0, videoContent.byteLength);
  const videoMvexMeta = findBox(videoContent, "mvex", 0, videoContent.byteLength);
  if (!videoMvhdMeta || !videoTrakMeta) throw new Error("Video moov missing mvhd or trak.");

  const videoMvhd = videoContent.slice(videoMvhdMeta.pos, videoMvhdMeta.pos + videoMvhdMeta.size);
  const videoTrak = videoContent.slice(videoTrakMeta.pos, videoTrakMeta.pos + videoTrakMeta.size);
  const audioTrakMeta = findBox(audioMoovData, "trak", 8, audioMoovData.byteLength);
  if (!audioTrakMeta) throw new Error("Audio missing trak box.");
  const audioTrak = remapTrakId(
    audioMoovData.slice(audioTrakMeta.pos, audioTrakMeta.pos + audioTrakMeta.size),
    1,
    2,
  );

  let videoTrex = trex(1);
  if (videoMvexMeta) {
    const videoMvex = videoContent.slice(videoMvexMeta.pos, videoMvexMeta.pos + videoMvexMeta.size);
    const inner = findBox(videoMvex, "trex", 8, videoMvex.byteLength);
    if (inner) videoTrex = videoMvex.slice(inner.pos, inner.pos + inner.size);
  }
  const newMvex = makeBox("mvex", concatBytes([videoTrex, trex(2)]));
  const newMoov = makeBox("moov", concatBytes([videoMvhd, videoTrak, audioTrak, newMvex]));
  const output = [];
  if (videoFtyp) output.push(video.slice(videoFtyp.pos, videoFtyp.pos + videoFtyp.size));
  output.push(newMoov);

  for (let index = 0; index < videoBoxes.length; index += 1) {
    if (videoBoxes[index].type !== "moof") continue;
    output.push(video.slice(videoBoxes[index].pos, videoBoxes[index].pos + videoBoxes[index].size));
    if (videoBoxes[index + 1]?.type === "mdat") {
      output.push(video.slice(videoBoxes[index + 1].pos, videoBoxes[index + 1].pos + videoBoxes[index + 1].size));
    }
  }
  for (let index = 0; index < audioBoxes.length; index += 1) {
    if (audioBoxes[index].type !== "moof") continue;
    output.push(remapMoofId(
      audio.slice(audioBoxes[index].pos, audioBoxes[index].pos + audioBoxes[index].size),
      1,
      2,
    ));
    if (audioBoxes[index + 1]?.type === "mdat") {
      output.push(audio.slice(audioBoxes[index + 1].pos, audioBoxes[index + 1].pos + audioBoxes[index + 1].size));
    }
  }
  return concatBytes(output);
}

function muxMp4Bytes(video, audio) {
  const videoBoxes = topBoxMap(video);
  const audioBoxes = topBoxMap(audio);
  for (const key of ["moov", "mdat"]) {
    if (!videoBoxes[key]) throw new Error(`Video missing ${key} box.`);
    if (!audioBoxes[key]) throw new Error(`Audio missing ${key} box.`);
  }
  const videoMoov = video.slice(videoBoxes.moov.pos, videoBoxes.moov.pos + videoBoxes.moov.size);
  const audioMoov = audio.slice(audioBoxes.moov.pos, audioBoxes.moov.pos + audioBoxes.moov.size);
  const videoTrakMeta = findBox(videoMoov, "trak", 8, videoMoov.byteLength);
  const audioTrakMeta = findBox(audioMoov, "trak", 8, audioMoov.byteLength);
  if (!videoTrakMeta || !audioTrakMeta) throw new Error("Cannot locate trak boxes.");

  let videoTrak = videoMoov.slice(videoTrakMeta.pos, videoTrakMeta.pos + videoTrakMeta.size);
  let audioTrak = audioMoov.slice(audioTrakMeta.pos, audioTrakMeta.pos + audioTrakMeta.size);
  const ftypSize = videoBoxes.ftyp ? videoBoxes.ftyp.size : 0;
  const newMoovSize = videoBoxes.moov.size + audioTrakMeta.size;
  videoTrak = adjustStco(videoTrak, ftypSize + newMoovSize - videoBoxes.mdat.pos);
  audioTrak = adjustStco(audioTrak, ftypSize + newMoovSize + videoBoxes.mdat.size - audioBoxes.mdat.pos);

  const patchedMoov = concatBytes([
    videoMoov.slice(0, videoTrakMeta.pos),
    videoTrak,
    videoMoov.slice(videoTrakMeta.pos + videoTrakMeta.size),
  ]);
  const newMoov = concatBytes([
    uint32Bytes(newMoovSize),
    ascii("moov"),
    patchedMoov.slice(8),
    audioTrak,
  ]);
  const parts = [];
  if (ftypSize) parts.push(video.slice(videoBoxes.ftyp.pos, videoBoxes.ftyp.pos + ftypSize));
  parts.push(newMoov);
  parts.push(video.slice(videoBoxes.mdat.pos, videoBoxes.mdat.pos + videoBoxes.mdat.size));
  parts.push(audio.slice(audioBoxes.mdat.pos, audioBoxes.mdat.pos + audioBoxes.mdat.size));
  return concatBytes(parts);
}

export async function ytmuxMuxAuto(videoBlob, audioBlob) {
  if (!(videoBlob instanceof Blob) || !(audioBlob instanceof Blob)) {
    throw new TypeError("ytmuxMuxAuto expects video and audio Blob inputs");
  }
  const [videoBuffer, audioBuffer] = await Promise.all([
    videoBlob.arrayBuffer(),
    audioBlob.arrayBuffer(),
  ]);
  const video = new Uint8Array(videoBuffer);
  const audio = new Uint8Array(audioBuffer);
  const fragmented = collectAllBoxes(video).some(box => box.type === "moof")
    || collectAllBoxes(audio).some(box => box.type === "moof");
  const output = fragmented ? muxFmp4Bytes(video, audio) : muxMp4Bytes(video, audio);
  return new Blob([output], { type: "video/mp4" });
}
