import { useState, useCallback, useRef } from "react";
import type { TelegramClient } from "telegram";
import { listFilesInTopic } from "../lib/downloader";
import { uploadFile as uploadFileLib } from "../lib/uploader";
import { deleteDriveFile, downloadFile as downloadFileLib, normalizeRenamedFileName, renameDriveFile } from "../lib/downloader";
import type { DriveFile, UploadProgress, DriveConfig } from "../types";

export function useFiles() {
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [uploads, setUploads] = useState<UploadProgress[]>([]);
  const [downloadProgress, setDownloadProgress] = useState<{
    name: string;
    progress: number;
  } | null>(null);
  const fileCache = useRef<Map<number, DriveFile[]>>(new Map());

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
      const result = await listFilesInTopic(client, config, topicId);
      fileCache.current.set(topicId, result);
      setFiles(result);
      setLoadingFiles(false);
    },
    []
  );

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
      try {
        await uploadFileLib(client, config, topicId, file, (progress) => {
          setUploads((prev) => {
            const idx = prev.findIndex((u) => u.fileId === progress.fileId);
            if (idx >= 0) {
              const copy = [...prev];
              copy[idx] = progress;
              return copy;
            }
            return [...prev, progress];
          });
        });
      } finally {
        // Auto-clear completed/errored uploads after 2 seconds
        setTimeout(() => {
          setUploads((prev) => prev.filter((u) => u.status === "uploading" || u.status === "preparing"));
        }, 2000);
      }

      // Refresh file list after upload completes
      fileCache.current.delete(topicId);
      await loadFiles(client, config, topicId, true);
    },
    [loadFiles]
  );

  /**
   * Download a file by streaming its chunks.
   */
  const downloadFile = useCallback(
    async (client: TelegramClient, config: DriveConfig, file: DriveFile) => {
      setDownloadProgress({ name: file.name, progress: 0 });
      try {
        await downloadFileLib(
          client,
          config,
          file.manifest,
          (downloaded, total) => {
            setDownloadProgress({
              name: file.name,
              progress: total > 0 ? Math.round((downloaded / total) * 100) : 0,
            });
          }
        );
      } catch (err) {
        console.error("Download failed:", err);
      } finally {
        setDownloadProgress(null);
      }
    },
    []
  );

  const deleteFile = useCallback(
    async (client: TelegramClient, config: DriveConfig, file: DriveFile) => {
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

  return {
    files,
    loadingFiles,
    uploads,
    downloadProgress,
    loadFiles,
    uploadFile,
    downloadFile,
    deleteFile,
    renameFile,
    clearFinishedUploads,
    filterFiles,
  };
}
