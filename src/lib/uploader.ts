import { TelegramClient, Api } from "telegram";
import { CHUNK_SIZE, UPLOAD_WORKERS } from "../config/telegram";
import { buildManifest } from "./manifest";
import type { UploadProgress, DriveConfig } from "../types";
import bigInt from "big-integer";
import { getHelperClient } from "./client";

export function generateVideoThumbnail(file: File | Blob): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;

    const url = URL.createObjectURL(file);

    const cleanUp = () => {
      video.onseeked = null;
      video.onloadedmetadata = null;
      video.onerror = null;
      URL.revokeObjectURL(url);
      video.src = "";
      video.load();
    };

    video.onerror = () => {
      cleanUp();
      reject(new Error("Failed to load video for thumbnail extraction"));
    };

    video.onloadedmetadata = () => {
      video.currentTime = 1.0;
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement("canvas");
        const width = 640;
        const height = (video.videoHeight / video.videoWidth) * width || 480;
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          cleanUp();
          reject(new Error("Failed to get 2D context"));
          return;
        }
        ctx.drawImage(video, 0, 0, width, height);
        canvas.toBlob((blob) => {
          cleanUp();
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error("Failed to create blob from canvas"));
          }
        }, "image/jpeg", 0.7);
      } catch (err) {
        cleanUp();
        reject(err);
      }
    };

    video.src = url;
  });
}

export function generateImageThumbnail(file: File | Blob): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    const cleanUp = () => {
      img.onload = null;
      img.onerror = null;
      URL.revokeObjectURL(url);
    };

    img.onerror = () => {
      cleanUp();
      reject(new Error("Failed to load image for resizing"));
    };

    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const maxDim = 1200;
        let width = img.width;
        let height = img.height;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = (height / width) * maxDim;
            width = maxDim;
          } else {
            width = (width / height) * maxDim;
            height = maxDim;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          cleanUp();
          reject(new Error("Failed to get canvas 2D context"));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          cleanUp();
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error("Failed to create blob from canvas"));
          }
        }, "image/jpeg", 0.85);
      } catch (err) {
        cleanUp();
        reject(err);
      }
    };

    img.src = url;
  });
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

  if (cores >= 12) {
    return { segments: 4, workers: 16 };
  }
  if (cores >= 8) {
    return { segments: 3, workers: 12 };
  }
  return { segments: 2, workers: 8 };
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

    let thumbMsgId: number | undefined;

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const isVideo = ["mp4","mkv","avi","mov","webm","flv","3gp","ts","mts","m2ts"].includes(ext);
    const isImage = ["png","jpg","jpeg","gif","webp","svg","bmp","avif","heic","tiff"].includes(ext);

    if (isVideo || (isImage && file.size > 3 * 1024 * 1024)) {
      try {
        currentStatus = "preparing";
        emitProgress();

        let thumbBlob: Blob;
        if (isVideo) {
          thumbBlob = await generateVideoThumbnail(file);
        } else {
          thumbBlob = await generateImageThumbnail(file);
        }

        const thumbFile = new File([thumbBlob], `${file.name}.thumb.jpg`);
        const uploadedThumb = await client.uploadFile({
          file: thumbFile,
          workers: 4,
        });

        const thumbResult = await client.invoke(
          new Api.messages.SendMedia({
            peer,
            replyTo: new Api.InputReplyToMessage({ replyToMsgId: topicId }),
            media: new Api.InputMediaUploadedDocument({
              file: uploadedThumb,
              mimeType: "image/jpeg",
              attributes: [
                new Api.DocumentAttributeFilename({
                  fileName: thumbFile.name,
                }),
              ],
            }),
            message: "",
            randomId: bigInt(Math.floor(Math.random() * 0xffffffffffff)),
          })
        );

        const thumbUpdates = thumbResult as Api.Updates;
        for (const upd of thumbUpdates.updates) {
          if (upd.className === "UpdateNewChannelMessage") {
            thumbMsgId = (upd as Api.UpdateNewChannelMessage).message.id;
            uploadedMsgIds.push(thumbMsgId);
            break;
          }
        }
      } catch (thumbErr) {
        console.warn("Failed to generate or upload thumbnail, proceeding without it:", thumbErr);
      }
    }

    const tasks = Array.from({ length: totalChunks }).map((_, i) => async () => {
      if (signal?.aborted) {
        throw new DOMException("Upload cancelled", "AbortError");
      }
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const blob = file.slice(start, end);

      let attempts = 0;
      while (attempts < 5) {
        if (signal?.aborted) {
          throw new DOMException("Upload cancelled", "AbortError");
        }
        try {
          currentStatus = "uploading";
          const activeClient = await getHelperClient(i % 3);
          const msgId = await uploadChunk(
            activeClient,
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
            activeClient.invoke(
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
          if (attempts < 5) {
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

    currentStatus = "finalizing";
    emitProgress();

    const manifestJson = buildManifest(file.name, file.size, chunkMsgIds, thumbMsgId);

    const sentResult = await client.invoke(
      new Api.messages.SendMessage({
        peer,
        replyTo: new Api.InputReplyToMessage({ replyToMsgId: topicId }),
        message: manifestJson,
        randomId: bigInt(Math.floor(Math.random() * 0xffffffffffff)),
      })
    );

    let manifestMsgId: number | undefined;
    const sentUpdates = sentResult as Api.Updates;
    if (sentUpdates && sentUpdates.updates) {
      for (const upd of sentUpdates.updates) {
        if (upd.className === "UpdateNewChannelMessage") {
          manifestMsgId = (upd as Api.UpdateNewChannelMessage).message.id;
          break;
        }
      }
    }

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
