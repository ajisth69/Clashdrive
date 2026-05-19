import { TelegramClient, Api } from "telegram";
import { CHUNK_SIZE } from "../config/telegram";
import { buildManifest } from "./manifest";
import type { UploadProgress, DriveConfig } from "../types";
import bigInt from "big-integer";

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
 * Upload a single blob chunk as a document to the topic.
 */
async function uploadChunk(
  client: TelegramClient,
  peer: Api.TypeInputPeer,
  topicId: number,
  blob: Blob,
  partIndex: number,
  fileName: string,
  onChunkProgress?: (progress: number) => void
): Promise<number> {
  const fileToUpload = new File(
    [blob],
    `${fileName}.part${String(partIndex).padStart(4, "0")}`
  );

  const idealWorkers = Math.min(16, Math.max(6, Math.ceil(blob.size / (1024 * 1024 * 1.5))));

  const uploaded = await client.uploadFile({
    file: fileToUpload,
    workers: idealWorkers,
    onProgress: (progress: number) => {
      onChunkProgress?.(progress);
    },
  });

  // @ts-ignore — replyTo with InputReplyToMessage works at runtime in GramJS
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
  fileId?: string
): Promise<void> {
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const finalFileId = fileId || `${file.name}-${Date.now()}`;

  const peer = new Api.InputPeerChannel({ channelId: bigInt(config.chatId), accessHash: bigInt(config.accessHash) });

  // Shared per-chunk byte progress tracker (written by callbacks, read by poller)
  const chunkProgress = new Float64Array(totalChunks);
  let currentStatus: UploadProgress["status"] = "preparing";
  let currentError: string | undefined;

  const emitProgress = () => {
    const totalUploadedBytes = chunkProgress.reduce((a, b) => a + b, 0);
    onProgress?.({
      fileId: finalFileId,
      fileName: file.name,
      totalChunks,
      uploadedChunks: Math.floor(totalUploadedBytes / CHUNK_SIZE),
      totalBytes: file.size,
      uploadedBytes: Math.min(totalUploadedBytes, file.size),
      status: currentStatus,
      error: currentError,
    });
  };

  // Start a 100ms polling interval so the UI always gets smooth updates
  // even when GramJS batches its internal progress callbacks
  const progressInterval = setInterval(emitProgress, 100);

  try {
    emitProgress();

    const tasks = Array.from({ length: totalChunks }).map((_, i) => async () => {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const blob = file.slice(start, end);

      let attempts = 0;
      while (true) {
        try {
          currentStatus = "uploading";
          const msgId = await uploadChunk(
            client,
            peer,
            topicId,
            blob,
            i,
            file.name,
            (progress) => {
              chunkProgress[i] = progress * blob.size;
            }
          );
          // Mark chunk fully done
          chunkProgress[i] = blob.size;
          return { index: i, msgId };
        } catch (err: any) {
          if (err?.errorMessage?.startsWith("FLOOD_WAIT_")) {
            const wait = parseInt(err.errorMessage.split("_").pop()!, 10) || 30;
            console.warn(`FloodWait: sleeping ${wait}s then retrying chunk ${i}`);
            await new Promise((r) => setTimeout(r, wait * 1000));
            attempts++;
            continue;
          }
          currentStatus = "error";
          currentError = err.message;
          emitProgress();
          throw err;
        }
      }
    });

    const results = await runWithConcurrency(tasks, 4);
    results.sort((a, b) => a.index - b.index);
    const chunkMsgIds = results.map((r) => r.msgId);

    // Send the manifest message
    currentStatus = "finalizing";
    emitProgress();
    const manifestJson = buildManifest(file.name, file.size, chunkMsgIds);

    // @ts-ignore — replyTo with InputReplyToMessage works at runtime in GramJS
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
  } finally {
    clearInterval(progressInterval);
  }
}
