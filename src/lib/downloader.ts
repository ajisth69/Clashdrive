import { TelegramClient, Api } from "telegram";
import type { ChunkManifest, DriveFile, DriveConfig } from "../types";
import { buildManifest, parseManifest } from "./manifest";
import bigInt from "big-integer";
import { CHUNK_SIZE } from "../config/telegram";

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

function mimeTypeFromName(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext || "")) {
    return `image/${ext === "jpg" ? "jpeg" : ext}`;
  }
  if (["mp4", "webm", "ogg", "mov"].includes(ext || "")) {
    return ext === "mov" ? "video/quicktime" : `video/${ext}`;
  }
  if (["mp3", "wav", "m4a", "flac", "ogg"].includes(ext || "")) {
    return `audio/${ext === "mp3" ? "mpeg" : ext}`;
  }
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

export async function handleStreamRequest(
  client: TelegramClient,
  config: DriveConfig,
  event: MessageEvent,
  files: DriveFile[]
) {
  if (event.data.type !== "FETCH_STREAM") return;
  const { fileId, range } = event.data;
  const port = event.ports[0];

  const file = files.find((f) => f.id.toString() === fileId);
  if (!file) {
    port.postMessage({ error: "File not found" });
    return;
  }

  let start = 0;
  let end = file.size - 1;
  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    if (parts[0]) start = parseInt(parts[0], 10);
    if (parts[1]) end = Math.min(parseInt(parts[1], 10), file.size - 1);
  }

  // The browser usually requests large ranges, we satisfy up to the end of the current chunk
  // so we don't have to stitch multiple chunks together in one response.
  const chunkIndex = Math.floor(start / CHUNK_SIZE);
  const chunkStart = chunkIndex * CHUNK_SIZE;
  const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, file.size) - 1;
  
  end = Math.min(end, chunkEnd);
  const limit = end - start + 1;
  const offsetInChunk = start - chunkStart;
  
  const msgId = file.manifest.chunks[chunkIndex];
  
  try {
    const messages = await client.getMessages(
      new Api.InputPeerChannel({ channelId: bigInt(config.chatId), accessHash: bigInt(config.accessHash) }),
      { ids: [msgId] }
    );
    if (!messages.length || !messages[0]) {
      throw new Error("Message not found");
    }

    const alignedOffset = Math.floor(offsetInChunk / 4096) * 4096;
    const unalignedPrefix = offsetInChunk - alignedOffset;
    
    const docInfo = getMessageDocumentInfo(messages[0] as Api.Message);
    const type =
      file.mimeType ||
      docInfo.mimeType ||
      mimeTypeFromName(docInfo.fileName || file.chunkFileName || file.name);

    let aborted = false;
    port.onmessage = (e) => {
      if (e.data?.type === "ABORT") {
        aborted = true;
      }
    };

    // Send HEADER first
    port.postMessage({
      type: "HEADER",
      start,
      end,
      totalSize: file.size,
      mimeType: type,
    });

    let isFirstChunk = true;
    let bytesSent = 0;
    
    for await (const chunk of client.iterDownload({
      file: messages[0].media,
      offset: bigInt(alignedOffset),
      limit: limit + unalignedPrefix,
      requestSize: 256 * 1024, // 256KB request chunks for faster progressive delivery
    } as any)) {
      if (aborted) {
        break;
      }
      
      let dataToSend = chunk;
      if (isFirstChunk && unalignedPrefix > 0) {
        dataToSend = chunk.slice(unalignedPrefix);
        isFirstChunk = false;
      }
      if (bytesSent + dataToSend.length > limit) {
        dataToSend = dataToSend.slice(0, limit - bytesSent);
      }
      
      const uint8 = new Uint8Array(dataToSend);
      port.postMessage({
        type: "CHUNK",
        chunk: uint8.buffer,
      }, [uint8.buffer]);
      
      bytesSent += dataToSend.length;
      if (bytesSent >= limit) break;
    }
    
    if (!aborted) {
      port.postMessage({ type: "END" });
    }
    
  } catch (e: any) {
    port.postMessage({ type: "ERROR", error: e.message });
  }
}

async function runWithConcurrency<T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
  const results: T[] = [];
  let index = 0;
  async function worker() {
    while (index < tasks.length) {
      const i = index++;
      results[i] = await tasks[i]();
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }).map(() => worker());
  await Promise.all(workers);
  return results;
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
      return { segments: 2, workers: 4 }; // Safe low-end mobile (8 streams)
    }
    return { segments: 3, workers: 8 }; // Mid-range/high-end mobile (24 streams)
  }

  if (cores >= 8) {
    return { segments: 4, workers: 16 }; // High-performance desktop (64 parallel streams - full speed blitz)
  }
  return { segments: 3, workers: 12 }; // Standard desktop (36 streams)
}

/**
 * Download a segmented file by streaming each chunk through StreamSaver.
 * Falls back to in-memory concatenation when StreamSaver isn't available.
 */
export async function downloadFile(
  client: TelegramClient,
  config: DriveConfig,
  manifest: ChunkManifest,
  onProgress?: (downloaded: number, total: number) => void
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

  try {
    emitProgress();

    // Pre-fetch all chunk messages in a single batch request to save round-trip connection overhead
    const peer = new Api.InputPeerChannel({
      channelId: bigInt(config.chatId),
      accessHash: bigInt(config.accessHash),
    });
    const fetchedMessages = await client.getMessages(peer, { ids: manifest.chunks });
    const messageMap = new Map<number, Api.Message>();
    for (const msg of fetchedMessages) {
      if (msg && msg.className === "Message") {
        messageMap.set(msg.id, msg);
      }
    }

    if (streamsaver) {
      // Streaming download — avoids V8 heap pressure on huge files
      const fileStream = streamsaver.createWriteStream(manifest.fileName, {
        size: manifest.fileSize,
      });
      const writer = fileStream.getWriter();
      const pendingWrites = new Map<number, Uint8Array>();
      let nextWriteIndex = 0;
      let writeLock = Promise.resolve();

      const tasks = manifest.chunks.map((msgId, index) => async () => {
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

        const mediaSize = (message.media as any)?.document?.size || CHUNK_SIZE;
        const idealWorkers = Math.min(4, Math.max(1, Math.ceil(Number(mediaSize) / (1024 * 1024 * 2))));

        let attempts = 0;
        while (attempts < 3) {
          try {
            const buffer = (await client.downloadMedia(message, {
              workers: idealWorkers,
              progressCallback: (dl: any, total: any) => {
                chunkProgress[index] = Number(dl);
              },
            } as any)) as Buffer | undefined;

            if (buffer && buffer.length > 0) {
              chunkProgress[index] = buffer.length;
              const arr = new Uint8Array(buffer);
              writeLock = writeLock.then(async () => {
                pendingWrites.set(index, arr);
                while (pendingWrites.has(nextWriteIndex)) {
                  await writer.write(pendingWrites.get(nextWriteIndex)!);
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

      await runWithConcurrency(tasks, segments);
      await writer.close();
    } else {
      // Fallback: collect all buffers and trigger a download blob
      const tasks = manifest.chunks.map((msgId, index) => async () => {
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

        const mediaSize = (message.media as any)?.document?.size || CHUNK_SIZE;
        const idealWorkers = Math.min(4, Math.max(1, Math.ceil(Number(mediaSize) / (1024 * 1024 * 2))));

        let attempts = 0;
        while (attempts < 3) {
          try {
            const buffer = (await client.downloadMedia(message, {
              workers: idealWorkers,
              progressCallback: (dl: any, total: any) => {
                chunkProgress[index] = Number(dl);
              },
            } as any)) as Buffer | undefined;

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

      const results = await runWithConcurrency(tasks, segments);
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
  } finally {
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
  onProgress?: (downloaded: number, total: number) => void
): Promise<Blob> {
  const { segments } = getDynamicConcurrency();
  const chunkProgress = new Float64Array(manifest.chunks.length);
  const emitProgress = () => {
    const totalDownloaded = chunkProgress.reduce((a, b) => a + b, 0);
    onProgress?.(totalDownloaded, manifest.fileSize);
  };
  const progressInterval = setInterval(emitProgress, 100);

  try {
    emitProgress();

    // Pre-fetch all chunk messages in a single batch request to save round-trip connection overhead
    const peer = new Api.InputPeerChannel({
      channelId: bigInt(config.chatId),
      accessHash: bigInt(config.accessHash),
    });
    const fetchedMessages = await client.getMessages(peer, { ids: manifest.chunks });
    const messageMap = new Map<number, Api.Message>();
    for (const msg of fetchedMessages) {
      if (msg && msg.className === "Message") {
        messageMap.set(msg.id, msg);
      }
    }

    const tasks = manifest.chunks.map((msgId, index) => async () => {
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

      const mediaSize = (message.media as any)?.document?.size || CHUNK_SIZE;
      const idealWorkers = Math.min(4, Math.max(1, Math.ceil(Number(mediaSize) / (1024 * 1024 * 2))));

      let attempts = 0;
      while (attempts < 3) {
        try {
          const buffer = (await client.downloadMedia(message, {
            workers: idealWorkers,
            progressCallback: (dl: any, total: any) => {
              chunkProgress[index] = Number(dl);
            },
          } as any)) as Buffer | undefined;

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

    const results = await runWithConcurrency(tasks, segments);
    results.sort((a, b) => a.index - b.index);

    return new Blob(results.map((r) => r.buffer));
  } finally {
    clearInterval(progressInterval);
    emitProgress(); // final emit
  }
}
