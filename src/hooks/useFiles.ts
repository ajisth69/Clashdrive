import { useState, useCallback, useRef, useEffect } from "react";
import type { TelegramClient } from "telegram";
import { listFilesInTopic } from "../lib/downloader";
import { uploadFile as uploadFileLib } from "../lib/uploader";
import { deleteDriveFile, downloadFile as downloadFileLib, normalizeRenamedFileName, renameDriveFile } from "../lib/downloader";
import { ensureConnected } from "../lib/client";
import type { DriveFile, UploadProgress, DriveConfig, DownloadProgress } from "../types";

async function runWithConcurrency<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number
): Promise<T[]> {
  const results: T[] = [];
  let index = 0;
  async function worker() {
    while (index < tasks.length) {
      const current = index++;
      results[current] = await tasks[current]();
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }).map(() => worker())
  );
  return results;
}

export function useFiles() {
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [indexingProgress, setIndexingProgress] = useState({ current: 0, total: 0 });
  const [uploads, setUploads] = useState<UploadProgress[]>([]);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const fileCache = useRef<Map<number, DriveFile[]>>(new Map());
  const uploadQueue = useRef<(() => Promise<void>)[]>([]);
  const activeUploadCount = useRef<number>(0);
  const MAX_CONCURRENT_UPLOADS = 3;
  const processQueueRef = useRef<() => void>(() => {});

  const uploadAbortControllers = useRef<Map<string, AbortController>>(new Map());
  const downloadAbortControllers = useRef<Map<string, AbortController>>(new Map());

  /**
   * Load files from a given topic. Uses local cache if available.
   */
  const loadFiles = useCallback(
    async (
      client: TelegramClient,
      config: DriveConfig,
      topicId: number,
      force = false
    ) => {
      if (!force && fileCache.current.has(topicId)) {
        setFiles(fileCache.current.get(topicId)!);
        return;
      }

      setLoadingFiles(true);
      await ensureConnected();
      const result = await listFilesInTopic(client, config, topicId);
      fileCache.current.set(topicId, result);
      setFiles(result);
      setLoadingFiles(false);
    },
    []
  );

  useEffect(() => {
    processQueueRef.current = () => {
      if (activeUploadCount.current >= MAX_CONCURRENT_UPLOADS || uploadQueue.current.length === 0) {
        return;
      }

      activeUploadCount.current++;
      const nextTask = uploadQueue.current.shift()!;
      void nextTask().finally(() => {
        activeUploadCount.current--;
        processQueueRef.current();
      });

      if (activeUploadCount.current < MAX_CONCURRENT_UPLOADS && uploadQueue.current.length > 0) {
        processQueueRef.current();
      }
    };
  }, []);

  /**
   * Upload a file to the specified topic.
   */
  const uploadFile = useCallback(
    async (
      client: TelegramClient,
      config: DriveConfig,
      topicId: number,
      file: File
    ) => {
      const fileId = `${file.name}-${Date.now()}`;
      const controller = new AbortController();
      uploadAbortControllers.current.set(fileId, controller);

      // Immediately add a preparing progress entry so it shows up in the UI
      setUploads((prev) => [
        ...prev,
        {
          fileId,
          fileName: file.name,
          totalChunks: Math.ceil(file.size / (50 * 1024 * 1024)),
          uploadedChunks: 0,
          totalBytes: file.size,
          uploadedBytes: 0,
          status: "preparing",
        },
      ]);

      return new Promise<void>((resolve, reject) => {
        const task = async () => {
          try {
            await ensureConnected();
            await uploadFileLib(
              client,
              config,
              topicId,
              file,
              (progress) => {
                setUploads((prev) => {
                  const idx = prev.findIndex((u) => u.fileId === progress.fileId);
                  if (idx >= 0) {
                    const copy = [...prev];
                    copy[idx] = progress;
                    return copy;
                  }
                  return [...prev, progress];
                });
              },
              fileId,
              controller.signal
            );
            resolve();
          } catch (err) {
            reject(err);
          } finally {
            uploadAbortControllers.current.delete(fileId);
            // Auto-clear completed/errored uploads after 2 seconds
            setTimeout(() => {
              setUploads((prev) => prev.filter((u) => u.status === "uploading" || u.status === "preparing"));
            }, 2000);

            // Refresh file list after upload completes
            fileCache.current.delete(topicId);
            await loadFiles(client, config, topicId, true);
          }
        };

        uploadQueue.current.push(task);
        processQueueRef.current();
      });
    },
    [loadFiles]
  );

  /**
   * Cancel an active file upload.
   */
  const cancelUpload = useCallback((fileId: string) => {
    const controller = uploadAbortControllers.current.get(fileId);
    if (controller) {
      controller.abort();
      uploadAbortControllers.current.delete(fileId);
      setUploads((prev) =>
        prev.map((u) =>
          u.fileId === fileId
            ? { ...u, status: "error" as const, error: "Upload cancelled" }
            : u
        )
      );
      // Auto-clear after 2 seconds
      setTimeout(() => {
        setUploads((prev) => prev.filter((u) => u.fileId !== fileId));
      }, 2000);
    }
  }, []);

  /**
   * Download a file by streaming its chunks.
   */
  const downloadFile = useCallback(
    async (client: TelegramClient, config: DriveConfig, file: DriveFile) => {
      downloadAbortControllers.current.forEach((controller) => controller.abort());
      downloadAbortControllers.current.clear();
      const controller = new AbortController();
      const downloadId = `${file.id}-${Date.now()}`;
      downloadAbortControllers.current.set(downloadId, controller);
      const startedAt = performance.now();

      setDownloadProgress({
        name: file.name,
        progress: 0,
        downloadedBytes: 0,
        totalBytes: file.size,
        speedBps: 0,
      });
      try {
        await ensureConnected();
        await downloadFileLib(
          client,
          config,
          file.manifest,
          (downloaded, total) => {
            const elapsedSeconds = Math.max((performance.now() - startedAt) / 1000, 0.001);
            setDownloadProgress({
              name: file.name,
              progress: total > 0 ? Math.round((downloaded / total) * 100) : 0,
              downloadedBytes: downloaded,
              totalBytes: total,
              speedBps: downloaded / elapsedSeconds,
            });
          },
          controller.signal
        );
      } catch (err) {
        console.error("Download failed:", err);
      } finally {
        downloadAbortControllers.current.delete(downloadId);
        setDownloadProgress(null);
      }
    },
    []
  );

  const downloadFilesBatch = useCallback(
    async (client: TelegramClient, config: DriveConfig, filesToDownload: DriveFile[]) => {
      if (filesToDownload.length === 0) return;

      downloadAbortControllers.current.forEach((controller) => controller.abort());
      downloadAbortControllers.current.clear();

      const totalBytes = filesToDownload.reduce((sum, file) => sum + file.size, 0);
      const downloadedById = new Map<number, number>();
      const startedAt = performance.now();
      const label = `${filesToDownload.length} files`;

      const emitProgress = () => {
        const downloadedBytes = Array.from(downloadedById.values()).reduce((sum, bytes) => sum + bytes, 0);
        const elapsedSeconds = Math.max((performance.now() - startedAt) / 1000, 0.001);
        setDownloadProgress({
          name: label,
          progress: totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0,
          downloadedBytes,
          totalBytes,
          speedBps: downloadedBytes / elapsedSeconds,
        });
      };

      setDownloadProgress({
        name: label,
        progress: 0,
        downloadedBytes: 0,
        totalBytes,
        speedBps: 0,
      });

      const tasks = filesToDownload.map((file) => async () => {
        const downloadId = `${file.id}-${Date.now()}`;
        const controller = new AbortController();
        downloadAbortControllers.current.set(downloadId, controller);
        try {
          await ensureConnected();
          await downloadFileLib(
            client,
            config,
            file.manifest,
            (downloaded) => {
              downloadedById.set(file.id, downloaded);
              emitProgress();
            },
            controller.signal
          );
        } catch (err) {
          console.error(`Download failed for ${file.name}:`, err);
        } finally {
          downloadAbortControllers.current.delete(downloadId);
        }
      });

      try {
        await runWithConcurrency(tasks, 3);
      } finally {
        setDownloadProgress(null);
      }
    },
    []
  );

  /**
   * Cancel the active file download.
   */
  const cancelDownload = useCallback(() => {
    downloadAbortControllers.current.forEach((controller) => controller.abort());
    downloadAbortControllers.current.clear();
    setDownloadProgress(null);
  }, []);

  const deleteFile = useCallback(
    async (client: TelegramClient, config: DriveConfig, file: DriveFile) => {
      await ensureConnected();
      const ok = await deleteDriveFile(client, config, file);
      if (!ok) return false;
      fileCache.current.delete(file.topicId);
      setFiles((prev) => prev.filter((item) => item.id !== file.id));
      return true;
    },
    []
  );

  const renameFile = useCallback(
    async (
      client: TelegramClient,
      config: DriveConfig,
      file: DriveFile,
      name: string
    ) => {
      const nextName = normalizeRenamedFileName(file, name);
      if (!nextName) return false;
      await ensureConnected();
      const ok = await renameDriveFile(client, config, file, nextName);
      if (!ok) return false;
      const renamed = {
        ...file,
        name: nextName,
        manifest: { ...file.manifest, fileName: nextName },
      };
      setFiles((prev) =>
        prev.map((item) => (item.id === file.id ? renamed : item))
      );
      const cached = fileCache.current.get(file.topicId);
      if (cached) {
        fileCache.current.set(
          file.topicId,
          cached.map((item) => (item.id === file.id ? renamed : item))
        );
      }
      return true;
    },
    []
  );

  /**
   * Clear completed uploads from the progress list.
   */
  const clearFinishedUploads = useCallback(() => {
    setUploads((prev) => prev.filter((u) => u.status !== "done"));
  }, []);

  /**
   * Client-side search across cached files.
   */
  const filterFiles = useCallback(
    (query: string) => {
      if (!query.trim()) return files;
      const q = query.toLowerCase();
      return files.filter((f) => f.name.toLowerCase().includes(q));
    },
    [files]
  );

  /**
   * Scan and cache files from all folders sequentially in the background.
   */
  const indexAllFolders = useCallback(
    async (
      client: TelegramClient,
      config: DriveConfig,
      folders: { id: number; title: string }[]
    ) => {
      if (indexing) return;
      setIndexing(true);
      setIndexingProgress({ current: 0, total: folders.length });

      let count = 0;
      for (const folder of folders) {
        try {
          if (!fileCache.current.has(folder.id)) {
            await ensureConnected();
            const result = await listFilesInTopic(client, config, folder.id);
            fileCache.current.set(folder.id, result);
          }
        } catch (err) {
          console.error(`Failed to index folder ${folder.title}:`, err);
        }
        count++;
        setIndexingProgress({ current: count, total: folders.length });
        // Tiny sleep between topics to bypass rate limits
        await new Promise((r) => setTimeout(r, 100));
      }
      setIndexing(false);
    },
    [indexing]
  );

  /**
   * Return recent uploads from all cached folders.
   */
  const getRecentFiles = useCallback((limit = 6) => {
    const all: DriveFile[] = [];
    fileCache.current.forEach((folderFiles) => {
      all.push(...folderFiles);
    });
    return all.sort((a, b) => b.date - a.date).slice(0, limit);
  }, []);

  /**
   * Return all loaded files in the cache for global statistics.
   */
  const getAllFiles = useCallback(() => {
    const all: DriveFile[] = [];
    fileCache.current.forEach((folderFiles) => {
      all.push(...folderFiles);
    });
    return all;
  }, []);

  /**
   * Bulk deletion of drive files.
   */
  const deleteFilesBatch = useCallback(
    async (client: TelegramClient, config: DriveConfig, filesToDelete: DriveFile[]) => {
      if (filesToDelete.length === 0) return true;

      const topicIds = new Set(filesToDelete.map((f) => f.topicId));
      let allSuccess = true;

      for (const file of filesToDelete) {
        try {
          const ok = await deleteDriveFile(client, config, file);
          if (!ok) allSuccess = false;
        } catch (err) {
          console.error(`Failed to delete file ${file.name}:`, err);
          allSuccess = false;
        }
      }

      // Clear the cache for folders affected
      topicIds.forEach((topicId) => {
        fileCache.current.delete(topicId);
      });

      // Update state for active folder
      setFiles((prev) => {
        const toDeleteIds = new Set(filesToDelete.map((f) => f.id));
        return prev.filter((item) => !toDeleteIds.has(item.id));
      });

      return allSuccess;
    },
    []
  );

  return {
    files,
    loadingFiles,
    uploads,
    downloadProgress,
    loadFiles,
    uploadFile,
    downloadFile,
    downloadFilesBatch,
    cancelUpload,
    cancelDownload,
    deleteFile,
    renameFile,
    clearFinishedUploads,
    filterFiles,
    indexing,
    indexingProgress,
    indexAllFolders,
    getRecentFiles,
    getAllFiles,
    deleteFilesBatch,
  };
}
