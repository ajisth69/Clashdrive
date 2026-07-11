import { useEffect, useState, useCallback, useRef } from "react";
import { useAuth } from "./hooks/useAuth";
import { useDrive } from "./hooks/useDrive";
import { useFiles } from "./hooks/useFiles";
import { AuthWizard } from "./components/auth/AuthWizard";
import { Dashboard } from "./components/drive/Dashboard";
import { LoadingScreen } from "./components/layout/LoadingScreen";
import { PreviewModal } from "./components/drive/PreviewModal";
import { handleStreamRequest, normalizeRenamedFileName, downloadFileToMemory, mimeTypeFromName, preFetchMessages } from "./lib/downloader";
import { useTheme } from "./hooks/useTheme";
import type { DriveFile, TopicFolder } from "./types";
import { Api } from "telegram";
import { Modal } from "./components/ui/Modal";

const MB = 1024 * 1024;
const MAX_IMAGE_PREVIEW_BYTES = 80 * MB;
const MAX_OFFICE_PREVIEW_BYTES = 25 * MB;
const MAX_MEMORY_PREVIEW_BYTES = 100 * MB;

function fileExtension(name: string) {
  return name.split(".").pop()?.toLowerCase() || "";
}

function getPreviewKind(file: DriveFile) {
  const ext = fileExtension(file.name);
  const mimeType = file.mimeType || "";

  if (mimeType.startsWith("video/") || ["mp4", "webm", "ogg", "mov"].includes(ext)) return "stream";
  if (mimeType.startsWith("audio/") || ["mp3", "wav", "m4a", "flac", "ogg"].includes(ext)) return "stream";
  if (mimeType === "application/pdf" || ext === "pdf") return "stream";
  if (["txt", "md", "json", "js", "ts", "py", "rs", "go", "html", "css", "xml"].includes(ext)) return "stream";

  if (mimeType.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "image";
  if (["xlsx", "xls", "csv", "docx"].includes(ext)) return "office";

  return "unsupported";
}

async function ensureStreamWorkerReady() {
  if (!("serviceWorker" in navigator)) return false;

  try {
    let registration = await navigator.serviceWorker.getRegistration();
    if (!registration) {
      registration = await navigator.serviceWorker.register(`/sw.js?v=${Date.now()}`);
    }

    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller) return true;

    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, 2500);
      const handleControllerChange = () => {
        window.clearTimeout(timer);
        navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
        resolve();
      };
      navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
    });

    return Boolean(navigator.serviceWorker.controller);
  } catch (err) {
    console.warn("Stream service worker is not ready:", err);
    return false;
  }
}

export default function App() {
  const { theme, setTheme } = useTheme();
  const {
    authState,
    connected,
    client,
    userProfile,
    accounts,
    activeAccountId,
    tryAutoConnect,
    startAuth,
    submitOtp,
    submitPassword,
    beginAddAccount,
    switchAccount,
    removeAccount,
    logout,
  } = useAuth();

  const {
    driveConfig,
    topics,
    syncing,
    syncStatus,
    initDrive,
    addFolder,
    removeFolder,
    renameFolder,
    filterTopics,
    resetDrive,
  } = useDrive();

  const {
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
    filterFiles,
    indexing,
    indexingProgress,
    indexAllFolders,
    getRecentFiles,
    getAllFiles,
    deleteFilesBatch,
  } = useFiles();

  const [booting, setBooting] = useState(true);
  const [activeFolderId, setActiveFolderId] = useState<number | null>(null);
  
  // Preview state
  const [previewFile, setPreviewFile] = useState<DriveFile | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewProgress, setPreviewProgress] = useState<number | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewFileRef = useRef<DriveFile | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  const previewRequestId = useRef(0);
  const previewAbortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    previewFileRef.current = previewFile;
  }, [previewFile]);

  useEffect(() => {
    previewUrlRef.current = previewUrl;
  }, [previewUrl]);

  const revokePreviewBlobUrl = useCallback(() => {
    if (previewUrlRef.current?.startsWith("blob:")) {
      URL.revokeObjectURL(previewUrlRef.current);
    }
    previewUrlRef.current = null;
  }, []);

  // Toast & Custom Confirm modal states
  const [toast, setToast] = useState<{
    show: boolean;
    message: string;
    type: "success" | "error" | "info";
  }>({ show: false, message: "", type: "info" });
  const toastTimeoutRef = useRef<number | null>(null);

  const triggerToast = useCallback((message: string, type: "success" | "error" | "info" = "info") => {
    if (toastTimeoutRef.current) {
      window.clearTimeout(toastTimeoutRef.current);
    }
    setToast({ show: true, message, type });
    toastTimeoutRef.current = window.setTimeout(() => {
      setToast((t) => ({ ...t, show: false }));
    }, 4000);
  }, []);

  const [confirmState, setConfirmState] = useState<{
    show: boolean;
    title: string;
    message: string;
    onConfirm: () => void | Promise<void>;
  }>({
    show: false,
    title: "",
    message: "",
    onConfirm: () => {},
  });

  const triggerConfirm = useCallback((title: string, message: string, onConfirm: () => void | Promise<void>) => {
    setConfirmState({
      show: true,
      title,
      message,
      onConfirm: async () => {
        setConfirmState((prev) => ({ ...prev, show: false }));
        await onConfirm();
      },
    });
  }, []);

  const [showJoinPrompt, setShowJoinPrompt] = useState(false);
  const [joiningChannel, setJoiningChannel] = useState(false);

  // Auto-prompt join updates channel if first time login
  useEffect(() => {
    if (connected && userProfile?.id) {
      const prompted = localStorage.getItem(`tgcd_prompted_join_${userProfile.id}`);
      if (prompted !== "true") {
        setShowJoinPrompt(true);
      }
    }
  }, [connected, userProfile]);

  const handleJoinUpdateChannel = useCallback(async () => {
    if (!client || !userProfile?.id) return;
    setJoiningChannel(true);
    try {
      const entity = await client.getEntity("clashgramclient");
      await client.invoke(new Api.channels.JoinChannel({ channel: entity }));
      triggerToast("Successfully joined Clashgram Update Channel! Thank you for your support.", "success");
    } catch (err) {
      console.warn("Failed to join channel automatically:", err);
      triggerToast("Auto-join failed. Opening updates channel page...", "info");
      // Fallback: open link in new tab
      window.open("https://t.me/clashgramclient", "_blank");
    } finally {
      localStorage.setItem(`tgcd_prompted_join_${userProfile.id}`, "true");
      setJoiningChannel(false);
      setShowJoinPrompt(false);
    }
  }, [client, userProfile, triggerToast]);

  const handleSkipJoinChannel = useCallback(() => {
    if (userProfile?.id) {
      localStorage.setItem(`tgcd_prompted_join_${userProfile.id}`, "true");
    }
    setShowJoinPrompt(false);
  }, [userProfile]);

  // Auto-connect on mount
  useEffect(() => {
    (async () => {
      await tryAutoConnect();
      setBooting(false);
    })();
  }, [tryAutoConnect]);

  // Handle Service Worker streaming requests
  useEffect(() => {
    if (!client || !driveConfig) return;

    const handler = (event: MessageEvent) => {
      const currentPreviewFile = previewFileRef.current;
      const streamFiles = [
        ...(currentPreviewFile ? [currentPreviewFile] : []),
        ...files,
        ...getAllFiles(),
      ];
      handleStreamRequest(client, driveConfig, event, streamFiles);
    };

    navigator.serviceWorker?.addEventListener("message", handler);
    return () => navigator.serviceWorker?.removeEventListener("message", handler);
  }, [client, driveConfig, files, getAllFiles]);

  // Once connected, kick off the radar scan
  useEffect(() => {
    if (connected && client && !driveConfig && !syncing) {
      initDrive(client);
    }
  }, [connected, client, driveConfig, syncing, initDrive]);

  // Index all folders in the background when the drive is loaded
  useEffect(() => {
    if (client && driveConfig && topics.length > 0 && !indexing) {
      indexAllFolders(client, driveConfig, topics);
    }
  }, [client, driveConfig, topics, indexAllFolders]);

  // When user navigates into a folder, load its files
  useEffect(() => {
    if (client && driveConfig && activeFolderId !== null) {
      loadFiles(client, driveConfig, activeFolderId);
    }
  }, [client, driveConfig, activeFolderId, loadFiles]);

  const handleFolderClick = useCallback((id: number) => {
    setActiveFolderId(id);
  }, []);

  const handleBackToRoot = useCallback(() => {
    setActiveFolderId(null);
  }, []);

  const handleCreateFolder = useCallback(
    async (name: string) => {
      if (client) {
        await addFolder(client, name);
      }
    },
    [client, addFolder]
  );

  const handleDeleteFolder = useCallback(
    (id: number) => {
      if (client) {
        triggerConfirm(
          "Delete Folder",
          "Are you sure you want to delete this folder and all its contents? This will permanently remove the folder from your drive.",
          async () => {
            await removeFolder(client, id);
            if (activeFolderId === id) {
              setActiveFolderId(null);
            }
            triggerToast("Folder deleted successfully.", "success");
          }
        );
      }
    },
    [client, removeFolder, activeFolderId, triggerConfirm, triggerToast]
  );

  const handleRenameFolder = useCallback(
    async (folder: TopicFolder) => {
      if (!client) return;
      const nextName = prompt("Rename folder", folder.title)?.trim();
      if (!nextName || nextName === folder.title) return;
      await renameFolder(client, folder.id, nextName);
    },
    [client, renameFolder]
  );

  const handleFileDrop = useCallback(
    async (droppedFiles: File[]) => {
      if (!client || !driveConfig || activeFolderId === null) return;
      const results = await Promise.allSettled(
        droppedFiles.map((file) => uploadFile(client, driveConfig, activeFolderId, file))
      );

      results.forEach((result, index) => {
        if (result.status === "rejected") {
          console.error(`Failed to upload ${droppedFiles[index].name}:`, result.reason);
        }
      });
    },
    [client, driveConfig, activeFolderId, uploadFile]
  );

  const handleDownload = useCallback(
    async (file: DriveFile) => {
      if (!client || !driveConfig) return;
      await downloadFile(client, driveConfig, file);
    },
    [client, driveConfig, downloadFile]
  );

  const handleDeleteFile = useCallback(
    (file: DriveFile) => {
      if (!client || !driveConfig) return;
      triggerConfirm(
        "Delete File",
        `Are you sure you want to delete "${file.name}"? This removes the manifest and all associated file chunks from Telegram.`,
        async () => {
          await deleteFile(client, driveConfig, file);
          triggerToast("File deleted successfully.", "success");
        }
      );
    },
    [client, driveConfig, deleteFile, triggerConfirm, triggerToast]
  );

  const handleRenameFile = useCallback(
    async (file: DriveFile) => {
      if (!client || !driveConfig) return;
      const rawName = prompt("Rename file", file.name)?.trim();
      if (!rawName || rawName === file.name) return;

      const nextName = normalizeRenamedFileName(file, rawName);
      if (!nextName || nextName === file.name) return;

      await renameFile(client, driveConfig, file, nextName);
      if (previewFile?.id === file.id) {
        setPreviewFile({
          ...file,
          name: nextName,
          manifest: { ...file.manifest, fileName: nextName },
        });
      }
    },
    [client, driveConfig, renameFile, previewFile]
  );

  const handlePreview = useCallback(
    async (file: DriveFile) => {
      if (!client || !driveConfig) return;

      if (previewAbortControllerRef.current) {
        previewAbortControllerRef.current.abort();
      }
      const controller = new AbortController();
      previewAbortControllerRef.current = controller;

      const requestId = previewRequestId.current + 1;
      previewRequestId.current = requestId;
      previewFileRef.current = file;

      revokePreviewBlobUrl();
      setPreviewFile(file);
      setPreviewUrl(null);
      setPreviewError(null);

      const previewKind = getPreviewKind(file);
      const isCurrentPreview = () =>
        previewRequestId.current === requestId && previewFileRef.current?.id === file.id;

      if (previewKind === "unsupported") {
        setPreviewProgress(null);
        setPreviewError("Preview is not available for this file type. Download it to open it locally.");
        return;
      }

      if (previewKind === "office" && file.size > MAX_OFFICE_PREVIEW_BYTES) {
        setPreviewProgress(null);
        setPreviewError("This document is too large for a reliable in-browser preview. Download it to open it locally.");
        return;
      }

      if (previewKind === "image" && file.size > MAX_IMAGE_PREVIEW_BYTES) {
        setPreviewProgress(null);
        setPreviewError("This image is too large for a safe in-browser preview. Download it to view the full file.");
        return;
      }

      if (previewKind === "stream") {
        setPreviewProgress(null);
        try {
          const streamReady = await ensureStreamWorkerReady();
          if (!isCurrentPreview()) return;

          if (!streamReady) {
            throw new Error("The browser stream worker is not ready yet. Refresh once and try again.");
          }

          setPreviewUrl(`/stream/${file.id}`);

          preFetchMessages(client, driveConfig, file.manifest).catch((err) => {
            console.warn("Message prefetch failed; live stream will fetch on demand:", err);
          });
        } catch (err) {
          console.error("Streaming preview failed:", err);
          if (isCurrentPreview()) {
            setPreviewProgress(null);
            setPreviewError(err instanceof Error ? err.message : "Could not open the streaming preview.");
          }
        }
        return;
      }

      if (file.size > MAX_MEMORY_PREVIEW_BYTES) {
        setPreviewProgress(null);
        setPreviewError("This file is too large for a memory preview. Download it to open it locally.");
        return;
      }

      setPreviewProgress(0);
      try {
        const blob = await downloadFileToMemory(client, driveConfig, file.manifest, (downloaded, total) => {
          if (isCurrentPreview()) {
            setPreviewProgress(total > 0 ? Math.round((downloaded / total) * 100) : 0);
          }
        }, controller.signal);
        if (!isCurrentPreview()) return;

        let mime = file.mimeType || mimeTypeFromName(file.name);
        if (mime === "application/octet-stream") {
          mime = mimeTypeFromName(file.name);
        }
        const typedBlob = new Blob([blob], { type: mime });
        const blobUrl = URL.createObjectURL(typedBlob);
        previewUrlRef.current = blobUrl;
        setPreviewUrl(blobUrl);
        setPreviewProgress(null);
      } catch (err) {
        console.error("Preview download failed:", err);
        if (isCurrentPreview()) {
          setPreviewProgress(null);
          setPreviewError(err instanceof Error ? err.message : "Preview download failed.");
        }
      } finally {
        if (previewAbortControllerRef.current === controller) {
          previewAbortControllerRef.current = null;
        }
      }
    },
    [client, driveConfig, revokePreviewBlobUrl]
  );

  const handleLogout = useCallback(async () => {
    await logout();
    setActiveFolderId(null);
    previewRequestId.current += 1;
    previewFileRef.current = null;
    revokePreviewBlobUrl();
    setPreviewFile(null);
    setPreviewUrl(null);
    setPreviewProgress(null);
    setPreviewError(null);
    resetDrive();
  }, [logout, resetDrive, revokePreviewBlobUrl]);

  const handleAddAccount = useCallback(async () => {
    await beginAddAccount();
    setActiveFolderId(null);
    previewRequestId.current += 1;
    previewFileRef.current = null;
    revokePreviewBlobUrl();
    setPreviewFile(null);
    setPreviewUrl(null);
    setPreviewProgress(null);
    setPreviewError(null);
    resetDrive();
  }, [beginAddAccount, resetDrive, revokePreviewBlobUrl]);

  const handleSwitchAccount = useCallback(
    async (userId: string) => {
      await switchAccount(userId);
      setActiveFolderId(null);
      previewRequestId.current += 1;
      previewFileRef.current = null;
      revokePreviewBlobUrl();
      setPreviewFile(null);
      setPreviewUrl(null);
      setPreviewProgress(null);
      setPreviewError(null);
      resetDrive();
    },
    [switchAccount, resetDrive, revokePreviewBlobUrl]
  );

  // Boot screen
  if (booting) {
    return (
      <LoadingScreen
        message="Clash Drive"
        subtext="Checking your session..."
      />
    );
  }

  // Not connected — show auth wizard
  if (!connected) {
    return (
      <AuthWizard
        state={authState}
        onPhoneSubmit={startAuth}
        onOtpSubmit={submitOtp}
        onPasswordSubmit={submitPassword}
      />
    );
  }

  // Syncing drive
  if (syncing || !driveConfig) {
    return (
      <LoadingScreen
        message="Setting up your drive"
        subtext={syncStatus || "Connecting to Telegram network..."}
      />
    );
  }

  // Main dashboard
  return (
    <>
      <Dashboard
        driveConfig={driveConfig}
        topics={topics}
        files={files}
        loadingFiles={loadingFiles}
        uploads={uploads}
        downloadProgress={downloadProgress}
        onFolderClick={handleFolderClick}
        onBackToRoot={handleBackToRoot}
        onCreateFolder={handleCreateFolder}
        onRenameFolder={handleRenameFolder}
        onDeleteFolder={handleDeleteFolder}
        onFileDrop={handleFileDrop}
        onDownload={handleDownload}
        onDownloadFilesBatch={(filesToDownload) => downloadFilesBatch(client!, driveConfig!, filesToDownload)}
        onCancelUpload={cancelUpload}
        onCancelDownload={cancelDownload}
        onRenameFile={handleRenameFile}
        onDeleteFile={handleDeleteFile}
        onLogout={handleLogout}
        userProfile={userProfile}
        accounts={accounts}
        activeAccountId={activeAccountId}
        onAddAccount={handleAddAccount}
        onSwitchAccount={handleSwitchAccount}
        onRemoveAccount={removeAccount}
        activeFolderId={activeFolderId}
        filterTopics={filterTopics}
        filterFiles={filterFiles}
        onPreview={handlePreview}
        allFiles={getAllFiles()}
        recentFiles={getRecentFiles(6)}
        indexing={indexing}
        indexingProgress={indexingProgress}
        onDeleteFilesBatch={(filesToDel) => deleteFilesBatch(client!, driveConfig!, filesToDel)}
        theme={theme}
        setTheme={setTheme}
        onJoinUpdateChannel={handleJoinUpdateChannel}
        joiningChannel={joiningChannel}
        triggerConfirm={triggerConfirm}
        triggerToast={triggerToast}
      />
    
    {previewFile && (
      <PreviewModal
        key={previewFile.id}
        file={previewFile}
        url={previewUrl}
        progress={previewProgress}
        error={previewError}
        onDownload={() => handleDownload(previewFile)}
        onClose={() => {
          if (previewAbortControllerRef.current) {
            previewAbortControllerRef.current.abort();
            previewAbortControllerRef.current = null;
          }
          previewRequestId.current += 1;
          previewFileRef.current = null;
          revokePreviewBlobUrl();
          setPreviewFile(null);
          setPreviewUrl(null);
          setPreviewProgress(null);
          setPreviewError(null);
        }}
      />
    )}

    <Modal
      open={showJoinPrompt}
      onClose={handleSkipJoinChannel}
      title="Join our Update Channel"
    >
      <div className="space-y-4 text-center sm:text-left select-none">
        <p className="text-sm text-surface-650 dark:text-surface-600 leading-relaxed font-semibold">
          Stay informed with the latest features, releases, and service announcements. Subscribing to our update channel is also a wonderful way to support the development of Clash Drive!
        </p>
        <div className="flex items-center justify-center sm:justify-start gap-2 bg-brand-500/10 text-brand-450 dark:text-brand-400 px-3.5 py-2.5 rounded-2xl border border-brand-500/15 font-bold text-xs">
          <span>Official Channel:</span>
          <span className="font-mono">@clashgramclient</span>
        </div>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 pt-2">
          <button
            onClick={handleSkipJoinChannel}
            disabled={joiningChannel}
            className="px-4.5 py-2.5 rounded-2xl bg-surface-200 dark:bg-surface-300/20 text-surface-700 dark:text-surface-650 text-xs font-bold active:scale-95 transition-all hover:bg-surface-300/50 cursor-pointer"
          >
            No thanks
          </button>
          <button
            onClick={handleJoinUpdateChannel}
            disabled={joiningChannel}
            className="px-5 py-2.5 rounded-2xl bg-brand-500 hover:bg-brand-650 text-white text-xs font-bold shadow-md shadow-brand-500/10 active:scale-95 transition-all cursor-pointer flex items-center justify-center gap-2"
          >
            {joiningChannel ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Joining...</span>
              </>
            ) : (
              <span>Fine</span>
            )}
          </button>
        </div>
      </div>
    </Modal>

    {/* Toast notifications */}
    {toast.show && (
      <div className="fixed top-6 left-1/2 -translate-x-1/2 z-50 animate-slide-down pointer-events-none select-none max-w-[90vw] md:max-w-md w-full px-4">
        <div className="glass rounded-2xl p-4 flex items-center gap-3 border border-surface-300/40 dark:border-surface-300/10 shadow-2xl glow-brand">
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
            toast.type === "success" 
              ? "bg-success/10 text-success" 
              : toast.type === "error" 
                ? "bg-danger/10 text-danger" 
                : "bg-brand-500/10 text-brand-500"
          }`}>
            {toast.type === "success" && (
              <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
            {toast.type === "error" && (
              <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
            {toast.type === "info" && (
              <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
          </div>
          <p className="text-xs font-bold text-surface-900 leading-tight flex-1">
            {toast.message}
          </p>
        </div>
      </div>
    )}

    {/* Custom Confirmation Modal */}
    <Modal
      open={confirmState.show}
      onClose={() => setConfirmState((prev) => ({ ...prev, show: false }))}
      title={confirmState.title}
    >
      <div className="space-y-4 text-center sm:text-left select-none">
        <p className="text-sm text-surface-650 dark:text-surface-600 leading-relaxed font-semibold">
          {confirmState.message}
        </p>
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 pt-2">
          <button
            onClick={() => setConfirmState((prev) => ({ ...prev, show: false }))}
            className="px-4.5 py-2.5 rounded-2xl bg-surface-200 dark:bg-surface-300/20 text-surface-700 dark:text-surface-650 text-xs font-bold active:scale-95 transition-all hover:bg-surface-300/50 cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={confirmState.onConfirm}
            className="px-5 py-2.5 rounded-2xl bg-danger hover:bg-danger-600 text-white text-xs font-bold shadow-md shadow-danger/10 active:scale-95 transition-all cursor-pointer"
          >
            Confirm
          </button>
        </div>
      </div>
    </Modal>
    </>
  );
}
