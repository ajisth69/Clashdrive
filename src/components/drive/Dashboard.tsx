import { useState, useRef, useEffect } from "react";
import type { TelegramClient } from "telegram";
import type { DriveConfig, TopicFolder, DriveFile, UploadProgress, DownloadProgress, SavedAccount, UserProfile } from "../../types";
import type { Theme } from "../../hooks/useTheme";
import { Header } from "../layout/Header";
import { Sidebar } from "./Sidebar";
import { Breadcrumb } from "./Breadcrumb";
import { TopicList } from "./TopicList";
import { FileGrid } from "./FileGrid";
import { UploadZone } from "./UploadZone";
import { CreateFolderModal } from "./CreateFolderModal";
import { ProgressBar } from "../ui/ProgressBar";
import { formatBytes } from "../../lib/manifest";
import { FileIcon } from "./FileIcon";
import { FileCardThumbnail } from "./FileCardThumbnail";
import { MoveCopyModal } from "./MoveCopyModal";
import { FileInfoModal } from "./FileInfoModal";
import { SettingsModal } from "./SettingsModal";

interface DashboardProps {
  client?: TelegramClient | null;
  driveConfig: DriveConfig;
  topics: TopicFolder[];
  files: DriveFile[];
  loadingFiles: boolean;
  uploads: UploadProgress[];
  downloadProgress: DownloadProgress | null;
  onFolderClick: (id: number) => void;
  onBackToRoot: () => void;
  onCreateFolder: (name: string) => void;
  onRenameFolder: (folder: TopicFolder) => void;
  onDeleteFolder: (id: number) => void;
  onFileDrop: (files: File[]) => void;
  onDownload: (file: DriveFile) => void | Promise<void>;
  onDownloadFilesBatch?: (files: DriveFile[]) => Promise<void>;
  onCancelUpload?: (fileId: string) => void;
  onCancelDownload?: () => void;
  onRenameFile: (file: DriveFile) => void;
  onDeleteFile: (file: DriveFile) => void;
  onMoveFile?: (files: DriveFile[], targetFolderId: number) => Promise<boolean>;
  onCopyFile?: (files: DriveFile[], targetFolderId: number) => Promise<boolean>;
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
  allFiles: DriveFile[];
  recentFiles: DriveFile[];
  indexing: boolean;
  indexingProgress: { current: number; total: number };
  onDeleteFilesBatch: (files: DriveFile[]) => Promise<boolean>;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  onJoinUpdateChannel?: () => void | Promise<void>;
  joiningChannel?: boolean;
  onClearCache?: () => void | Promise<void>;
  triggerConfirm?: (title: string, message: string, onConfirm: () => void | Promise<void>) => void;
  triggerToast?: (message: string, type?: "success" | "error" | "info") => void;
  favouriteChunks?: Set<string>;
  onToggleLike?: (file: DriveFile) => void;
  onShare?: (file: DriveFile) => void;
  fileSharingEnabled?: boolean;
  onToggleFileSharing?: () => void;
  onOpenReceiveShare?: (hash?: string) => void;
}

function getFolderIcon(title: string, color: string, baseClass = "w-5 h-5 shrink-0") {
  const t = title.toLowerCase();
  
  if (t.includes("favour") || t.includes("favor")) {
    return (
      <svg className={baseClass} fill="none" viewBox="0 0 24 24" stroke={color} strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.907c.969 0 1.371 1.24.588 1.81l-3.97 2.883a1 1 0 00-.364 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.971-2.883a1 1 0 00-1.175 0l-3.97 2.883c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.364-1.118L2.98 10.1c-.783-.57-.38-1.81.588-1.81h4.906a1 1 0 00.951-.69l1.519-4.674z" />
      </svg>
    );
  }
  if (t.includes("video") || t.includes("movie") || t.includes("film")) {
    return (
      <svg className={baseClass} fill="none" viewBox="0 0 24 24" stroke={color} strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
    );
  }
  if (t.includes("audio") || t.includes("music") || t.includes("sound") || t.includes("song")) {
    return (
      <svg className={baseClass} fill="none" viewBox="0 0 24 24" stroke={color} strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
      </svg>
    );
  }
  if (t.includes("photo") || t.includes("image") || t.includes("pic") || t.includes("gallery")) {
    return (
      <svg className={baseClass} fill="none" viewBox="0 0 24 24" stroke={color} strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    );
  }
  if (t.includes("doc") || t.includes("text") || t.includes("pdf") || t.includes("file") || t.includes("sheet")) {
    return (
      <svg className={baseClass} fill="none" viewBox="0 0 24 24" stroke={color} strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    );
  }
  return (
    <svg className={baseClass} fill="none" viewBox="0 0 24 24" stroke={color} strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  );
}

export function Dashboard({
  client,
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
  onDownloadFilesBatch,
  onCancelUpload,
  onCancelDownload,
  onRenameFile,
  onDeleteFile,
  onMoveFile,
  onCopyFile,
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
  allFiles,
  recentFiles,
  indexing,
  indexingProgress,
  onDeleteFilesBatch,
  theme,
  setTheme,
  onJoinUpdateChannel,
  joiningChannel = false,
  onClearCache,
  triggerConfirm,
  triggerToast,
  favouriteChunks = new Set(),
  onToggleLike,
  onShare,
  fileSharingEnabled,
  onToggleFileSharing,
  onOpenReceiveShare,
}: DashboardProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [moveCopyTarget, setMoveCopyTarget] = useState<{ open: boolean; files: DriveFile[] } | null>(null);
  const [infoModalFile, setInfoModalFile] = useState<DriveFile | null>(null);
  const [recentContextMenu, setRecentContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    file: DriveFile | null;
  }>({ visible: false, x: 0, y: 0, file: null });

  const handleRecentContextMenu = (e: React.MouseEvent, file: DriveFile) => {
    e.preventDefault();
    e.stopPropagation();
    const menuWidth = 190;
    const menuHeight = 320;
    const padding = 16;

    let x = e.clientX;
    let y = e.clientY;

    if (x + menuWidth > window.innerWidth - padding) {
      x = window.innerWidth - menuWidth - padding;
    }
    if (y + menuHeight > window.innerHeight - padding) {
      y = window.innerHeight - menuHeight - padding;
    }

    setRecentContextMenu({
      visible: true,
      x: Math.max(padding, x),
      y: Math.max(padding, y),
      file,
    });
  };

  useEffect(() => {
    const handleGlobalClick = () => {
      setRecentContextMenu((prev) => (prev.visible ? { ...prev, visible: false } : prev));
    };
    window.addEventListener("click", handleGlobalClick);
    return () => window.removeEventListener("click", handleGlobalClick);
  }, []);

  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"name" | "size" | "date">("date");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [gridBoxSize, setGridBoxSize] = useState<"small" | "medium" | "large">(() => {
    return (localStorage.getItem("tgcd_grid_box_size") as "small" | "medium" | "large") || "large";
  });

  const handleSetGridBoxSize = (size: "small" | "medium" | "large") => {
    setGridBoxSize(size);
    localStorage.setItem("tgcd_grid_box_size", size);
  };

  const [showSortDropdown, setShowSortDropdown] = useState(false);
  const sortDropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (sortDropdownRef.current && !sortDropdownRef.current.contains(event.target as Node)) {
        setShowSortDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const [selectionState, setSelectionState] = useState<{
    folderId: number | null;
    ids: Set<number>;
  }>({ folderId: activeFolderId, ids: new Set() });
  const selectedFileIds =
    selectionState.folderId === activeFolderId ? selectionState.ids : new Set<number>();

  const mainRef = useRef<HTMLElement | null>(null);
  const mobileFileInputRef = useRef<HTMLInputElement | null>(null);
  const dragCounter = useRef(0);
  const [isDraggingPage, setIsDraggingPage] = useState(false);
  const [showMobileSidebar, setShowMobileSidebar] = useState(false);

  const handleToggleSelect = (id: number) => {
    setSelectionState((prevState) => {
      const prev = prevState.folderId === activeFolderId ? prevState.ids : new Set<number>();
      const copy = new Set(prev);
      if (copy.has(id)) {
        copy.delete(id);
      } else {
        copy.add(id);
      }
      return { folderId: activeFolderId, ids: copy };
    });
  };

  const activeFolder = topics.find((t) => t.id === activeFolderId) ?? null;
  const displayedTopics = searchQuery
    ? filterTopics(searchQuery)
    : topics;

  // Filter files matching search query globally (for root view search)
  const matchingFiles = searchQuery
    ? allFiles.filter((f) => f.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : [];

  // Filter files by search query (for folder view)
  let filtered = searchQuery ? filterFiles(searchQuery) : files;

  // Filter files by category
  const getFileCategory = (fileName: string): string => {
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "image";
    if (["mp4", "webm", "ogg", "mov"].includes(ext)) return "video";
    if (["mp3", "wav", "m4a", "flac", "ogg"].includes(ext)) return "audio";
    if (["pdf", "docx", "xlsx", "xls", "csv", "txt", "md", "json", "zip", "rar"].includes(ext)) return "document";
    return "other";
  };

  if (selectedCategory !== "all") {
    filtered = filtered.filter((f) => getFileCategory(f.name) === selectedCategory);
  }

  // Sort files
  const displayedFiles = [...filtered].sort((a, b) => {
    let comp = 0;
    if (sortBy === "name") comp = a.name.localeCompare(b.name);
    else if (sortBy === "size") comp = a.size - b.size;
    else if (sortBy === "date") comp = a.date - b.date;
    return sortOrder === "asc" ? comp : -comp;
  });

  const handleToggleSelectAll = () => {
    const filesToSelect = activeFolderId === null ? matchingFiles : displayedFiles;
    setSelectionState((prevState) => {
      const prev = prevState.folderId === activeFolderId ? prevState.ids : new Set<number>();
      const allSelected = filesToSelect.length > 0 && filesToSelect.every((f) => prev.has(f.id));
      const copy = new Set(prev);
      if (allSelected) {
        filesToSelect.forEach((f) => copy.delete(f.id));
      } else {
        filesToSelect.forEach((f) => copy.add(f.id));
      }
      return { folderId: activeFolderId, ids: copy };
    });
  };

  const selectedFiles = (activeFolderId === null ? allFiles : files).filter((f) => selectedFileIds.has(f.id));

  const handleBatchDelete = () => {
    if (selectedFiles.length === 0) return;
    if (triggerConfirm) {
      triggerConfirm(
        "Delete Selected Files",
        `Are you sure you want to delete all ${selectedFiles.length} selected files from Telegram cloud storage?`,
        async () => {
          const ok = await onDeleteFilesBatch(selectedFiles);
          if (ok) {
            setSelectionState({ folderId: activeFolderId, ids: new Set() });
            triggerToast?.("Successfully deleted selected files.", "success");
          } else {
            triggerToast?.("Failed to delete some selected files.", "error");
          }
        }
      );
    }
  };

  const handleBatchDownload = async () => {
    if (selectedFiles.length === 0) return;
    if (onDownloadFilesBatch) {
      await onDownloadFilesBatch(selectedFiles);
      setSelectionState({ folderId: activeFolderId, ids: new Set() });
      return;
    }
    for (const file of selectedFiles) {
      try {
        await onDownload(file);
      } catch (err) {
        console.error("Batch download error:", err);
      }
    }
    setSelectionState({ folderId: activeFolderId, ids: new Set() });
  };

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
    <div className="h-screen max-h-screen overflow-hidden bg-surface-50 dark:bg-surface-50 flex flex-col relative transition-colors duration-300">
      {/* Full-screen drag wash overlay */}
      {isDraggingPage && (
        <div 
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/40 border-[3px] border-dashed border-brand-400/80 m-4 rounded-3xl animate-fade-in pointer-events-none"
          style={{ backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }}
        >
          <div className="w-24 h-24 rounded-3xl bg-surface-900/90 text-white flex items-center justify-center mb-4 shadow-2xl border border-surface-300/10">
            <svg className="w-12 h-12 text-accent-400 animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          </div>
          <p className="text-white text-xl font-black tracking-tight">Drop files anywhere to upload</p>
          <p className="text-surface-300 text-xs font-bold uppercase tracking-wider mt-1.5 opacity-80">Upload instantly to your active folder</p>
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
        theme={theme}
        setTheme={setTheme}
        onMenuClick={() => setShowMobileSidebar(true)}
        onOpenReceiveShare={onOpenReceiveShare}
        fileSharingEnabled={fileSharingEnabled}
        onToggleFileSharing={onToggleFileSharing}
        onJoinUpdateChannel={onJoinUpdateChannel}
        joiningChannel={joiningChannel}
        onClearCache={onClearCache}
        onOpenSettingsModal={() => setShowSettingsModal(true)}
      />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          folders={topics}
          activeFolderId={activeFolderId}
          onFolderClick={onFolderClick}
          onCreateFolder={() => setShowCreateFolder(true)}
          onBackToRoot={onBackToRoot}
          allFiles={allFiles}
          indexing={indexing}
          indexingProgress={indexingProgress}
          onJoinUpdateChannel={onJoinUpdateChannel}
          joiningChannel={joiningChannel}
          onOpenReceiveShare={onOpenReceiveShare}
        />

        <main ref={mainRef} className="flex-1 min-w-0 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <Breadcrumb
            folderName={activeFolder?.title ?? null}
            onBackToRoot={onBackToRoot}
          />

          {activeFolderId === null ? (
            /* Root view: show folders */
            <div className="space-y-8">
              {/* Recent Files Panel */}
              {/* Recent Uploads Section */}
              {!searchQuery && recentFiles.length > 0 && (
                <div className="space-y-3.5">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xs font-semibold uppercase tracking-widest text-md-on-surface-variant flex items-center gap-2 select-none">
                      <span>Recent Uploads</span>
                      <span className="text-[9px] uppercase bg-md-primary-container text-md-on-primary-container font-semibold px-2 py-0.5 rounded-full select-none">
                        Activity
                      </span>
                    </h2>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                    {recentFiles.map((file) => {
                      const ext = file.name.split(".").pop()?.toUpperCase() || "FILE";
                      return (
                        <div
                          key={file.id}
                          onClick={() => onPreview(file)}
                          onContextMenu={(e) => handleRecentContextMenu(e, file)}
                          className="group relative flex flex-col bg-md-surface-container-lowest rounded-[20px] overflow-hidden border border-md-outline-variant/30 hover:border-md-primary/30 transition-all duration-300 cursor-pointer select-none"
                          style={{ boxShadow: 'var(--md-elevation-1)' }}
                        >
                          {/* Thumbnail Box Container */}
                          <div className="relative aspect-[16/10] w-full bg-md-surface-container overflow-hidden flex items-center justify-center p-2">
                            <FileCardThumbnail
                              file={file}
                              client={client}
                              driveConfig={driveConfig}
                              className="w-full h-full object-cover rounded-xl transition-transform duration-300 group-hover:scale-105"
                            />

                            {/* Format Badge Overlay */}
                            <span className="absolute top-2 right-2 text-[8px] font-semibold font-mono bg-md-inverse-surface/70 backdrop-blur-md text-md-inverse-on-surface px-1.5 py-0.5 rounded-md border border-white/5 shadow-sm">
                              {ext}
                            </span>

                            {/* Hover Preview Overlay Icon */}
                            <div className="absolute inset-0 bg-md-primary-container/20 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <div className="w-8 h-8 rounded-full bg-md-surface-container-highest text-md-primary flex items-center justify-center shadow-md transform scale-75 group-hover:scale-100 transition-transform">
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                </svg>
                              </div>
                            </div>
                          </div>

                          {/* Box Footer Info */}
                          <div className="p-3 bg-md-surface-container-lowest border-t border-md-outline-variant/20 flex flex-col gap-0.5 min-w-0">
                            <p className="text-xs font-semibold text-md-on-surface truncate group-hover:text-md-primary transition-colors leading-tight" title={file.name}>
                              {file.name}
                            </p>
                            <div className="flex items-center justify-between text-[10px] text-md-on-surface-variant font-medium font-mono mt-0.5">
                              <span>{formatBytes(file.size)}</span>
                              <span>{new Date(file.date * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-widest text-md-on-surface-variant">
                  {searchQuery ? "Matching Folders" : "Folders"}
                  <span className="text-[10px] font-semibold text-md-on-surface-variant ml-2 bg-md-surface-container-high px-2 py-0.5 rounded-full font-mono border border-md-outline-variant/20">
                    {displayedTopics.length}
                  </span>
                </h2>
                <button
                  onClick={() => setShowCreateFolder(true)}
                  className="lg:hidden flex items-center gap-1.5 text-xs text-md-primary hover:underline transition-colors font-semibold uppercase tracking-wider cursor-pointer"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 4v16m8-8H4"
                    />
                  </svg>
                  New
                </button>
              </div>

              {displayedTopics.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {displayedTopics.map((folder, idx) => {
                    const getFolderTheme = (title: string, index: number) => {
                      const t = title.toLowerCase();
                      if (t.includes("favour") || t.includes("favor")) {
                        return { text: "var(--color-warning)", bg: "bg-warning-container/30", border: "hover:border-warning/40" };
                      }
                      if (t.includes("video") || t.includes("movie")) {
                        return { text: "var(--md-tertiary)", bg: "bg-md-tertiary-container/30", border: "hover:border-md-tertiary/40" };
                      }
                      if (t.includes("audio") || t.includes("music")) {
                        return { text: "var(--md-tertiary)", bg: "bg-md-tertiary-container/30", border: "hover:border-md-tertiary/40" };
                      }
                      if (t.includes("photo") || t.includes("image") || t.includes("pic")) {
                        return { text: "var(--color-success)", bg: "bg-success-container/30", border: "hover:border-success/40" };
                      }
                      if (t.includes("doc") || t.includes("text") || t.includes("pdf") || t.includes("file")) {
                        return { text: "var(--md-primary)", bg: "bg-md-primary-container/30", border: "hover:border-md-primary/40" };
                      }
                      
                      const fallbackColors = [
                        { text: "var(--md-primary)", bg: "bg-md-primary-container/30", border: "hover:border-md-primary/40" },
                        { text: "var(--color-warning)", bg: "bg-warning-container/30", border: "hover:border-warning/40" },
                        { text: "var(--md-tertiary)", bg: "bg-md-tertiary-container/30", border: "hover:border-md-tertiary/40" },
                      ];
                      return fallbackColors[index % fallbackColors.length];
                    };
                    const theme = getFolderTheme(folder.title, idx);
                    const fileCount = allFiles.filter((f) => f.topicId === folder.id).length;

                    return (
                      <div
                        key={folder.id}
                        onClick={() => onFolderClick(folder.id)}
                        className={`group relative bg-md-surface-container-lowest border border-md-outline-variant/30 ${theme.border} rounded-2xl p-4 flex items-center justify-between cursor-pointer hover:-translate-y-0.5 transition-all duration-200 select-none`}
                        style={{ boxShadow: 'var(--md-elevation-1)' }}
                      >
                        <div className="flex items-center gap-3.5 min-w-0">
                          <div className={`w-10 h-10 rounded-full ${theme.bg} flex items-center justify-center shrink-0`}>
                            {getFolderIcon(folder.title, theme.text)}
                          </div>
                          <div className="min-w-0">
                            <h4 className="text-xs font-semibold text-md-on-surface truncate tracking-tight group-hover:text-md-primary transition-colors">
                              {folder.title}
                            </h4>
                            <p className="text-[10px] text-md-on-surface-variant font-medium mt-0.5">
                              {fileCount} {fileCount === 1 ? "file" : "files"}
                            </p>
                          </div>
                        </div>

                        <div
                          className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 ml-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => onRenameFolder(folder)}
                            className="p-1.5 rounded-md hover:bg-md-surface-container-high text-md-on-surface-variant hover:text-md-primary active:scale-90 transition-all cursor-pointer"
                            title="Rename Folder"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                            </svg>
                          </button>
                          <button
                            onClick={() => onDeleteFolder(folder.id)}
                            className="p-1.5 rounded-md hover:bg-md-error-container/30 text-md-on-surface-variant hover:text-md-error active:scale-90 transition-all cursor-pointer"
                            title="Delete Folder"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                searchQuery && (
                  <p className="text-xs text-md-on-surface-variant italic select-none">No folders matching "{searchQuery}"</p>
                )
              )}

              {/* Search Results: Files */}
              {searchQuery && (
                <div className="space-y-4 pt-6 border-t border-md-outline-variant/20">
                  <h2 className="text-sm font-semibold uppercase tracking-widest text-md-on-surface-variant flex items-center gap-2">
                    <span>Search Results: Files</span>
                    <span className="text-[10px] font-semibold text-md-on-surface-variant bg-md-surface-container-high px-2 py-0.5 rounded-full font-mono border border-md-outline-variant/20">
                      {matchingFiles.length}
                    </span>
                  </h2>
                  <FileGrid
                    files={matchingFiles}
                    loading={loadingFiles}
                    onDownload={onDownload}
                    onPreview={onPreview}
                    onRename={onRenameFile}
                    onDelete={onDeleteFile}
                    selectedFileIds={selectedFileIds}
                    onToggleSelect={handleToggleSelect}
                    onToggleSelectAll={handleToggleSelectAll}
                    favouriteChunks={favouriteChunks}
                    onToggleLike={onToggleLike}
                    onShare={onShare}
                    onOpenMoveCopy={(filesToMove) => setMoveCopyTarget({ open: true, files: filesToMove })}
                    onOpenDetails={(file) => setInfoModalFile(file)}
                    gridBoxSize={gridBoxSize}
                  />
                </div>
              )}

              {searchQuery && displayedTopics.length === 0 && matchingFiles.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 animate-fade-in text-center select-none">
                  <div className="w-16 h-16 mb-4 rounded-2xl bg-md-surface-container flex items-center justify-center text-md-on-surface-variant border border-md-outline-variant/20">
                    <svg className="w-8 h-8 text-md-outline" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                  <p className="text-md-on-surface font-semibold mb-1 text-sm">No results found</p>
                  <p className="text-md-on-surface-variant text-xs max-w-[260px] leading-relaxed">
                    We couldn't find any folders or files matching "{searchQuery}"
                  </p>
                </div>
              )}
            </div>
          ) : (
            /* Folder view: show upload zone + files */
            <div className="space-y-8">
              <UploadZone
                onDrop={onFileDrop}
                onImportShareHash={(hash) => onOpenReceiveShare?.(hash)}
              />

              {/* Upload progress indicators */}
              {activeUploads.length > 0 && (
                <div className="space-y-3.5">
                  {activeUploads.map((u) => (
                    <div
                      key={u.fileId}
                      className="glass rounded-3xl p-5 space-y-3 border border-surface-300/40 dark:border-surface-300/10 animate-slide-up shadow-sm relative overflow-hidden"
                    >
                      {/* Loading reflection sheen */}
                      <div className="absolute inset-0 shimmer pointer-events-none" />

                      <div className="flex items-center justify-between text-sm relative z-10 select-none">
                        <span className="text-surface-900 font-bold truncate mr-4">
                          {u.fileName}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-surface-600 dark:text-surface-500 text-xs shrink-0 font-bold font-mono">
                            {u.status === "uploading"
                              ? `${Math.round((u.uploadedBytes / (u.totalBytes || 1)) * 100)}%`
                              : u.status === "finalizing"
                                ? "Finalizing..."
                                : u.status === "error"
                                  ? "Error"
                                  : "Preparing..."}
                          </span>
                          {(u.status === "uploading" || u.status === "preparing") && onCancelUpload && (
                            <button
                              onClick={() => onCancelUpload(u.fileId)}
                              className="p-1 hover:bg-surface-200 dark:hover:bg-surface-300/20 text-surface-650 dark:text-surface-600 hover:text-danger rounded-full transition-all cursor-pointer flex items-center justify-center"
                              title="Cancel Upload"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </div>
                      <ProgressBar
                        value={
                          u.totalBytes > 0
                            ? (u.uploadedBytes / u.totalBytes) * 100
                            : 0
                        }
                        color={u.status === "error" ? "brand" : "accent"}
                      />
                      <div className="flex justify-between text-[10px] text-surface-500 font-bold relative z-10 uppercase select-none tracking-wide">
                        <span>
                          {formatBytes(u.uploadedBytes)} /{" "}
                          {formatBytes(u.totalBytes)}
                          {u.speedBps ? ` - ${formatBytes(u.speedBps)}/s` : ""}
                        </span>
                        {u.error && (
                          <span className="text-danger line-clamp-1 break-all max-w-xs normal-case" title={u.error}>
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
                <div className="glass rounded-3xl p-5 space-y-3 border border-surface-300/40 dark:border-surface-300/10 animate-slide-up shadow-sm relative overflow-hidden">
                  <div className="absolute inset-0 shimmer pointer-events-none" />
                  
                  <div className="flex items-center justify-between text-sm relative z-10 select-none">
                    <span className="text-surface-900 font-bold truncate mr-4">
                      ⬇️ {downloadProgress.name}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-surface-600 dark:text-surface-500 text-xs font-bold font-mono">
                        {downloadProgress.progress}%
                      </span>
                      {onCancelDownload && (
                        <button
                          onClick={onCancelDownload}
                          className="p-1 hover:bg-surface-200 dark:hover:bg-surface-300/20 text-surface-650 dark:text-surface-600 hover:text-danger rounded-full transition-all cursor-pointer flex items-center justify-center"
                          title="Cancel Download"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                  <ProgressBar
                    value={downloadProgress.progress}
                    color="success"
                  />
                  <div className="flex justify-between text-[10px] text-surface-500 font-bold relative z-10 uppercase select-none tracking-wide">
                    <span>
                      {formatBytes(downloadProgress.downloadedBytes)} /{" "}
                      {formatBytes(downloadProgress.totalBytes)}
                    </span>
                    <span>{formatBytes(downloadProgress.speedBps)}/s</span>
                  </div>
                </div>
              )}

              <div className="space-y-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 select-none">
                  {/* Category tabs */}
                  <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
                    {[
                      { id: "all", label: "All Files" },
                      { id: "image", label: "Images" },
                      { id: "video", label: "Videos" },
                      { id: "audio", label: "Audio" },
                      { id: "document", label: "Documents" },
                    ].map((cat) => (
                      <button
                        key={cat.id}
                        onClick={() => setSelectedCategory(cat.id)}
                        className={`px-4.5 py-2.5 rounded-2xl text-xs font-extrabold transition-all shrink-0 cursor-pointer flex items-center gap-2 border select-none ${
                          selectedCategory === cat.id
                            ? "bg-brand-500 text-white border-brand-500/25 shadow-md shadow-brand-500/15"
                            : "bg-surface-100/40 dark:bg-surface-200/20 text-surface-750 dark:text-surface-700 border-surface-300/40 dark:border-surface-300/10 hover:bg-surface-200 dark:hover:bg-surface-300/10"
                        }`}
                      >
                        <FileIcon category={cat.id} className="w-4 h-4 shrink-0 filter drop-shadow-sm" />
                        {cat.label}
                      </button>
                    ))}
                  </div>

                  {/* Sorting options */}
                  <div className="relative flex items-center gap-2 shrink-0 select-none" ref={sortDropdownRef}>
                    <span className="text-xs text-surface-500 font-bold uppercase tracking-wider">Sort:</span>
                    <button
                      onClick={() => setShowSortDropdown(!showSortDropdown)}
                      className="bg-surface-200 dark:bg-surface-200/10 hover:bg-surface-300 dark:hover:bg-surface-300/15 text-surface-900 text-xs rounded-xl px-3 py-2 border border-surface-300/30 dark:border-surface-300/10 outline-none cursor-pointer focus:border-brand-400 font-bold tracking-tight flex items-center gap-1.5 min-w-[72px] justify-between transition-all"
                    >
                      <span className="capitalize">{sortBy}</span>
                      <svg className={`w-3 h-3 text-surface-500 transition-transform duration-200 ${showSortDropdown ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>

                    {showSortDropdown && (
                      <div className="absolute right-9 top-full mt-1.5 z-45 bg-surface-100 dark:bg-surface-200 border border-surface-300/40 dark:border-surface-300/15 rounded-2xl shadow-xl py-1.5 min-w-[100px] overflow-hidden animate-slide-down">
                        {(["date", "name", "size"] as const).map((opt) => (
                          <button
                            key={opt}
                            onClick={() => {
                              setSortBy(opt);
                              setShowSortDropdown(false);
                            }}
                            className={`w-full text-left px-4 py-2 text-xs font-semibold capitalize transition-colors ${
                              sortBy === opt
                                ? "bg-brand-500 text-white"
                                : "text-surface-750 dark:text-surface-700 hover:bg-surface-200 dark:hover:bg-surface-300/20"
                            }`}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    )}

                    <button
                      onClick={() => setSortOrder(prev => prev === "asc" ? "desc" : "asc")}
                      className="p-2 rounded-xl bg-surface-200 dark:bg-surface-200/10 hover:bg-surface-300 dark:hover:bg-surface-300/10 text-surface-700 dark:text-surface-650 transition-colors cursor-pointer border border-transparent hover:border-surface-300/30 active:scale-90 mr-2"
                      title={sortOrder === "asc" ? "Sort Ascending" : "Sort Descending"}
                    >
                      {sortOrder === "asc" ? (
                        <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h13M3 8h9M3 12h5m0 0v-8m0 0v8" />
                        </svg>
                      ) : (
                        <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h13M3 8h9M3 12h9m0 0l-3-3m3 3l-3 3" />
                        </svg>
                      )}
                    </button>

                    {/* Grid Sizing layout icon button */}
                    <button
                      onClick={() => {
                        const nextSize = gridBoxSize === "large" ? "small" : gridBoxSize === "small" ? "medium" : "large";
                        handleSetGridBoxSize(nextSize);
                      }}
                      className="p-2 rounded-xl bg-surface-200 dark:bg-surface-200/10 hover:bg-surface-300 dark:hover:bg-surface-300/10 text-surface-700 dark:text-surface-650 transition-all cursor-pointer border border-transparent hover:border-surface-300/30 active:scale-90"
                      title={`Grid Layout: ${gridBoxSize === "large" ? "Big" : gridBoxSize}`}
                    >
                      {gridBoxSize === "small" ? (
                        <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4h4v4H4V4zm6 0h4v4h-4V4zm6 0h4v4h-4V4zM4 10h4v4H4v-4zm6 0h4v4h-4v-4zm6 0h4v4h-4v-4zM4 16h4v4H4v-4zm6 0h4v4h-4v-4zm6 0h4v4h-4v-4z" />
                        </svg>
                      ) : gridBoxSize === "medium" ? (
                        <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6zm10 0h6v6h-6v-6z" />
                        </svg>
                      ) : (
                        <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5z" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                <div className="pt-4 border-t border-surface-300/40 dark:border-surface-300/10">
                  <h2 className="text-sm font-extrabold uppercase tracking-widest text-surface-600 mb-5">
                    Files
                    <span className="text-[10px] font-bold text-surface-500 ml-2 bg-surface-200/60 dark:bg-surface-300/15 px-2 py-0.5 rounded-full font-mono border border-surface-300/10">
                      {displayedFiles.length}
                    </span>
                  </h2>
                  <FileGrid
                    client={client}
                    driveConfig={driveConfig}
                    files={displayedFiles}
                    loading={loadingFiles}
                    onDownload={onDownload}
                    onPreview={onPreview}
                    onRename={onRenameFile}
                    onDelete={onDeleteFile}
                    selectedFileIds={selectedFileIds}
                    onToggleSelect={handleToggleSelect}
                    onToggleSelectAll={handleToggleSelectAll}
                    favouriteChunks={favouriteChunks}
                    onToggleLike={onToggleLike}
                    onShare={onShare}
                    onOpenMoveCopy={(filesToMove) => setMoveCopyTarget({ open: true, files: filesToMove })}
                    onOpenDetails={(file) => setInfoModalFile(file)}
                    gridBoxSize={gridBoxSize}
                  />
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Floating OS Action Dock */}
      {selectedFileIds.size > 0 && (
        <div 
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 glass rounded-[24px] px-6 py-4 flex items-center gap-5 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.35)] animate-scale-in border border-brand-500/25 max-w-[90vw] md:max-w-none"
          style={{ backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)" }}
        >
          <div className="text-[11px] font-black text-surface-900 shrink-0 uppercase tracking-widest select-none">
            <span className="text-brand-500 font-black text-sm mr-1">{selectedFileIds.size}</span>
            Selected
          </div>
          <div className="h-5 w-[1px] bg-surface-300/40 dark:bg-surface-300/10" />
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const selectedFiles = displayedFiles.filter((f) => selectedFileIds.has(f.id));
                if (selectedFiles.length > 0) setMoveCopyTarget({ open: true, files: selectedFiles });
              }}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-brand-500/10 hover:bg-brand-500/20 text-brand-500 text-xs font-bold border border-brand-500/20 active:scale-95 transition-all cursor-pointer select-none"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
              Move / Copy
            </button>
            <button
              onClick={handleBatchDownload}
              className="flex items-center gap-1.5 px-4.5 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white text-xs font-bold shadow-md shadow-brand-500/10 active:scale-95 transition-all cursor-pointer select-none border border-brand-600/10"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download
            </button>
            <button
              onClick={handleBatchDelete}
              className="flex items-center gap-1.5 px-4.5 py-2.5 rounded-xl bg-danger/10 hover:bg-danger/20 text-danger text-xs font-bold transition-all border border-danger/20 active:scale-95 cursor-pointer select-none"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Delete
            </button>
            <button
              onClick={() => setSelectionState({ folderId: activeFolderId, ids: new Set() })}
              className="px-4 py-2.5 rounded-xl bg-surface-200 hover:bg-surface-300 dark:bg-surface-300/20 dark:hover:bg-surface-300/35 text-surface-700 text-xs font-bold active:scale-95 transition-all cursor-pointer select-none"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Hidden Mobile Input for FAB upload */}
      <input
        ref={mobileFileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            onFileDrop(Array.from(e.target.files));
            e.target.value = "";
          }
        }}
      />

      {/* Move & Copy Modal */}
      <MoveCopyModal
        open={Boolean(moveCopyTarget?.open)}
        onClose={() => setMoveCopyTarget(null)}
        files={moveCopyTarget?.files || []}
        folders={topics}
        onMove={async (targetFolderId) => {
          if (moveCopyTarget?.files && onMoveFile) {
            const ok = await onMoveFile(moveCopyTarget.files, targetFolderId);
            if (ok) setSelectionState({ folderId: activeFolderId, ids: new Set() });
          }
        }}
        onCopy={async (targetFolderId) => {
          if (moveCopyTarget?.files && onCopyFile) {
            const ok = await onCopyFile(moveCopyTarget.files, targetFolderId);
            if (ok) setSelectionState({ folderId: activeFolderId, ids: new Set() });
          }
        }}
      />

      {/* File Info Modal */}
      <FileInfoModal
        open={Boolean(infoModalFile)}
        onClose={() => setInfoModalFile(null)}
        file={infoModalFile}
        onDownload={onDownload}
        onRename={onRenameFile}
      />

      {/* Recent Uploads Context Menu */}
      {recentContextMenu.visible && recentContextMenu.file && (
        <div
          className="fixed z-[100] bg-md-surface-container backdrop-blur-xl border border-md-outline-variant/30 rounded-[12px] py-2 min-w-[170px] animate-scale-in select-none text-left"
          style={{
            top: `${recentContextMenu.y}px`,
            left: `${recentContextMenu.x}px`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              if (recentContextMenu.file) onPreview(recentContextMenu.file);
              setRecentContextMenu((prev) => ({ ...prev, visible: false }));
            }}
            className="w-full text-left px-3.5 py-2.5 text-xs font-medium text-md-on-surface hover:bg-md-surface-container-high flex items-center gap-2 cursor-pointer transition-colors min-h-[40px]"
          >
            <svg className="w-4 h-4 text-md-on-surface-variant" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            Open / View
          </button>
          <button
            onClick={() => {
              if (recentContextMenu.file) setInfoModalFile(recentContextMenu.file);
              setRecentContextMenu((prev) => ({ ...prev, visible: false }));
            }}
            className="w-full text-left px-3.5 py-2.5 text-xs font-medium text-md-on-surface hover:bg-md-surface-container-high flex items-center gap-2 cursor-pointer transition-colors min-h-[40px]"
          >
            <svg className="w-4 h-4 text-md-on-surface-variant" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Details
          </button>
          <button
            onClick={() => {
              if (recentContextMenu.file) onDownload(recentContextMenu.file);
              setRecentContextMenu((prev) => ({ ...prev, visible: false }));
            }}
            className="w-full text-left px-3.5 py-2.5 text-xs font-medium text-md-on-surface hover:bg-md-surface-container-high flex items-center gap-2 cursor-pointer transition-colors min-h-[40px]"
          >
            <svg className="w-4 h-4 text-md-on-surface-variant" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download
          </button>
          <button
            onClick={() => {
              if (recentContextMenu.file) setMoveCopyTarget({ open: true, files: [recentContextMenu.file] });
              setRecentContextMenu((prev) => ({ ...prev, visible: false }));
            }}
            className="w-full text-left px-3.5 py-2.5 text-xs font-medium text-md-on-surface hover:bg-md-surface-container-high flex items-center gap-2 cursor-pointer transition-colors min-h-[40px]"
          >
            <svg className="w-4 h-4 text-md-on-surface-variant" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            Move / Copy
          </button>
          {onShare && (
            <button
              onClick={() => {
                if (recentContextMenu.file) onShare(recentContextMenu.file);
                setRecentContextMenu((prev) => ({ ...prev, visible: false }));
              }}
              className="w-full text-left px-3.5 py-2.5 text-xs font-medium text-md-on-surface hover:bg-md-surface-container-high flex items-center gap-2 cursor-pointer transition-colors min-h-[40px]"
            >
              <svg className="w-4 h-4 text-md-on-surface-variant" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
              Share File
            </button>
          )}
          <div className="h-[1px] bg-md-outline-variant/30 my-1" />
          <button
            onClick={() => {
              if (recentContextMenu.file) onRenameFile(recentContextMenu.file);
              setRecentContextMenu((prev) => ({ ...prev, visible: false }));
            }}
            className="w-full text-left px-3.5 py-2.5 text-xs font-medium text-md-on-surface hover:bg-md-surface-container-high flex items-center gap-2 cursor-pointer transition-colors min-h-[40px]"
          >
            <svg className="w-4 h-4 text-md-on-surface-variant" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
            </svg>
            Rename
          </button>
          <button
            onClick={() => {
              if (recentContextMenu.file) onDeleteFile(recentContextMenu.file);
              setRecentContextMenu((prev) => ({ ...prev, visible: false }));
            }}
            className="w-full text-left px-3.5 py-2.5 text-xs font-medium text-md-error hover:bg-md-error-container/30 flex items-center gap-2 cursor-pointer transition-colors min-h-[40px]"
          >
            <svg className="w-4 h-4 text-md-error" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete
          </button>
        </div>
      )}

      {/* Settings & Profile Modal */}
      <SettingsModal
        open={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        userProfile={userProfile}
        accounts={accounts}
        activeAccountId={activeAccountId}
        allFiles={allFiles}
        onAddAccount={onAddAccount}
        onSwitchAccount={onSwitchAccount}
        onRemoveAccount={onRemoveAccount}
        onLogout={onLogout}
        onClearCache={onClearCache}
        theme={theme}
        setTheme={setTheme}
        fileSharingEnabled={fileSharingEnabled}
        onToggleFileSharing={onToggleFileSharing}
        onJoinUpdateChannel={onJoinUpdateChannel}
        joiningChannel={joiningChannel}
      />

      <CreateFolderModal
        open={showCreateFolder}
        onClose={() => setShowCreateFolder(false)}
        onSubmit={onCreateFolder}
      />

      {/* Mobile Floating Action Button (FAB) - Material 3 spec */}
      <button
        onClick={() => {
          if (activeFolderId === null) {
            setShowCreateFolder(true);
          } else {
            mobileFileInputRef.current?.click();
          }
        }}
        className="lg:hidden fixed bottom-6 right-6 z-40 w-14 h-14 rounded-2xl bg-brand-500 hover:bg-brand-650 text-white flex items-center justify-center shadow-lg active:scale-95 transition-all duration-150 cursor-pointer border border-brand-600/10 focus:outline-none"
        title={activeFolderId === null ? "Create Folder" : "Upload Files"}
      >
        <svg
          className="w-7 h-7"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          {activeFolderId === null ? (
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          )}
        </svg>
      </button>

      <CreateFolderModal
        open={showCreateFolder}
        onClose={() => setShowCreateFolder(false)}
        onSubmit={onCreateFolder}
      />

      {/* Mobile Sidebar Navigation Drawer */}
      {showMobileSidebar && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-md animate-fade-in"
            onClick={() => setShowMobileSidebar(false)}
          />
          {/* Drawer Content */}
          <div className="relative flex flex-col w-64 max-w-[80vw] bg-surface-50 dark:bg-surface-100 h-full shadow-[0_20px_50px_rgba(0,0,0,0.3)] border-r border-surface-300/40 dark:border-surface-300/10 animate-slide-right select-none z-50">
            {/* Header close button inside mobile drawer */}
            <div className="p-4 border-b border-surface-300/40 dark:border-surface-300/10 flex items-center justify-between">
              <span className="text-[10px] font-extrabold text-surface-500 uppercase tracking-widest">Navigation</span>
              <button
                onClick={() => setShowMobileSidebar(false)}
                className="p-1.5 rounded-xl hover:bg-surface-200/80 dark:hover:bg-surface-300/10 text-surface-550 cursor-pointer active:scale-90"
              >
                <svg className="w-5 h-5 text-surface-600 dark:text-surface-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {/* Drawer Body container */}
            <div className="flex-1 overflow-hidden">
              <Sidebar
                className="w-full flex flex-col h-full bg-transparent select-none"
                folders={topics}
                activeFolderId={activeFolderId}
                onFolderClick={(id) => {
                  onFolderClick(id);
                  setShowMobileSidebar(false);
                }}
                onCreateFolder={() => {
                  setShowMobileSidebar(false);
                  setShowCreateFolder(true);
                }}
                onBackToRoot={() => {
                  onBackToRoot();
                  setShowMobileSidebar(false);
                }}
                allFiles={allFiles}
                indexing={indexing}
                indexingProgress={indexingProgress}
                onJoinUpdateChannel={onJoinUpdateChannel}
                joiningChannel={joiningChannel}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
