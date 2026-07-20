import { TelegramClient, Api } from "telegram";
import type { DownloadMediaInterface, IterDownloadFunction } from "telegram/client/downloads";
import type { ChunkManifest, DriveFile, DriveConfig } from "../types";
import { buildManifest, parseManifest } from "./manifest";
import bigInt from "big-integer";
import { CHUNK_SIZE } from "../config/telegram";
import { getHelperClient } from "./client";
import { getCachedChunk, setCachedChunk } from "./cache";

// Module-level cache for message objects to avoid redundant Telegram API round-trips (bounded to max 200 entries)
const g = (typeof window !== "undefined" ? window : {}) as any;
const MAX_MESSAGE_CACHE_SIZE = 200;
const messageCache: Map<number, Api.Message> = g.__messageCache || (g.__messageCache = new Map<number, Api.Message>());

function setCachedMessage(msgId: number, message: Api.Message): void {
  if (messageCache.has(msgId)) {
    messageCache.delete(msgId);
  } else if (messageCache.size >= MAX_MESSAGE_CACHE_SIZE) {
    const oldestKey = messageCache.keys().next().value;
    if (oldestKey !== undefined) {
      messageCache.delete(oldestKey);
    }
  }
  messageCache.set(msgId, message);
}

function getErrorMessage(err: unknown) {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err && "message" in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Unknown error";
}

function getFloodWaitSeconds(err: unknown) {
  if (typeof err !== "object" || !err || !("errorMessage" in err)) return null;
  const errorMessage = (err as { errorMessage?: unknown }).errorMessage;
  if (typeof errorMessage !== "string" || !errorMessage.startsWith("FLOOD_WAIT_")) return null;
  return parseInt(errorMessage.split("_").pop() || "", 10) || 30;
}

function getMessageDocumentInfo(message: Api.Message | undefined): {
  mimeType?: string;
  fileName?: string;
} {
  const media = message?.media;
  if (!media || media.className !== "MessageMediaDocument") return {};
  const document = (media as Api.MessageMediaDocument).document;
  if (!document || document.className !== "Document") return {};
  const doc = document as Api.Document;
  const fileNameAttr = doc.attributes?.find(
    (attr) => attr.className === "DocumentAttributeFilename"
  ) as Api.DocumentAttributeFilename | undefined;
  return {
    mimeType: doc.mimeType,
    fileName: fileNameAttr?.fileName,
  };
}

async function downloadMediaWithWorkers(
  client: TelegramClient,
  message: Api.Message,
  options: {
    workers?: number;
    partSizeKb?: number;
    progressCallback?: (dl: bigInt.BigInteger, total: bigInt.BigInteger) => void;
  } = {}
): Promise<Buffer> {
  const media = message.media;
  if (!media) {
    throw new Error("No media found in message");
  }

  const msgData: [any, number] | undefined = message.inputChat
    ? [message.inputChat, message.id]
    : undefined;

  if (media.className === "MessageMediaDocument" && (media as Api.MessageMediaDocument).document) {
    const doc = (media as Api.MessageMediaDocument).document as Api.Document;
    const inputLocation = new Api.InputDocumentFileLocation({
      id: doc.id,
      accessHash: doc.accessHash,
      fileReference: doc.fileReference,
      thumbSize: "",
    });

    const buffer = await client.downloadFile(inputLocation, {
      dcId: doc.dcId,
      fileSize: doc.size,
      partSizeKb: options.partSizeKb || 512,
      progressCallback: options.progressCallback,
      msgData,
    });
    return buffer as unknown as Buffer;
  }

  if (media.className === "MessageMediaPhoto" && (media as Api.MessageMediaPhoto).photo) {
    const photo = (media as Api.MessageMediaPhoto).photo as Api.Photo;
    const sizes = photo.sizes || [];
    const size = sizes.find((s) => s.className !== "PhotoSizeEmpty");
    const inputLocation = new Api.InputPhotoFileLocation({
      id: photo.id,
      accessHash: photo.accessHash,
      fileReference: photo.fileReference,
      thumbSize: size ? (size as any).type || "" : "",
    });

    let fileSize = 512;
    if (size) {
      if (size.className === "PhotoSizeProgressive") {
        fileSize = Math.max(...(size as any).sizes);
      } else {
        fileSize = (size as any).size || 512;
      }
    }

    const buffer = await client.downloadFile(inputLocation, {
      dcId: photo.dcId,
      fileSize: bigInt(fileSize),
      partSizeKb: options.partSizeKb || 512,
      progressCallback: options.progressCallback,
      msgData,
    });
    return buffer as unknown as Buffer;
  }

  // Fallback to client.downloadMedia
  const buffer = await client.downloadMedia(message, {
    progressCallback: options.progressCallback
      ? (dl, total) => options.progressCallback!(dl, total)
      : undefined,
  });
  if (!buffer) {
    throw new Error("Download failed");
  }
  return buffer as unknown as Buffer;
}


export function mimeTypeFromName(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext || "")) {
    if (ext === "jpg") return "image/jpeg";
    if (ext === "svg") return "image/svg+xml";
    return `image/${ext}`;
  }
  if (["mp4", "webm", "ogg", "mov"].includes(ext || "")) {
    return ext === "mov" ? "video/quicktime" : `video/${ext}`;
  }
  if (["mp3", "wav", "m4a", "flac", "ogg"].includes(ext || "")) {
    return `audio/${ext === "mp3" ? "mpeg" : ext}`;
  }
  const map: Record<string, string> = {
    pdf: "application/pdf",
    txt: "text/plain; charset=utf-8",
    md: "text/markdown; charset=utf-8",
    json: "application/json; charset=utf-8",
    js: "text/javascript; charset=utf-8",
    ts: "text/typescript; charset=utf-8",
    py: "text/x-python; charset=utf-8",
    rs: "text/plain; charset=utf-8",
    go: "text/plain; charset=utf-8",
    html: "text/html; charset=utf-8",
    css: "text/css; charset=utf-8",
    xml: "application/xml; charset=utf-8",
    csv: "text/csv; charset=utf-8",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xls: "application/vnd.ms-excel",
  };
  if (ext && map[ext]) return map[ext];
  return "application/octet-stream";
}

function hasExtension(fileName: string): boolean {
  const last = fileName.split(/[\\/]/).pop() ?? fileName;
  return /\.[^.\s]{1,12}$/.test(last);
}

function extensionFromName(fileName?: string): string {
  if (!fileName) return "";
  const withoutChunkSuffix = fileName.replace(/\.part\d+$/i, "");
  if (!hasExtension(withoutChunkSuffix)) return "";
  return withoutChunkSuffix.slice(withoutChunkSuffix.lastIndexOf("."));
}

function baseNameWithoutExtension(fileName: string): string {
  const withoutChunkSuffix = fileName.replace(/\.part\d+$/i, "");
  if (!hasExtension(withoutChunkSuffix)) return withoutChunkSuffix;
  return withoutChunkSuffix.slice(0, withoutChunkSuffix.lastIndexOf("."));
}

export function normalizeRenamedFileName(file: DriveFile, name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";

  // If user provided a name with an explicit extension, keep it
  if (hasExtension(trimmed)) {
    return trimmed;
  }

  // Otherwise fallback to original file's extension if available
  const originalExt =
    extensionFromName(file.name) ||
    extensionFromName(file.manifest.fileName) ||
    extensionFromName(file.chunkFileName);

  return originalExt ? `${trimmed}${originalExt}` : trimmed;
}


/**
 * Pre-fetch all chunk messages for a file to warm the message cache.
 * Avoids latency spikes during video seek requests.
 */
export async function preFetchMessages(
  client: TelegramClient,
  config: DriveConfig,
  manifest: ChunkManifest
): Promise<void> {
  const peer = new Api.InputPeerChannel({
    channelId: bigInt(config.chatId),
    accessHash: bigInt(config.accessHash),
  });
  const missingIds = manifest.chunks.filter((id) => !messageCache.has(id));
  if (missingIds.length > 0) {
    try {
      const batchSize = 100;
      for (let i = 0; i < missingIds.length; i += batchSize) {
        const messages = await client.getMessages(peer, { ids: missingIds.slice(i, i + batchSize) });
        for (const msg of messages) {
          if (msg && msg.className === "Message") {
            setCachedMessage(msg.id, msg as Api.Message);
          }
        }
      }
    } catch (err) {
      console.warn("Pre-fetch failed:", err);
    }
  }
}

/**
 * Memory cache for active preview chunks: fileId -> Map<chunkIndex, Uint8Array>
 */
const g2 = (typeof window !== "undefined" ? window : {}) as any;
export const previewChunkCache: Map<string, Map<number, Uint8Array>> = g2.__previewChunkCache || (g2.__previewChunkCache = new Map<string, Map<number, Uint8Array>>());

const activePrefetchJobs = new Set<string>();

async function triggerBackgroundPrefetch(
  client: TelegramClient,
  config: DriveConfig,
  fileId: string,
  manifest: ChunkManifest,
  chunkIndex: number
) {
  const jobKey = `${fileId}-${chunkIndex}`;
  if (activePrefetchJobs.has(jobKey)) return;
  activePrefetchJobs.add(jobKey);

  try {
    // Use the primary client directly to avoid connection handshake lag
    await downloadChunkToCache(client, config, fileId, manifest, chunkIndex);
  } catch (err) {
    console.warn(`[PREFETCH] Failed to prefetch chunk ${chunkIndex} to cache:`, err);
  } finally {
    activePrefetchJobs.delete(jobKey);
  }
}


/**
 * Downloads a single file chunk and caches it in memory for instant playback.
 */
export async function downloadChunkToCache(
  client: TelegramClient,
  config: DriveConfig,
  fileId: string,
  manifest: ChunkManifest,
  chunkIndex: number,
  limitBytes?: number
): Promise<Uint8Array> {
  // 1. Check in-memory cache (only for full chunks)
  let cached = previewChunkCache.get(fileId);
  if (!cached) {
    cached = new Map<number, Uint8Array>();
    previewChunkCache.set(fileId, cached);
  }
  if (!limitBytes && cached.has(chunkIndex)) {
    return cached.get(chunkIndex)!;
  }

  // 2. Check IndexedDB persistent cache (only for full chunks)
  if (!limitBytes) {
    const persisted = await getCachedChunk(fileId, chunkIndex);
    if (persisted) {
      cached.set(chunkIndex, persisted);
      return persisted;
    }
  }

  const msgId = manifest.chunks[chunkIndex];
  const peer = new Api.InputPeerChannel({
    channelId: bigInt(config.chatId),
    accessHash: bigInt(config.accessHash),
  });

  let message = messageCache.get(msgId);
  if (!message) {
    const messages = await client.getMessages(peer, { ids: [msgId] });
    if (!messages.length || !messages[0] || messages[0].className !== "Message") {
      throw new Error(`Message not found for chunk ${chunkIndex}`);
    }
    message = messages[0] as Api.Message;
    setCachedMessage(msgId, message);
  }

  let attempts = 0;
  while (attempts < 5) {
    try {
      let buffer: ArrayBuffer | Uint8Array;
      
      // If limitBytes is specified, download only a slice of the document using iterDownload
      if (limitBytes && message.media) {
        let targetDcId: number | undefined;
        const media = message.media;
        if (media.className === "MessageMediaDocument" && (media as Api.MessageMediaDocument).document) {
          targetDcId = ((media as Api.MessageMediaDocument).document as Api.Document).dcId;
        } else if (media.className === "MessageMediaPhoto" && (media as Api.MessageMediaPhoto).photo) {
          targetDcId = ((media as Api.MessageMediaPhoto).photo as Api.Photo).dcId;
        }

        const actualSize = (media as any).document?.size || (media as any).photo?.sizes?.pop()?.size || limitBytes;
        const bytesToDownload = Math.min(limitBytes, actualSize);

        const chunksList: Uint8Array[] = [];
        let bytesReceived = 0;
        const iterParams = {
          file: media,
          offset: bigInt(0),
          limit: bytesToDownload,
          requestSize: 128 * 1024,
          dcId: targetDcId,
        };

        for await (const chunk of client.iterDownload(iterParams)) {
          const chunkData = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
          chunksList.push(chunkData);
          bytesReceived += chunkData.length;
          if (bytesReceived >= bytesToDownload) break;
        }

        const combined = new Uint8Array(bytesReceived);
        let writeOffset = 0;
        for (const ch of chunksList) {
          combined.set(ch, writeOffset);
          writeOffset += ch.length;
        }
        buffer = combined;
      } else {
        buffer = await downloadMediaWithWorkers(client, message, { workers: 8 });
      }

      if (buffer && buffer.byteLength > 0) {
        const arr = new Uint8Array(buffer);
        // Only write to memory cache and IndexedDB if it was a FULL chunk download
        if (!limitBytes) {
          cached.set(chunkIndex, arr);
          if (chunkIndex === 0) {
            setCachedChunk(fileId, chunkIndex, arr).catch(() => {});
          }
        }
        return arr;
      }
    } catch (e) {
      const wait = getFloodWaitSeconds(e);
      if (wait !== null) {
        console.warn(`FloodWait: sleeping ${wait}s then retrying chunk ${chunkIndex}`);
        await new Promise((r) => setTimeout(r, wait * 1000));
        attempts++;
        continue;
      }
      console.warn(`Chunk ${chunkIndex} download failed, retrying...`, e);
    }
    attempts++;
    await new Promise((r) => setTimeout(r, 1000 * attempts));
  }
  throw new Error(`Failed to download chunk ${chunkIndex}`);
}

export async function downloadThumbnailById(
  client: TelegramClient,
  config: DriveConfig,
  msgId: number
): Promise<Uint8Array> {
  const peer = new Api.InputPeerChannel({
    channelId: bigInt(config.chatId),
    accessHash: bigInt(config.accessHash),
  });

  const messages = await client.getMessages(peer, { ids: [msgId] });
  if (!messages.length || !messages[0] || messages[0].className !== "Message") {
    throw new Error(`Message not found for thumbnail ${msgId}`);
  }
  const message = messages[0] as Api.Message;
  const buffer = await downloadMediaWithWorkers(client, message, { workers: 4 });
  return new Uint8Array(buffer);
}

class BiquadFilter {
  b0: number; b1: number; b2: number;
  a1: number; a2: number;
  x1 = 0; x2 = 0;
  y1 = 0; y2 = 0;

  constructor(cutoff: number, sampleRate: number) {
    const ff = Math.min(0.45, cutoff / sampleRate);
    const ita = 1.0 / Math.tan(Math.PI * ff);
    const q = Math.sqrt(2.0);
    const den = 1.0 + q * ita + ita * ita;
    this.b0 = 1.0 / den;
    this.b1 = 2.0 / den;
    this.b2 = 1.0 / den;
    this.a1 = 2.0 * (1.0 - ita * ita) / den;
    this.a2 = (1.0 - q * ita + ita * ita) / den;
  }

  process(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

export async function handleStreamRequest(
  client: TelegramClient,
  config: DriveConfig,
  event: MessageEvent,
  files: DriveFile[]
) {
  if (event.data.type !== "FETCH_STREAM") return;
  const { fileId, range } = event.data;
  const port = event.ports[0];

  if (!port) return;

  const file = files.find((f) => f.id.toString() === fileId);
  if (!file) {
    port.postMessage({ type: "ERROR", error: "File not found" });
    return;
  }

  if (file.size <= 0) {
    port.postMessage({
      type: "HEADER",
      status: 200,
      start: 0,
      end: -1,
      totalSize: 0,
      contentLength: 0,
      mimeType: file.mimeType || mimeTypeFromName(file.name),
    });
    port.postMessage({ type: "END" });
    return;
  }

  const STREAM_REQUEST_SIZE = 1024 * 1024;

  // Check if file is a DSD audio format (.dsf or .dff)
  const isDsfFile = file.name.toLowerCase().endsWith(".dsf");
  let dsdHeader = { dataOffset: 0, dataSize: 0, channels: 2, sampleRate: 2822400, blockSize: 4096 };

  if (isDsfFile) {
    try {
      // Chunk 0 contains the DSD header information
      const headerData = await downloadChunkToCache(client, config, file.id.toString(), file.manifest, 0);
      if (headerData && headerData.length >= 80) {
        const view = new DataView(headerData.buffer, headerData.byteOffset, headerData.byteLength);
        if (view.getUint32(0, true) === 0x20445344) { // "DSD "
          let offset = 28;
          while (offset < headerData.length - 12) {
            const chunkHeader = view.getUint32(offset, true);
            const chunkSize = Number(view.getBigUint64(offset + 4, true));
            if (chunkHeader === 0x20746d66) { // "fmt "
              dsdHeader.channels = view.getUint32(offset + 24, true);
              dsdHeader.sampleRate = view.getUint32(offset + 28, true);
              if (chunkSize >= 48) {
                dsdHeader.blockSize = view.getUint32(offset + 44, true);
              }
            } else if (chunkHeader === 0x61746164) { // "data"
              dsdHeader.dataOffset = offset + 12;
              dsdHeader.dataSize = chunkSize - 12;
              break;
            }
            offset += chunkSize;
          }
        }
      }
    } catch (e) {
      console.warn("Failed to parse DSD header:", e);
    }
  }

  if (isDsfFile && (dsdHeader.dataSize === 0 || dsdHeader.channels <= 0 || dsdHeader.sampleRate <= 0)) {
    dsdHeader.dataOffset = 80;
    dsdHeader.dataSize = file.size - 80;
    dsdHeader.channels = 2;
    dsdHeader.sampleRate = 2822400;
  }

  const wavDataSize = Math.floor(dsdHeader.dataSize / 4);
  const wavTotalSize = 44 + wavDataSize;

  const wavSampleRate = dsdHeader.sampleRate / 64;
  const lpFilterLeft = isDsfFile ? new BiquadFilter(16000, wavSampleRate) : null;
  const lpFilterRight = isDsfFile ? new BiquadFilter(16000, wavSampleRate) : null;

  const hasRange = typeof range === "string" && range.startsWith("bytes=");
  let start = 0;
  let requestedEnd = (isDsfFile ? wavTotalSize : file.size) - 1;

  if (hasRange) {
    const firstRange = range.replace(/bytes=/, "").split(",")[0].trim();
    const [startPart, endPart] = firstRange.split("-");

    if (!startPart && endPart) {
      const suffixLength = parseInt(endPart, 10);
      if (!Number.isNaN(suffixLength)) {
        start = Math.max((isDsfFile ? wavTotalSize : file.size) - suffixLength, 0);
      }
    } else {
      const parsedStart = parseInt(startPart || "0", 10);
      if (!Number.isNaN(parsedStart)) {
        start = parsedStart;
      }
      if (endPart) {
        const parsedEnd = parseInt(endPart, 10);
        if (!Number.isNaN(parsedEnd)) {
          requestedEnd = parsedEnd;
        }
      }
    }
  }

  start = Math.max(0, Math.min(start, (isDsfFile ? wavTotalSize : file.size) - 1));
  requestedEnd = Math.max(start, Math.min(requestedEnd, (isDsfFile ? wavTotalSize : file.size) - 1));

  // Adaptive range step size
  const isInitialRequest = start === 0;
  const isEarlyRequest = start < 8 * 1024 * 1024;
  const STREAM_STEP = isInitialRequest ? 1 * 1024 * 1024 : isEarlyRequest ? 4 * 1024 * 1024 : 12 * 1024 * 1024;

  const end = hasRange
    ? Math.min(requestedEnd, start + STREAM_STEP - 1)
    : requestedEnd;
  const contentLength = end - start + 1;

  // Range alignment for block-based decoders (DSD decimation requires block group = 4096 * 2 bytes = 2048 WAV bytes)
  const alignedStart = isDsfFile
    ? (start < 44 ? 0 : Math.floor((start - 44) / 2048) * 2048 + 44)
    : start;
  const alignedEnd = isDsfFile
    ? (end < 44 ? 43 : Math.ceil((end + 1 - 44) / 2048) * 2048 + 44 - 1)
    : end;

  const peer = new Api.InputPeerChannel({
    channelId: bigInt(config.chatId),
    accessHash: bigInt(config.accessHash),
  });
  let mimeType = file.mimeType || mimeTypeFromName(file.name);
  if (mimeType === "application/octet-stream") {
    mimeType = mimeTypeFromName(file.name);
  }

  let aborted = false;
  port.onmessage = (e) => {
    if (e.data?.type === "ABORT") {
      aborted = true;
    }
  };

  const sendBytes = (bytes: Uint8Array) => {
    if (aborted || bytes.length === 0) return;
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    port.postMessage({ type: "CHUNK", chunk: copy.buffer }, [copy.buffer]);
  };

  // Stateless progressive range slicer to handle arbitrary browser request alignments
  let bytesDiscarded = 0;
  let bytesSentToPort = 0;
  const discardPrefix = start - alignedStart;
  const targetBytes = contentLength;

  const sendBytesSliced = (bytes: Uint8Array) => {
    if (aborted || bytesSentToPort >= targetBytes) return;

    let data = bytes;
    if (bytesDiscarded < discardPrefix) {
      const remainingToDiscard = discardPrefix - bytesDiscarded;
      if (data.length <= remainingToDiscard) {
        bytesDiscarded += data.length;
        return;
      }
      data = data.slice(remainingToDiscard);
      bytesDiscarded = discardPrefix;
    }

    const remainingToSent = targetBytes - bytesSentToPort;
    if (data.length > remainingToSent) {
      data = data.slice(0, remainingToSent);
    }

    if (data.length > 0) {
      sendBytes(data);
      bytesSentToPort += data.length;
    }
  };

  // State and logic for on-the-fly DSD decoding
  let dsdBuffer = new Uint8Array(0);
  const processAndSendDsdBytes = (rawDsdBytes: Uint8Array) => {
    if (aborted) return;
    const newBuf = new Uint8Array(dsdBuffer.length + rawDsdBytes.length);
    newBuf.set(dsdBuffer, 0);
    newBuf.set(rawDsdBytes, dsdBuffer.length);
    dsdBuffer = newBuf;

    const blockSize = dsdHeader.blockSize || 4096;
    const channels = dsdHeader.channels || 2;
    const groupSize = blockSize * channels;

    const numGroups = Math.floor(dsdBuffer.length / groupSize);
    if (numGroups === 0) return;

    const samplesPerChannelPerGroup = blockSize / 8;
    const pcmBytes = new Uint8Array(numGroups * samplesPerChannelPerGroup * channels * 2);
    const pcmView = new DataView(pcmBytes.buffer);

    let pcmOffset = 0;
    for (let g = 0; g < numGroups; g++) {
      const groupStart = g * groupSize;
      
      for (let s = 0; s < samplesPerChannelPerGroup; s++) {
        // Decode left channel (channel 0)
        const leftByteOffset = groupStart + (0 * blockSize) + (s * 8);
        let leftOnes = 0;
        for (let b = 0; b < 8; b++) {
          let temp = dsdBuffer[leftByteOffset + b];
          while (temp > 0) {
            leftOnes += temp & 1;
            temp >>= 1;
          }
        }
        const leftVal = (leftOnes / 32) - 1.0;
        const leftFiltered = lpFilterLeft ? lpFilterLeft.process(leftVal) : leftVal;
        const leftSample = Math.max(-32768, Math.min(32767, leftFiltered * 32767));
        pcmView.setInt16(pcmOffset, leftSample, true);
        pcmOffset += 2;

        // Decode right channel (channel 1)
        const rightByteOffset = groupStart + (1 * blockSize) + (s * 8);
        let rightOnes = 0;
        for (let b = 0; b < 8; b++) {
          let temp = dsdBuffer[rightByteOffset + b];
          while (temp > 0) {
            rightOnes += temp & 1;
            temp >>= 1;
          }
        }
        const rightVal = (rightOnes / 32) - 1.0;
        const rightFiltered = lpFilterRight ? lpFilterRight.process(rightVal) : rightVal;
        const rightSample = Math.max(-32768, Math.min(32767, rightFiltered * 32767));
        pcmView.setInt16(pcmOffset, rightSample, true);
        pcmOffset += 2;
      }
    }

    sendBytesSliced(pcmBytes);
    dsdBuffer = dsdBuffer.slice(numGroups * groupSize);
  };

  const getChunkMessage = async (chunkIndex: number) => {
    const msgId = file.manifest.chunks[chunkIndex];
    if (!msgId) {
      throw new Error(`Missing manifest chunk ${chunkIndex}`);
    }

    let message = messageCache.get(msgId);
    if (message) return message;

    const messages = await client.getMessages(peer, { ids: [msgId] });
    if (!messages.length || !messages[0] || messages[0].className !== "Message") {
      throw new Error(`Message not found for chunk ${chunkIndex}`);
    }
    message = messages[0] as Api.Message;
    messageCache.set(msgId, message);
    return message;
  };

  const streamUncachedRange = async (
    message: Api.Message,
    offsetInChunk: number,
    bytesNeeded: number,
    dcId?: number
  ) => {
    if (!message.media) {
      throw new Error("Chunk message has no downloadable media");
    }
    const alignedOffset = Math.floor(offsetInChunk / 4096) * 4096;
    const unalignedPrefix = offsetInChunk - alignedOffset;
    let isFirstChunk = true;
    let bytesSent = 0;
    const iterParams: IterDownloadFunction = {
      file: message.media,
      offset: bigInt(alignedOffset),
      limit: bytesNeeded + unalignedPrefix,
      requestSize: STREAM_REQUEST_SIZE,
      dcId,
    };

    for await (const rawChunk of client.iterDownload(iterParams)) {
      if (aborted) break;

      let dataToSend = rawChunk instanceof Uint8Array ? rawChunk : new Uint8Array(rawChunk);
      if (isFirstChunk) {
        isFirstChunk = false;
        if (unalignedPrefix > 0) {
          dataToSend = dataToSend.slice(unalignedPrefix);
        }
      }

      const remaining = bytesNeeded - bytesSent;
      if (dataToSend.length > remaining) {
        dataToSend = dataToSend.slice(0, remaining);
      }

      if (isDsfFile) {
        processAndSendDsdBytes(dataToSend);
      } else {
        sendBytesSliced(dataToSend);
      }
      bytesSent += dataToSend.length;
      if (bytesSent >= bytesNeeded) break;
    }

    return bytesSent;
  };

  try {
    let dsdStartOffset = 0;
    let dsdEndOffset = 0;
    if (isDsfFile) {
      const pcmByteStart = Math.max(44, alignedStart) - 44;
      const pcmByteEnd = Math.min(wavTotalSize - 1, alignedEnd) - 44;
      dsdStartOffset = dsdHeader.dataOffset + pcmByteStart * 4;
      dsdEndOffset = dsdHeader.dataOffset + (pcmByteEnd + 1) * 4 - 1;
    }

    const firstMsgChunkIdx = Math.floor((isDsfFile ? dsdStartOffset : alignedStart) / CHUNK_SIZE);

    // Pre-warm target DC connection before initiating the stream loop
    if (file.manifest.chunks.length > 0) {
      try {
        const firstMsg = await getChunkMessage(firstMsgChunkIdx);
        if (firstMsg?.media) {
          let targetDcId: number | undefined;
          if (firstMsg.media.className === "MessageMediaDocument" && (firstMsg.media as Api.MessageMediaDocument).document) {
            targetDcId = ((firstMsg.media as Api.MessageMediaDocument).document as Api.Document).dcId;
          } else if (firstMsg.media.className === "MessageMediaPhoto" && (firstMsg.media as Api.MessageMediaPhoto).photo) {
            targetDcId = ((firstMsg.media as Api.MessageMediaPhoto).photo as Api.Photo).dcId;
          }
          if (targetDcId) {
            await client.getSender(targetDcId);
          }
        }
      } catch (err) {
        console.warn("Failed to pre-warm stream sender connection:", err);
      }
    }

    port.postMessage({
      type: "HEADER",
      status: hasRange ? 206 : 200,
      start,
      end,
      totalSize: isDsfFile ? wavTotalSize : file.size,
      contentLength,
      mimeType: isDsfFile ? "audio/wav" : mimeType,
    });

    if (isDsfFile && alignedStart < 44) {
      const wavHeader = new ArrayBuffer(44);
      const wavView = new DataView(wavHeader);
      const writeString = (view: DataView, offset: number, string: string) => {
        for (let i = 0; i < string.length; i++) {
          view.setUint8(offset + i, string.charCodeAt(i));
        }
      };
      const wavSampleRate = dsdHeader.sampleRate / 64;
      const wavByteRate = wavSampleRate * dsdHeader.channels * 2;
      const wavBlockAlign = dsdHeader.channels * 2;

      writeString(wavView, 0, 'RIFF');
      wavView.setUint32(4, 36 + wavDataSize, true);
      writeString(wavView, 8, 'WAVE');
      writeString(wavView, 12, 'fmt ');
      wavView.setUint32(16, 16, true);
      wavView.setUint16(20, 1, true);
      wavView.setUint16(22, dsdHeader.channels, true);
      wavView.setUint32(24, wavSampleRate, true);
      wavView.setUint32(28, wavByteRate, true);
      wavView.setUint16(32, wavBlockAlign, true);
      wavView.setUint16(34, 16, true);
      writeString(wavView, 36, 'data');
      wavView.setUint32(40, wavDataSize, true);

      const headerBytes = new Uint8Array(wavHeader);
      sendBytesSliced(headerBytes);
    }

    let cursor = isDsfFile ? dsdStartOffset : alignedStart;
    const finalEnd = isDsfFile ? dsdEndOffset : alignedEnd;

    while (cursor <= finalEnd && !aborted) {
      const chunkIndex = Math.floor(cursor / CHUNK_SIZE);

      // Prefetch the next chunk in the background using the warm primary client
      const nextChunkIndex = chunkIndex + 1;
      if (nextChunkIndex < file.manifest.chunks.length) {
        const cacheMap = previewChunkCache.get(fileId);
        if (!cacheMap || !cacheMap.has(nextChunkIndex)) {
          triggerBackgroundPrefetch(client, config, fileId, file.manifest, nextChunkIndex);
        }
      }

      const chunkStart = chunkIndex * CHUNK_SIZE;
      const offsetInChunk = cursor - chunkStart;
      const bytesNeeded = Math.min(finalEnd - cursor + 1, CHUNK_SIZE - offsetInChunk);

      const cachedData = previewChunkCache.get(fileId)?.get(chunkIndex);
      if (cachedData) {
        const slice = cachedData.slice(offsetInChunk, offsetInChunk + bytesNeeded);
        if (isDsfFile) {
          processAndSendDsdBytes(slice);
        } else {
          sendBytesSliced(slice);
        }
        cursor += slice.length;
        continue;
      }

      const message = await getChunkMessage(chunkIndex);
      let dcId: number | undefined;
      const media = message.media;
      if (media) {
        if (media.className === "MessageMediaDocument" && (media as Api.MessageMediaDocument).document) {
          dcId = ((media as Api.MessageMediaDocument).document as Api.Document).dcId;
        } else if (media.className === "MessageMediaPhoto" && (media as Api.MessageMediaPhoto).photo) {
          dcId = ((media as Api.MessageMediaPhoto).photo as Api.Photo).dcId;
        }
      }

      const sent = await streamUncachedRange(message, offsetInChunk, bytesNeeded, dcId);
      if (sent <= 0) {
        throw new Error(`No bytes returned for chunk ${chunkIndex}`);
      }
      cursor += sent;
    }
    
    if (!aborted) {
      port.postMessage({ type: "END" });
    }
    
  } catch (e: unknown) {
    console.error("[STREAM] ERROR:", e);
    port.postMessage({ type: "ERROR", error: getErrorMessage(e) });
  }
}

async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
  signal?: AbortSignal
): Promise<T[]> {
  const results: T[] = [];
  let index = 0;
  async function worker() {
    while (index < tasks.length) {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      const i = index++;
      results[i] = await tasks[i]();
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }).map(() => worker());
  await Promise.all(workers);
  return results;
}

async function getManifestMessageMap(
  client: TelegramClient,
  peer: Api.TypeInputPeer,
  chunkIds: number[]
): Promise<Map<number, Api.Message>> {
  const messageMap = new Map<number, Api.Message>();

  for (const msgId of chunkIds) {
    const cachedMsg = messageCache.get(msgId);
    if (cachedMsg) {
      messageMap.set(msgId, cachedMsg);
    }
  }

  const missingMessageIds = chunkIds.filter((id) => !messageMap.has(id));
  const batchSize = 100;
  for (let i = 0; i < missingMessageIds.length; i += batchSize) {
    const fetchedMessages = await client.getMessages(peer, {
      ids: missingMessageIds.slice(i, i + batchSize),
    });
    for (const msg of fetchedMessages) {
      if (msg && msg.className === "Message") {
        messageMap.set(msg.id, msg);
        messageCache.set(msg.id, msg);
      }
    }
  }

  return messageMap;
}

/**
 * Load all messages from a topic and extract valid file manifests.
 * Raw chunk messages are filtered out — only manifest entries appear in the UI.
 */
export async function listFilesInTopic(
  client: TelegramClient,
  config: DriveConfig,
  topicId: number
): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  const peer = new Api.InputPeerChannel({ channelId: bigInt(config.chatId), accessHash: bigInt(config.accessHash) });

  try {
    const messageById = new Map<number, Api.Message>();
    let offsetId = 0;
    const limit = 100;

    while (true) {
      const result = await client.invoke(
        new Api.messages.GetReplies({
          peer,
          msgId: topicId,
          offsetId,
          offsetDate: 0,
          addOffset: 0,
          limit,
          maxId: 0,
          minId: 0,
          hash: bigInt.zero,
        })
      );

      const messages =
        (result as Api.messages.ChannelMessages).messages ?? [];

      if (messages.length === 0) {
        break;
      }

      let hasNewMessage = false;
      let minId = offsetId || Infinity;

      for (const msg of messages) {
        if (msg.className === "Message") {
          const m = msg as Api.Message;
          if (!messageById.has(m.id)) {
            messageById.set(m.id, m);
          }
          if (offsetId === 0 || m.id < offsetId) {
            hasNewMessage = true;
            if (m.id < minId) {
              minId = m.id;
            }
          }
        }
      }

      if (!hasNewMessage || minId === Infinity || minId === offsetId) {
        break;
      }

      offsetId = minId;
    }

    // 1. First pass: parse manifests and collect missing chunk message IDs & thumb message IDs
    const manifestItems: { msg: Api.Message; manifest: any }[] = [];
    const missingChunkIds: number[] = [];

    for (const m of messageById.values()) {
      if (!m.message) continue;
      const manifest = parseManifest(m.message);
      if (manifest) {
        manifestItems.push({ msg: m, manifest });
        const firstChunkId = manifest.chunks[0];
        if (firstChunkId && !messageById.has(firstChunkId)) {
          missingChunkIds.push(firstChunkId);
        }
}
  }

    // 2. Batch fetch all missing messages in one single call
    if (missingChunkIds.length > 0) {
      try {
        const chunkMessages = await client.getMessages(peer, {
          ids: missingChunkIds,
        });
        for (const chunkMsg of chunkMessages) {
          if (chunkMsg && chunkMsg.id) {
            messageById.set(chunkMsg.id, chunkMsg as Api.Message);
          }
        }
      } catch (err) {
        console.warn("[listFilesInTopic] Failed to batch fetch chunk messages:", err);
      }
    }

    // 3. Second pass: construct files list
    for (const item of manifestItems) {
      const { msg, manifest } = item;
      const chunkMsg = messageById.get(manifest.chunks[0]);
      const chunkInfo = getMessageDocumentInfo(chunkMsg);
      const thumbMsg = undefined;
      files.push({
        id: msg.id,
        name: manifest.fileName,
        size: manifest.fileSize,
        topicId,
        manifest,
        date: msg.date,
        mimeType: chunkInfo.mimeType,
        chunkFileName: chunkInfo.fileName,
        message: chunkMsg,
      });
    }
  } catch (err) {
    console.error("Failed to list files in topic:", err);
  }

  return files;
}


export async function deleteDriveFile(
  client: TelegramClient,
  config: DriveConfig,
  file: DriveFile
): Promise<boolean> {
  try {
    const peer = new Api.InputPeerChannel({
      channelId: bigInt(config.chatId),
      accessHash: bigInt(config.accessHash),
    });
    const ids = Array.from(
      new Set([
        file.id,
        ...(file.manifest.thumb ? [file.manifest.thumb] : []),
        ...file.manifest.chunks,
      ])
    );
    await client.invoke(
      new Api.channels.DeleteMessages({
        channel: peer,
        id: ids,
      })
    );
    return true;
  } catch (err) {
    console.error("Failed to delete file:", err);
    return false;
  }
}

export async function renameDriveFile(
  client: TelegramClient,
  config: DriveConfig,
  file: DriveFile,
  name: string
): Promise<boolean> {
  try {
    const peer = new Api.InputPeerChannel({
      channelId: bigInt(config.chatId),
      accessHash: bigInt(config.accessHash),
    });
    await client.invoke(
      new Api.messages.EditMessage({
        peer,
        id: file.id,
        message: buildManifest(
          normalizeRenamedFileName(file, name),
          file.size,
          file.manifest.chunks
        ),
      })
    );
    return true;
  } catch (err) {
    console.error("Failed to rename file:", err);
    return false;
  }
}



function getDynamicConcurrency() {
  const cores = navigator.hardwareConcurrency || 4;

  if (cores >= 12) {
    return { segments: 6, workers: 16 };
  }
  if (cores >= 8) {
    return { segments: 4, workers: 12 };
  }
  return { segments: 3, workers: 8 };
}

/**
 * Download a segmented file by streaming each chunk through StreamSaver.
 * Falls back to in-memory concatenation when StreamSaver isn't available.
 */
export async function downloadFile(
  client: TelegramClient,
  config: DriveConfig,
  manifest: ChunkManifest,
  onProgress?: (downloaded: number, total: number) => void,
  signal?: AbortSignal
): Promise<void> {
  const { segments, workers } = getDynamicConcurrency();
  let streamsaver: typeof import("streamsaver") | null = null;
  try {
    streamsaver = await import("streamsaver");
  } catch {
    // StreamSaver not available — fall back to blob download
  }

  const chunkProgress = new Float64Array(manifest.chunks.length);
  const emitProgress = () => {
    const totalDownloaded = chunkProgress.reduce((a, b) => a + b, 0);
    onProgress?.(totalDownloaded, manifest.fileSize);
  };
  const progressInterval = setInterval(emitProgress, 100);

  let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;

  let abortPromise: Promise<never> | null = null;
  let abortHandler: (() => void) | null = null;
  if (signal) {
    abortPromise = new Promise((_, reject) => {
      abortHandler = () => reject(new DOMException("Download aborted", "AbortError"));
      signal.addEventListener("abort", abortHandler);
    });
  }

  try {
    if (signal?.aborted) {
      throw new DOMException("Download aborted", "AbortError");
    }
    emitProgress();

    const peer = new Api.InputPeerChannel({
      channelId: bigInt(config.chatId),
      accessHash: bigInt(config.accessHash),
    });
    const messageMap = await getManifestMessageMap(client, peer, manifest.chunks);

    // Warm connection to the target DC before starting parallel downloads
    if (manifest.chunks.length > 0) {
      const firstMsgId = manifest.chunks[0];
      const firstMsg = messageMap.get(firstMsgId);
      if (firstMsg?.media) {
        let targetDcId: number | undefined;
        if (firstMsg.media.className === "MessageMediaDocument" && (firstMsg.media as Api.MessageMediaDocument).document) {
          targetDcId = ((firstMsg.media as Api.MessageMediaDocument).document as Api.Document).dcId;
        } else if (firstMsg.media.className === "MessageMediaPhoto" && (firstMsg.media as Api.MessageMediaPhoto).photo) {
          targetDcId = ((firstMsg.media as Api.MessageMediaPhoto).photo as Api.Photo).dcId;
        }
        if (targetDcId) {
          try {
            await client.getSender(targetDcId);
          } catch (err) {
            console.warn(`Failed to pre-warm sender for DC ${targetDcId}:`, err);
          }
        }
      }
    }

    if (streamsaver) {
      // Streaming download — avoids V8 heap pressure on huge files
      const fileStream = streamsaver.createWriteStream(manifest.fileName, {
        size: manifest.fileSize,
      });
      const activeWriter = fileStream.getWriter();
      writer = activeWriter;
      const pendingWrites = new Map<number, Uint8Array>();
      let nextWriteIndex = 0;
      let writeLock = Promise.resolve();

      const tasks = manifest.chunks.map((msgId, index) => async () => {
        if (signal?.aborted) {
          throw new DOMException("Download aborted", "AbortError");
        }
        let message = messageMap.get(msgId);
        if (!message) {
          const messages = await client.getMessages(peer, { ids: [msgId] });
          if (messages.length > 0 && messages[0] && messages[0].className === "Message") {
            message = messages[0];
            messageMap.set(msgId, message);
            messageCache.set(msgId, message);
          } else {
            throw new Error(`Message not found for chunk ${index}`);
          }
        }

        let attempts = 0;
        while (attempts < 5) {
          if (signal?.aborted) {
            throw new DOMException("Download aborted", "AbortError");
          }
          try {
            const activeClient = await getHelperClient(index % 3);
            const buffer = await downloadMediaWithWorkers(activeClient, message, {
              workers: workers,
              progressCallback: (dl) => {
                chunkProgress[index] = Number(dl);
              },
            });

            if (buffer && buffer.length > 0) {
              chunkProgress[index] = buffer.length;
              const arr = new Uint8Array(buffer);
              writeLock = writeLock.then(async () => {
                pendingWrites.set(index, arr);
                while (pendingWrites.has(nextWriteIndex)) {
                  if (signal?.aborted) {
                    throw new DOMException("Download aborted", "AbortError");
                  }
                  await activeWriter.write(pendingWrites.get(nextWriteIndex)!);
                  pendingWrites.delete(nextWriteIndex);
                  nextWriteIndex++;
                }
              });
              await writeLock;
              return;
            }
          } catch (e) {
            if (signal?.aborted) {
              throw new DOMException("Download aborted", "AbortError");
            }
            const wait = getFloodWaitSeconds(e);
            if (wait !== null) {
              console.warn(`FloodWait: sleeping ${wait}s then retrying chunk ${index}`);
              await new Promise((r) => setTimeout(r, wait * 1000));
              attempts++;
              continue;
            }
            console.warn(`Chunk ${index} failed, retrying...`, e);
          }
          attempts++;
          await new Promise((r) => setTimeout(r, 1000 * attempts));
        }
        throw new Error(`Failed to download chunk ${index}`);
      });

      const downloadPromise = runWithConcurrency(tasks, segments, signal);
      if (abortPromise) {
        await Promise.race([downloadPromise, abortPromise]);
      } else {
        await downloadPromise;
      }
      await activeWriter.close();
    } else {
      // Fallback: collect all buffers and trigger a download blob
      const tasks = manifest.chunks.map((msgId, index) => async () => {
        if (signal?.aborted) {
          throw new DOMException("Download aborted", "AbortError");
        }
        let message = messageMap.get(msgId);
        if (!message) {
          const messages = await client.getMessages(peer, { ids: [msgId] });
          if (messages.length > 0 && messages[0]) {
            message = messages[0];
            messageMap.set(msgId, message);
          } else {
            throw new Error(`Message not found for chunk ${index}`);
          }
        }

        let attempts = 0;
        while (attempts < 5) {
          if (signal?.aborted) {
            throw new DOMException("Download aborted", "AbortError");
          }
          try {
            const activeClient = await getHelperClient(index % 3);
            const buffer = await downloadMediaWithWorkers(activeClient, message, {
              workers: workers,
              progressCallback: (dl) => {
                chunkProgress[index] = Number(dl);
              },
            });

            if (buffer && buffer.length > 0) {
              chunkProgress[index] = buffer.length;
              return { index, buffer: new Uint8Array(buffer) };
            }
          } catch (e) {
            if (signal?.aborted) {
              throw new DOMException("Download aborted", "AbortError");
            }
            const wait = getFloodWaitSeconds(e);
            if (wait !== null) {
              console.warn(`FloodWait: sleeping ${wait}s then retrying chunk ${index}`);
              await new Promise((r) => setTimeout(r, wait * 1000));
              attempts++;
              continue;
            }
            console.warn(`Chunk ${index} failed, retrying...`, e);
          }
          attempts++;
          await new Promise((r) => setTimeout(r, 1000 * attempts));
        }
        throw new Error(`Failed to download chunk ${index}`);
      });

      let results: any[];
      const downloadPromise = runWithConcurrency(tasks, segments, signal);
      if (abortPromise) {
        results = await Promise.race([downloadPromise, abortPromise]);
      } else {
        results = await downloadPromise;
      }
      results.sort((a, b) => a.index - b.index);

      const blob = new Blob(results.map((r) => r.buffer));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = manifest.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  } catch (err) {
    if (writer) {
      try {
        await writer.abort(err);
      } catch {
        // ignore writer abort errors
      }
    }
    throw err;
  } finally {
    if (signal && abortHandler) {
      signal.removeEventListener("abort", abortHandler);
    }
    clearInterval(progressInterval);
    emitProgress(); // final emit
  }
}

/**
 * Download a file entirely into memory and return its Blob.
 * Useful for in-browser previews of images, audio, and video.
 */
export async function downloadFileToMemory(
  client: TelegramClient,
  config: DriveConfig,
  manifest: ChunkManifest,
  onProgress?: (downloaded: number, total: number) => void,
  signal?: AbortSignal
): Promise<Blob> {
  const { segments } = getDynamicConcurrency();
  const chunkProgress = new Float64Array(manifest.chunks.length);
  const emitProgress = () => {
    const totalDownloaded = chunkProgress.reduce((a, b) => a + b, 0);
    onProgress?.(totalDownloaded, manifest.fileSize);
  };
  const progressInterval = setInterval(emitProgress, 100);

  let abortPromise: Promise<never> | null = null;
  let abortHandler: (() => void) | null = null;
  if (signal) {
    abortPromise = new Promise((_, reject) => {
      abortHandler = () => reject(new DOMException("Download aborted", "AbortError"));
      signal.addEventListener("abort", abortHandler);
    });
  }

  try {
    if (signal?.aborted) {
      throw new DOMException("Download aborted", "AbortError");
    }
    emitProgress();

    const peer = new Api.InputPeerChannel({
      channelId: bigInt(config.chatId),
      accessHash: bigInt(config.accessHash),
    });
    const messageMap = await getManifestMessageMap(client, peer, manifest.chunks);

    const tasks = manifest.chunks.map((msgId, index) => async () => {
      if (signal?.aborted) {
        throw new DOMException("Download aborted", "AbortError");
      }
      let message = messageMap.get(msgId);
      if (!message) {
        const messages = await client.getMessages(peer, { ids: [msgId] });
        if (messages.length > 0 && messages[0] && messages[0].className === "Message") {
          message = messages[0];
          messageMap.set(msgId, message);
          messageCache.set(msgId, message);
        } else {
          throw new Error(`Message not found for chunk ${index}`);
        }
      }

      let attempts = 0;
      while (attempts < 3) {
        if (signal?.aborted) {
          throw new DOMException("Download aborted", "AbortError");
        }
        try {
            const buffer = await downloadMediaWithWorkers(client, message, {
              workers: 12,
              progressCallback: (dl) => {
                chunkProgress[index] = Number(dl);
              },
            });

          if (buffer && buffer.length > 0) {
            chunkProgress[index] = buffer.length;
            return { index, buffer: new Uint8Array(buffer) };
          }
        } catch (e) {
          console.warn(`Chunk ${index} failed, retrying...`, e);
        }
        attempts++;
        await new Promise((r) => setTimeout(r, 1000 * attempts));
      }
      throw new Error(`Failed to download chunk ${index}`);
    });

    let results: any[];
    const downloadPromise = runWithConcurrency(tasks, segments, signal);
    if (abortPromise) {
      results = await Promise.race([downloadPromise, abortPromise]);
    } else {
      results = await downloadPromise;
    }
    results.sort((a, b) => a.index - b.index);

    return new Blob(results.map((r) => r.buffer));
  } finally {
    if (signal && abortHandler) {
      signal.removeEventListener("abort", abortHandler);
    }
    clearInterval(progressInterval);
    emitProgress(); // final emit
  }
}

function extractID3Cover(buffer: Uint8Array): Uint8Array | null {
  // Check ID3 header (starts with "ID3")
  if (buffer[0] !== 0x49 || buffer[1] !== 0x44 || buffer[2] !== 0x33) {
    return null;
  }

  let offset = 10; // Skip ID3v2 header
  const limit = buffer.length;

  while (offset + 10 < limit) {
    // Read Frame ID (4 bytes)
    const frameId = String.fromCharCode(buffer[offset], buffer[offset + 1], buffer[offset + 2], buffer[offset + 3]);
    // Read Frame Size (4 bytes, 32-bit big endian)
    const frameSize = (buffer[offset + 4] << 24) | (buffer[offset + 5] << 16) | (buffer[offset + 6] << 8) | buffer[offset + 7];
    
    if (frameSize <= 0 || offset + 10 + frameSize > limit) break;

    if (frameId === "APIC") {
      const frameDataOffset = offset + 10;
      let p = frameDataOffset + 1; // Skip encoding byte
      
      // Skip MIME type string
      while (p < limit && buffer[p] !== 0) p++;
      p++; // Skip null terminator
      
      p++; // Skip picture type byte
      
      // Skip description string
      while (p < limit && buffer[p] !== 0) p++;
      p++; // Skip null terminator
      
      const picSize = frameSize - (p - frameDataOffset);
      if (picSize > 0 && p + picSize <= limit) {
        return buffer.slice(p, p + picSize);
      }
    }
    
}
  return null;
}
