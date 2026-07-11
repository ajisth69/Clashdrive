import { TelegramClient, Api } from "telegram";
import { CHUNK_SIZE, UPLOAD_WORKERS } from "../config/telegram";
import { buildManifest } from "./manifest";
import type { UploadProgress, DriveConfig } from "../types";
import bigInt from "big-integer";

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

function getErrorMessage(err: unknown) {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err && "message" in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  return "Upload failed";
}

function getFloodWaitSeconds(err: unknown) {
  if (typeof err !== "object" || !err || !("errorMessage" in err)) return null;
  const errorMessage = (err as { errorMessage?: unknown }).errorMessage;
  if (typeof errorMessage !== "string" || !errorMessage.startsWith("FLOOD_WAIT_")) return null;
  return parseInt(errorMessage.split("_").pop() || "", 10) || 30;
}

/**
 * Upload a single blob chunk as a document to the topic.
 */
function getDynamicUploadConcurrency() {
  const cores = navigator.hardwareConcurrency || 4;
  const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

  if (isMobile) {
    if (cores <= 2) {
      return { segments: 1, workers: 4 };
    }
    return { segments: 1, workers: 6 };
  }
  if (cores >= 12) {
    return { segments: 3, workers: 8 };
  }
  if (cores >= 8) {
    return { segments: 2, workers: 8 };
  }
  return { segments: 2, workers: 6 };
}

/**
 * Upload a single blob chunk as a document to the topic.
 */
async function uploadChunk(
  client: TelegramClient,
  peer: Api.TypeInputPeer,
  topicId: number,
  blob: Blob,
  partIndex: number,
  fileName: string,
  workersLimit: number,
  onChunkProgress?: (progress: number) => void,
  signal?: AbortSignal
): Promise<number> {
  const fileToUpload = new File(
    [blob],
    `${fileName}.part${String(partIndex).padStart(4, "0")}`
  );

  const idealWorkers = Math.min(workersLimit, Math.max(6, Math.ceil(blob.size / (1024 * 1024 * 1.5))));

  const uploaded = await client.uploadFile({
    file: fileToUpload,
    workers: idealWorkers,
    onProgress: (progress: number) => {
      onChunkProgress?.(progress);
    },
  });

  if (signal?.aborted) {
    throw new DOMException("Upload cancelled", "AbortError");
  }

  const result = await client.invoke(
    new Api.messages.SendMedia({
      peer,
      replyTo: new Api.InputReplyToMessage({ replyToMsgId: topicId }),
      media: new Api.InputMediaUploadedDocument({
        file: uploaded,
        mimeType: "application/octet-stream",
        attributes: [
          new Api.DocumentAttributeFilename({
            fileName: `${fileName}.part${String(partIndex).padStart(4, "0")}`,
          }),
        ],
      }),
      message: "",
      randomId: bigInt(Math.floor(Math.random() * 0xffffffffffff)),
    })
  );

  // Extract the message ID from the returned Updates
  const updates = result as Api.Updates;
  for (const upd of updates.updates) {
    if (upd.className === "UpdateNewChannelMessage") {
      return (upd as Api.UpdateNewChannelMessage).message.id;
    }
  }
  throw new Error("Could not extract message ID from upload response");
}

/**
 * Orchestrate a full segmented file upload.
 *
 * 1. Slice the file into CHUNK_SIZE pieces
 * 2. Upload each chunk sequentially (to preserve order & avoid FloodWait)
 * 3. Send the manifest JSON as a final message
 */
export async function uploadFile(
  client: TelegramClient,
  config: DriveConfig,
  topicId: number,
  file: File,
  onProgress?: (p: UploadProgress) => void,
  fileId?: string,
  signal?: AbortSignal
): Promise<void> {
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const finalFileId = fileId || `${file.name}-${Date.now()}`;

  const peer = new Api.InputPeerChannel({ channelId: bigInt(config.chatId), accessHash: bigInt(config.accessHash) });

  // Shared per-chunk byte progress tracker (written by callbacks, read by poller)
  const chunkProgress = new Float64Array(totalChunks);
  let currentStatus: UploadProgress["status"] = "preparing";
  let currentError: string | undefined;
  const startedAt = performance.now();
  
  // Track uploaded message IDs for cleanup on cancellation
  const uploadedMsgIds: number[] = [];

  const emitProgress = () => {
    const totalUploadedBytes = chunkProgress.reduce((a, b) => a + b, 0);
    const elapsedSeconds = Math.max((performance.now() - startedAt) / 1000, 0.001);
    const uploadedChunks = Array.from(chunkProgress).filter((bytes, index) => {
      const chunkSize = Math.min(CHUNK_SIZE, file.size - index * CHUNK_SIZE);
      return chunkSize > 0 && bytes >= chunkSize;
    }).length;
    onProgress?.({
      fileId: finalFileId,
      fileName: file.name,
      totalChunks,
      uploadedChunks,
      totalBytes: file.size,
      uploadedBytes: Math.min(totalUploadedBytes, file.size),
      speedBps: Math.min(totalUploadedBytes, file.size) / elapsedSeconds,
      status: currentStatus,
      error: currentError,
    });
  };

  // Start a 100ms polling interval so the UI always gets smooth updates
  // even when GramJS batches its internal progress callbacks
  const progressInterval = setInterval(emitProgress, 100);

  const { segments, workers } = getDynamicUploadConcurrency();

  let abortPromise: Promise<never> | null = null;
  let abortHandler: (() => void) | null = null;
  if (signal) {
    abortPromise = new Promise((_, reject) => {
      abortHandler = () => reject(new DOMException("Upload cancelled", "AbortError"));
      signal.addEventListener("abort", abortHandler);
    });
  }

  try {
    if (signal?.aborted) {
      throw new DOMException("Upload cancelled", "AbortError");
    }
    emitProgress();

    const tasks = Array.from({ length: totalChunks }).map((_, i) => async () => {
      if (signal?.aborted) {
        throw new DOMException("Upload cancelled", "AbortError");
      }
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const blob = file.slice(start, end);

      let attempts = 0;
      while (attempts < 3) {
        if (signal?.aborted) {
          throw new DOMException("Upload cancelled", "AbortError");
        }
        try {
          currentStatus = "uploading";
          const msgId = await uploadChunk(
            client,
            peer,
            topicId,
            blob,
            i,
            file.name,
            workers,
            (progress) => {
              chunkProgress[i] = progress * blob.size;
            },
            signal
          );
          if (signal?.aborted) {
            client.invoke(
              new Api.channels.DeleteMessages({
                channel: peer,
                id: [msgId],
              })
            ).catch(() => {});
            throw new DOMException("Upload cancelled", "AbortError");
          }
          // Register message ID for potential cleanup
          uploadedMsgIds.push(msgId);
          // Mark chunk fully done
          chunkProgress[i] = blob.size;
          return { index: i, msgId };
        } catch (err: unknown) {
          if (signal?.aborted) {
            throw new DOMException("Upload cancelled", "AbortError");
          }
          const floodWaitSeconds = getFloodWaitSeconds(err);
          if (floodWaitSeconds !== null) {
            const wait = floodWaitSeconds;
            console.warn(`FloodWait: sleeping ${wait}s then retrying chunk ${i}`);
            await new Promise((r) => setTimeout(r, wait * 1000));
            attempts++;
            continue;
          }
          attempts++;
          if (attempts < 3) {
            console.warn(`Upload chunk ${i} failed, retrying...`, err);
            await new Promise((r) => setTimeout(r, 1000 * attempts));
            continue;
          }
          currentStatus = "error";
          currentError = getErrorMessage(err);
          emitProgress();
          throw err;
        }
      }
      currentStatus = "error";
      currentError = `Failed to upload chunk ${i}`;
      emitProgress();
      throw new Error(`Failed to upload chunk ${i}`);
    });

    let results: any[];
    const uploadPromise = runWithConcurrency(tasks, segments, signal);
    if (abortPromise) {
      results = await Promise.race([uploadPromise, abortPromise]);
    } else {
      results = await uploadPromise;
    }
    results.sort((a, b) => a.index - b.index);
    const chunkMsgIds = results.map((r) => r.msgId);

    if (signal?.aborted) {
      throw new DOMException("Upload cancelled", "AbortError");
    }

    // Send the manifest message
    currentStatus = "finalizing";
    emitProgress();
    const manifestJson = buildManifest(file.name, file.size, chunkMsgIds);

    await client.invoke(
      new Api.messages.SendMessage({
        peer,
        replyTo: new Api.InputReplyToMessage({ replyToMsgId: topicId }),
        message: manifestJson,
        randomId: bigInt(Math.floor(Math.random() * 0xffffffffffff)),
      })
    );

    currentStatus = "done";
    emitProgress();
  } catch (err: unknown) {
    const isAbort =
      signal?.aborted ||
      (err instanceof DOMException && err.name === "AbortError") ||
      (err instanceof Error && err.message === "Upload cancelled");
    if (isAbort) {
      currentStatus = "error";
      currentError = "Upload cancelled";
      emitProgress();
    }

    // Clean up uploaded orphaned chunks from Telegram
    if (uploadedMsgIds.length > 0) {
      client.invoke(
        new Api.channels.DeleteMessages({
          channel: peer,
          id: uploadedMsgIds,
        })
      ).catch((deleteErr) => {
        console.warn("Failed to delete orphaned chunks after cancellation:", deleteErr);
      });
    }

    throw err;
  } finally {
    if (signal && abortHandler) {
      signal.removeEventListener("abort", abortHandler);
    }
    clearInterval(progressInterval);
  }
}
