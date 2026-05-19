import { useState, useRef, useEffect } from "react";
import type { TelegramClient } from "telegram";
import type { DriveConfig, TopicFolder, DriveFile, UploadProgress, SavedAccount, UserProfile } from "../../types";
import { Header } from "../layout/Header";
import { Sidebar } from "./Sidebar";
import { Breadcrumb } from "./Breadcrumb";
import { TopicList } from "./TopicList";
import { FileGrid } from "./FileGrid";
import { UploadZone } from "./UploadZone";
import { CreateFolderModal } from "./CreateFolderModal";
import { ProgressBar } from "../ui/ProgressBar";
import { formatBytes } from "../../lib/manifest";

interface DashboardProps {
  client: TelegramClient;
  driveConfig: DriveConfig;
  topics: TopicFolder[];
  files: DriveFile[];
  loadingFiles: boolean;
  uploads: UploadProgress[];
  downloadProgress: { name: string; progress: number } | null;
  onFolderClick: (id: number) => void;
  onBackToRoot: () => void;
  onCreateFolder: (name: string) => void;
  onRenameFolder: (folder: TopicFolder) => void;
  onDeleteFolder: (id: number) => void;
  onFileDrop: (files: File[]) => void;
  onDownload: (file: DriveFile) => void;
  onRenameFile: (file: DriveFile) => void;
  onDeleteFile: (file: DriveFile) => void;
  onLogout: () => void;
  userProfile: UserProfile | null;
  accounts: SavedAccount[];
  activeAccountId: string | null;
  onAddAccount: () => void;
  onSwitchAccount: (userId: string) => void;
  onRemoveAccount: (userId: string) => void;
  activeFolderId: number | null;
  filterTopics: (q: string) => TopicFolder[];
  filterFiles: (q: string) => DriveFile[];
  onPreview: (file: DriveFile) => void;
}

export function Dashboard({
  driveConfig,
  topics,
  files,
  loadingFiles,
  uploads,
  downloadProgress,
  onFolderClick,
  onBackToRoot,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onFileDrop,
  onDownload,
  onRenameFile,
  onDeleteFile,
  onLogout,
  userProfile,
  accounts,
  activeAccountId,
  onAddAccount,
  onSwitchAccount,
  onRemoveAccount,
  activeFolderId,
  filterTopics,
  filterFiles,
  onPreview,
}: DashboardProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateFolder, setShowCreateFolder] = useState(false);

  const mainRef = useRef<HTMLElement | null>(null);
  const dragCounter = useRef(0);
  const [isDraggingPage, setIsDraggingPage] = useState(false);

  const activeFolder = topics.find((t) => t.id === activeFolderId) ?? null;
  const displayedTopics = searchQuery
    ? filterTopics(searchQuery)
    : topics;
  const displayedFiles = searchQuery
    ? filterFiles(searchQuery)
    : files;

  const activeUploads = uploads.filter(
    (u) => u.status !== "done"
  );

  // Smooth scroll to top on folder navigation change
  useEffect(() => {
    if (mainRef.current) {
      mainRef.current.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [activeFolderId]);

  // Full-page drag and drop listeners
  useEffect(() => {
    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current++;
      if (e.dataTransfer?.items && e.dataTransfer.items.length > 0) {
        setIsDraggingPage(true);
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current--;
      if (dragCounter.current === 0) {
        setIsDraggingPage(false);
      }
    };

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      setIsDraggingPage(false);
      dragCounter.current = 0;
      const droppedFiles = Array.from(e.dataTransfer?.files || []);
      if (droppedFiles.length > 0) {
        onFileDrop(droppedFiles);
      }
    };

    window.addEventListener("dragenter", handleDragEnter);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("drop", handleDrop);

    return () => {
      window.removeEventListener("dragenter", handleDragEnter);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("drop", handleDrop);
    };
  }, [onFileDrop]);

  return (
    <div className="min-h-screen bg-surface-50 flex flex-col relative">
      {/* Full-screen drag wash overlay */}
      {isDraggingPage && (
        <div 
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-brand-500/10 border-4 border-dashed border-brand-400 m-4 rounded-3xl animate-fade-in pointer-events-none"
          style={{ backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}
        >
          <div className="w-24 h-24 rounded-3xl bg-surface-900/80 text-white flex items-center justify-center mb-4 shadow-2xl">
            <svg className="w-12 h-12 text-accent-400 animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          </div>
          <p className="text-white text-xl font-bold">Drop files anywhere to upload</p>
          <p className="text-surface-300 text-sm mt-1">Upload instantly to your active folder</p>
        </div>
      )}

      <Header
        driveTitle={driveConfig.chatTitle}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onLogout={onLogout}
        userProfile={userProfile}
        accounts={accounts}
        activeAccountId={activeAccountId}
        onAddAccount={onAddAccount}
        onSwitchAccount={onSwitchAccount}
        onRemoveAccount={onRemoveAccount}
      />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          folders={topics}
          activeFolderId={activeFolderId}
          onFolderClick={onFolderClick}
          onCreateFolder={() => setShowCreateFolder(true)}
          onBackToRoot={onBackToRoot}
        />

        <main ref={mainRef} className="flex-1 overflow-y-auto p-4 lg:p-6">
          <Breadcrumb
            folderName={activeFolder?.title ?? null}
            onBackToRoot={onBackToRoot}
          />

          {activeFolderId === null ? (
            /* Root view: show folders */
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-surface-900">
                  Folders
                  <span className="text-sm font-normal text-surface-600 ml-2">
                    {displayedTopics.length}
                  </span>
                </h2>
                <button
                  onClick={() => setShowCreateFolder(true)}
                  className="lg:hidden flex items-center gap-1.5 text-sm text-brand-400 hover:text-brand-600 transition-colors font-medium"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 4v16m8-8H4"
                    />
                  </svg>
                  New
                </button>
              </div>

              <TopicList
                folders={displayedTopics}
                onFolderClick={onFolderClick}
                onRenameFolder={onRenameFolder}
                onDeleteFolder={onDeleteFolder}
              />
            </div>
          ) : (
            /* Folder view: show upload zone + files */
            <div className="space-y-6">
              <UploadZone
                onDrop={onFileDrop}
                disabled={activeUploads.length > 0}
              />

              {/* Upload progress indicators */}
              {activeUploads.length > 0 && (
                <div className="space-y-3">
                  {activeUploads.map((u) => (
                    <div
                      key={u.fileId}
                      className="glass rounded-xl p-4 space-y-2 animate-slide-up"
                    >
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-surface-900 font-medium truncate mr-4">
                          {u.fileName}
                        </span>
                        <span className="text-surface-600 text-xs shrink-0 font-mono">
                          {u.status === "uploading"
                            ? `${Math.round((u.uploadedBytes / (u.totalBytes || 1)) * 100)}%`
                            : u.status === "finalizing"
                              ? "Finalizing..."
                              : u.status === "error"
                                ? "Error"
                                : "Preparing..."}
                        </span>
                      </div>
                      <ProgressBar
                        value={
                          u.totalBytes > 0
                            ? (u.uploadedBytes / u.totalBytes) * 100
                            : 0
                        }
                        color={u.status === "error" ? "brand" : "accent"}
                      />
                      <div className="flex justify-between text-[11px] text-surface-600">
                        <span>
                          {formatBytes(u.uploadedBytes)} /{" "}
                          {formatBytes(u.totalBytes)}
                        </span>
                        {u.error && (
                          <span className="text-danger line-clamp-2 break-all max-w-xs" title={u.error}>
                            {u.error}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Download progress */}
              {downloadProgress && (
                <div className="glass rounded-xl p-4 space-y-2 animate-slide-up">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-surface-900 font-medium truncate">
                      ⬇️ {downloadProgress.name}
                    </span>
                    <span className="text-surface-600 text-xs">
                      {downloadProgress.progress}%
                    </span>
                  </div>
                  <ProgressBar
                    value={downloadProgress.progress}
                    color="success"
                  />
                </div>
              )}

              <div>
                <h2 className="text-lg font-bold text-surface-900 mb-4">
                  Files
                  <span className="text-sm font-normal text-surface-600 ml-2">
                    {displayedFiles.length}
                  </span>
                </h2>
                <FileGrid
                  files={displayedFiles}
                  loading={loadingFiles}
                  onDownload={onDownload}
                  onPreview={onPreview}
                  onRename={onRenameFile}
                  onDelete={onDeleteFile}
                />
              </div>
            </div>
          )}
        </main>
      </div>

      <CreateFolderModal
        open={showCreateFolder}
        onClose={() => setShowCreateFolder(false)}
        onSubmit={onCreateFolder}
      />
      
      {/* Mobile-only subtle watermark */}
      <div className="lg:hidden text-center py-4 bg-surface-50 text-[9px] text-surface-500 font-bold uppercase tracking-wider border-t border-surface-200/50">
        ⚡ Made by ajisth
      </div>
    </div>
  );
}
