import { TelegramClient, Api } from "telegram";
import type { DownloadMediaInterface, IterDownloadFunction } from "telegram/client/downloads";
import type { ChunkManifest, DriveFile, DriveConfig } from "../types";
import { buildManifest, parseManifest } from "./manifest";
import bigInt from "big-integer";
import { CHUNK_SIZE } from "../config/telegram";

// Module-level cache for message objects to avoid redundant Telegram API round-trips
const messageCache = new Map<number, Api.Message>();

function getErrorMessage(err: unknown) {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err && "message" in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Unknown error";
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
  const ext =
    extensionFromName(file.chunkFileName) ||
    extensionFromName(file.name) ||
    extensionFromName(file.manifest.fileName);
  if (!trimmed) return "";
  if (!ext) return trimmed;
  return `${baseNameWithoutExtension(trimmed).trim() || "Untitled"}${ext}`;
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
            messageCache.set(msg.id, msg as Api.Message);
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
export const previewChunkCache = new Map<string, Map<number, Uint8Array>>();

/**
 * Downloads a single file chunk and caches it in memory for instant playback.
 */
export async function downloadChunkToCache(
  client: TelegramClient,
  config: DriveConfig,
  fileId: string,
  manifest: ChunkManifest,
  chunkIndex: number
): Promise<Uint8Array> {
  let cached = previewChunkCache.get(fileId);
  if (!cached) {
    cached = new Map<number, Uint8Array>();
    previewChunkCache.set(fileId, cached);
  }
  if (cached.has(chunkIndex)) {
    return cached.get(chunkIndex)!;
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
    messageCache.set(msgId, message);
  }

  let attempts = 0;
  while (attempts < 3) {
    try {
      const buffer = await downloadMediaWithWorkers(client, message, { workers: 8 });

      if (buffer && buffer.length > 0) {
        const arr = new Uint8Array(buffer);
        cached.set(chunkIndex, arr);
        return arr;
      }
    } catch (e) {
      console.warn(`Chunk ${chunkIndex} download failed, retrying...`, e);
    }
    attempts++;
    await new Promise((r) => setTimeout(r, 1000 * attempts));
  }
  throw new Error(`Failed to download chunk ${chunkIndex}`);
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

  // The browser usually requests large ranges. Satisfy in 4MB steps so the player
  // starts immediately without waiting on a whole 50MB Telegram part.
  const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  const STREAM_STEP = (isMobile ? 8 : 24) * 1024 * 1024;
  const STREAM_REQUEST_SIZE = (isMobile ? 1024 : 2048) * 1024;

  const hasRange = typeof range === "string" && range.startsWith("bytes=");
  let start = 0;
  let requestedEnd = file.size - 1;

  if (hasRange) {
    const firstRange = range.replace(/bytes=/, "").split(",")[0].trim();
    const [startPart, endPart] = firstRange.split("-");

    if (!startPart && endPart) {
      const suffixLength = parseInt(endPart, 10);
      if (!Number.isNaN(suffixLength)) {
        start = Math.max(file.size - suffixLength, 0);
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

  start = Math.max(0, Math.min(start, file.size - 1));
  requestedEnd = Math.max(start, Math.min(requestedEnd, file.size - 1));
  const end = hasRange
    ? Math.min(requestedEnd, start + STREAM_STEP - 1)
    : requestedEnd;
  const contentLength = end - start + 1;
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

      sendBytes(dataToSend);
      bytesSent += dataToSend.length;
      if (bytesSent >= bytesNeeded) break;
    }

    return bytesSent;
  };

  try {
    port.postMessage({
      type: "HEADER",
      status: hasRange ? 206 : 200,
      start,
      end,
      totalSize: file.size,
      contentLength,
      mimeType,
    });

    let cursor = start;
    while (cursor <= end && !aborted) {
      const chunkIndex = Math.floor(cursor / CHUNK_SIZE);
      const chunkStart = chunkIndex * CHUNK_SIZE;
      const offsetInChunk = cursor - chunkStart;
      const bytesNeeded = Math.min(end - cursor + 1, CHUNK_SIZE - offsetInChunk);

      const cachedData = previewChunkCache.get(fileId)?.get(chunkIndex);
      if (cachedData) {
        const slice = cachedData.slice(offsetInChunk, offsetInChunk + bytesNeeded);
        sendBytes(slice);
        cursor += slice.length;
        continue;
      }

      const message = await getChunkMessage(chunkIndex);
      if (mimeType === "application/octet-stream") {
        const docInfo = getMessageDocumentInfo(message);
        mimeType = docInfo.mimeType || mimeType;
      }

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
    const result = await client.invoke(
      new Api.messages.GetReplies({
        peer,
        msgId: topicId,
        offsetId: 0,
        offsetDate: 0,
        addOffset: 0,
        limit: 200,
        maxId: 0,
        minId: 0,
        hash: bigInt.zero,
      })
    );

    const messages =
      (result as Api.messages.ChannelMessages).messages ?? [];
    const messageById = new Map<number, Api.Message>();

    for (const msg of messages) {
      if (msg.className === "Message") {
        const m = msg as Api.Message;
        messageById.set(m.id, m);
      }
    }

    for (const msg of messages) {
      if (msg.className !== "Message") continue;
      const m = msg as Api.Message;
      if (!m.message) continue;

      const manifest = parseManifest(m.message);
      if (manifest) {
        let chunkInfo = getMessageDocumentInfo(messageById.get(manifest.chunks[0]));
        if (!chunkInfo.mimeType && manifest.chunks[0]) {
          const chunkMessages = await client.getMessages(peer, {
            ids: [manifest.chunks[0]],
          });
          chunkInfo = getMessageDocumentInfo(chunkMessages[0] as Api.Message);
        }
        files.push({
          id: m.id,
          name: manifest.fileName,
          size: manifest.fileSize,
          topicId,
          manifest,
          date: m.date,
          mimeType: chunkInfo.mimeType,
          chunkFileName: chunkInfo.fileName,
        });
      }
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
    const ids = Array.from(new Set([file.id, ...file.manifest.chunks]));
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
  const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

  if (isMobile) {
    if (cores <= 2) {
      return { segments: 2, workers: 4 };
    }
    return { segments: 4, workers: 6 };
  }

  if (cores >= 12) {
    return { segments: 10, workers: 10 };
  }
  if (cores >= 8) {
    return { segments: 8, workers: 8 };
  }
  return { segments: 6, workers: 6 };
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
  const { segments } = getDynamicConcurrency();
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
        while (attempts < 3) {
          if (signal?.aborted) {
            throw new DOMException("Download aborted", "AbortError");
          }
          try {
            const buffer = await downloadMediaWithWorkers(client, message, {
              workers: 16,
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
        while (attempts < 3) {
          if (signal?.aborted) {
            throw new DOMException("Download aborted", "AbortError");
          }
          try {
            const buffer = await downloadMediaWithWorkers(client, message, {
              workers: 16,
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
