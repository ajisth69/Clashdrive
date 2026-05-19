import { useEffect, useState, useCallback } from "react";
import { useAuth } from "./hooks/useAuth";
import { useDrive } from "./hooks/useDrive";
import { useFiles } from "./hooks/useFiles";
import { AuthWizard } from "./components/auth/AuthWizard";
import { Dashboard } from "./components/drive/Dashboard";
import { LoadingScreen } from "./components/layout/LoadingScreen";
import { PreviewModal } from "./components/drive/PreviewModal";
import { handleStreamRequest, normalizeRenamedFileName } from "./lib/downloader";

export default function App() {
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
    refreshTopics,
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
    deleteFile,
    renameFile,
    filterFiles,
  } = useFiles();

  const [booting, setBooting] = useState(true);
  const [activeFolderId, setActiveFolderId] = useState<number | null>(null);
  
  // Preview state
  const [previewFile, setPreviewFile] = useState<any | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

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
      handleStreamRequest(client, driveConfig, event, files);
    };

    navigator.serviceWorker?.addEventListener("message", handler);
    return () => navigator.serviceWorker?.removeEventListener("message", handler);
  }, [client, driveConfig, files]);

  // Once connected, kick off the radar scan
  useEffect(() => {
    if (connected && client && !driveConfig && !syncing) {
      initDrive(client);
    }
  }, [connected, client, driveConfig, syncing, initDrive]);

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
    async (id: number) => {
      if (client && confirm("Delete this folder and all its contents?")) {
        await removeFolder(client, id);
        if (activeFolderId === id) {
          setActiveFolderId(null);
        }
      }
    },
    [client, removeFolder, activeFolderId]
  );

  const handleRenameFolder = useCallback(
    async (folder: any) => {
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
      await Promise.all(
        droppedFiles.map((file) =>
          uploadFile(client, driveConfig, activeFolderId, file).catch(console.error)
        )
      );
    },
    [client, driveConfig, activeFolderId, uploadFile]
  );

  const handleDownload = useCallback(
    async (file: any) => {
      if (!client || !driveConfig) return;
      await downloadFile(client, driveConfig, file);
    },
    [client, driveConfig, downloadFile]
  );

  const handleDeleteFile = useCallback(
    async (file: any) => {
      if (!client || !driveConfig) return;
      if (!confirm(`Delete "${file.name}"? This removes the manifest and all chunks from Telegram.`)) return;
      await deleteFile(client, driveConfig, file);
    },
    [client, driveConfig, deleteFile]
  );

  const handleRenameFile = useCallback(
    async (file: any) => {
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
    async (file: any) => {
      if (!client || !driveConfig) return;
      setPreviewFile(file);
      setPreviewUrl(`/stream/${file.id}`);
    },
    [client, driveConfig]
  );

  const handleLogout = useCallback(async () => {
    await logout();
    setActiveFolderId(null);
    setPreviewFile(null);
    setPreviewUrl(null);
    resetDrive();
  }, [logout, resetDrive]);

  const handleAddAccount = useCallback(async () => {
    await beginAddAccount();
    setActiveFolderId(null);
    setPreviewFile(null);
    setPreviewUrl(null);
    resetDrive();
  }, [beginAddAccount, resetDrive]);

  const handleSwitchAccount = useCallback(
    async (userId: string) => {
      await switchAccount(userId);
      setActiveFolderId(null);
      setPreviewFile(null);
      setPreviewUrl(null);
      resetDrive();
    },
    [switchAccount, resetDrive]
  );

  // Boot screen
  if (booting) {
    return (
      <LoadingScreen
        message="TG Cloud Drive"
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
        client={client!}
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
      />
    
    {previewFile && (
      <PreviewModal
        file={previewFile}
        url={previewUrl}
        onClose={() => {
          setPreviewFile(null);
          setPreviewUrl(null);
        }}
      />
    )}
    </>
  );
}
