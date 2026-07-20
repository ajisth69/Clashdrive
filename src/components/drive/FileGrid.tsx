import React, { useState, useEffect } from "react";
import type { TelegramClient } from "telegram";
import type { DriveFile, DriveConfig } from "../../types";
import { formatBytes } from "../../lib/manifest";
import { FileIcon } from "./FileIcon";
import { FileCardThumbnail } from "./FileCardThumbnail";

interface FileGridProps {
  client?: TelegramClient | null;
  driveConfig?: DriveConfig | null;
  files: DriveFile[];
  loading: boolean;
  onDownload: (file: DriveFile) => void;
  onPreview: (file: DriveFile) => void;
  onRename?: (file: DriveFile) => void;
  onDelete?: (file: DriveFile) => void;
  selectedFileIds?: Set<number>;
  onToggleSelect?: (fileId: number) => void;
  onToggleSelectAll?: () => void;
  favouriteChunks?: Set<string>;
  onToggleLike?: (file: DriveFile) => void;
  onShare?: (file: DriveFile) => void;
  onOpenMoveCopy?: (files: DriveFile[]) => void;
  onOpenDetails?: (file: DriveFile) => void;
  gridBoxSize?: "small" | "medium" | "large";
}

export function FileGrid({
  client,
  driveConfig,
  files,
  loading,
  onDownload,
  onPreview,
  onRename,
  onDelete,
  selectedFileIds = new Set(),
  onToggleSelect,
  onToggleSelectAll,
  favouriteChunks = new Set(),
  onToggleLike,
  onShare,
  onOpenMoveCopy,
  onOpenDetails,
  gridBoxSize = "large",
}: FileGridProps) {
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    file: DriveFile | null;
  }>({
    visible: false,
    x: 0,
    y: 0,
    file: null,
  });

  useEffect(() => {
    const handleGlobalClick = () => {
      setContextMenu((prev) => (prev.visible ? { ...prev, visible: false } : prev));
    };
    window.addEventListener("click", handleGlobalClick);
    window.addEventListener("contextmenu", handleGlobalClick);
    return () => {
      window.removeEventListener("click", handleGlobalClick);
      window.removeEventListener("contextmenu", handleGlobalClick);
    };
  }, []);

  const handleContextMenu = (e: React.MouseEvent, file: DriveFile, anchorRect?: DOMRect) => {
    e.preventDefault();
    e.stopPropagation();
    const menuWidth = 190;
    const menuHeight = 320;
    const padding = 16;

    let x = e.clientX;
    let y = e.clientY;

    if (anchorRect) {
      if (anchorRect.left + menuWidth > window.innerWidth - padding) {
        x = anchorRect.right - menuWidth;
      } else {
        x = anchorRect.left;
      }

      if (anchorRect.bottom + menuHeight > window.innerHeight - padding) {
        y = anchorRect.top - menuHeight - 6;
      } else {
        y = anchorRect.bottom + 6;
      }
    } else {
      if (x + menuWidth > window.innerWidth - padding) {
        x = window.innerWidth - menuWidth - padding;
      }
      if (y + menuHeight > window.innerHeight - padding) {
        y = window.innerHeight - menuHeight - padding;
      }
    }

    const maxAllowedX = Math.max(padding, window.innerWidth - menuWidth - padding);
    const maxAllowedY = Math.max(padding, window.innerHeight - menuHeight - padding);

    setContextMenu({
      visible: true,
      x: Math.min(Math.max(padding, x), maxAllowedX),
      y: Math.min(Math.max(padding, y), maxAllowedY),
      file,
    });
  };
  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-5 sm:gap-6">
        {[...Array(10)].map((_, i) => (
          <div
            key={i}
            className="bg-md-surface-container-low rounded-[20px] p-3 flex flex-col gap-3 animate-pulse border border-md-outline-variant/20"
            style={{ animationDelay: `${i * 80}ms` }}
          >
            <div className="w-full aspect-[16/10.5] rounded-[12px] bg-md-surface-container-high" />
            <div className="space-y-2.5 px-0.5">
              <div className="h-4 bg-md-surface-container-high rounded-md w-3/4" />
              <div className="h-3 bg-md-surface-container-high rounded-md w-1/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-28 animate-fade-in text-center select-none">
        <div className="w-20 h-20 mb-5 rounded-3xl bg-md-surface-container flex items-center justify-center text-md-on-surface-variant border border-md-outline-variant/20">
          <svg className="w-10 h-10 text-md-outline" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        </div>
        <p className="text-md-on-surface font-semibold mb-1 text-sm">No files in this folder</p>
        <p className="text-md-on-surface-variant text-xs max-w-[260px] leading-relaxed">
          Drag & drop files anywhere on the screen to upload instantly to this folder.
        </p>
      </div>
    );
  }

  const groups = new Map<string, DriveFile[]>();
  for (const f of files) {
    const d = new Date(f.date * 1000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(f);
  }
  const sortedKeys = Array.from(groups.keys()).sort((a, b) => b.localeCompare(a));
  let globalIdx = 0;

  return (
    <div className="space-y-4">
      {/* Selection Control Bar */}
      <div className="flex items-center justify-between px-1 select-none">
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => onToggleSelectAll?.()}
            className="w-5 h-5 rounded-md border border-md-outline-variant flex items-center justify-center transition-all bg-md-surface-container-lowest cursor-pointer hover:border-md-primary"
          >
            {files.length > 0 && files.every((f) => selectedFileIds.has(f.id)) && (
              <svg className="w-3.5 h-3.5 text-md-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-md-on-surface-variant">
            Select All
          </span>
        </div>
        {selectedFileIds.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-md-primary bg-md-primary-container px-2.5 py-1 rounded-full">
              {selectedFileIds.size} selected
            </span>
            {onOpenMoveCopy && (
              <button
                onClick={() => {
                  const selectedFiles = files.filter((f) => selectedFileIds.has(f.id));
                  if (selectedFiles.length > 0) onOpenMoveCopy(selectedFiles);
                }}
                className="py-1 px-3 rounded-full bg-md-primary-container hover:brightness-95 text-md-on-primary-container text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer active:scale-95"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
                Move / Copy
              </button>
            )}
          </div>
        )}
      </div>

      {/* Grid Canvas */}
      <div className="space-y-8 pb-12">
        {sortedKeys.map((key) => {
          const sectionFiles = groups.get(key)!;
          const d = new Date(parseInt(key.split("-")[0]), parseInt(key.split("-")[1]) - 1);
          const label = d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
          const startIdx = globalIdx;
          globalIdx += sectionFiles.length;

          return (
            <div key={key} className="space-y-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-widest text-md-on-surface-variant select-none px-1">
                {label}
              </h3>
              <div className={
                gridBoxSize === "small" ? "grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8 gap-3" :
                gridBoxSize === "medium" ? "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 xl:grid-cols-6 gap-3.5" :
                "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-4"
              }>
                {sectionFiles.map((file, idx) => {
                  const isSelected = selectedFileIds.has(file.id);
                  const isLiked = favouriteChunks.has(file.manifest.chunks.join(","));
                  
                  // Dynamic styles based on gridBoxSize
                  const cardRoundClass = 
                    gridBoxSize === "small" ? "rounded-2xl" : "rounded-3xl";

                  const cardPadding = 
                    gridBoxSize === "small" ? "p-2.5" : "p-3";

                  const titleTextSize = 
                    gridBoxSize === "small" ? "text-[11px]" :
                    gridBoxSize === "medium" ? "text-[11px] font-extrabold" : "text-xs font-black";

                  const metaRowClass = 
                    gridBoxSize === "small" ? "hidden" : "flex items-center justify-between mt-1 h-4.5 text-[10px] text-surface-600 dark:text-surface-500 font-bold tracking-tight relative";

                  const checkBtnSize = 
                    gridBoxSize === "small" ? "w-5 h-5" : "w-5.5 h-5.5";
                  
                  const checkIconSize = 
                    gridBoxSize === "small" ? "w-3 h-3" : "w-3.5 h-3.5";

                  const likeBtnSize = 
                    gridBoxSize === "small" ? "w-6.5 h-6.5" :
                    gridBoxSize === "medium" ? "w-7 h-7" : "w-7.5 h-7.5";

                  const likeIconSize = 
                    gridBoxSize === "small" ? "w-3.5 h-3.5" : "w-4 h-4";

                  const extTagTextSize = 
                    gridBoxSize === "small" ? "text-[8px] px-1" : "text-[8.5px] px-1.5";

                  return (
                    <div
                      key={file.id}
                      className={`relative bg-md-surface-container-lowest ${cardRoundClass} overflow-hidden cursor-pointer border transition-all duration-300 hover:-translate-y-0.5 select-none group flex flex-col ${
                        isSelected
                          ? "border-md-primary bg-md-primary-container/15"
                          : "border-md-outline-variant/30 hover:border-md-primary/30"
                      }`}
                      style={{ animationDelay: `${Math.min((startIdx + idx) * 15, 250)}ms`, boxShadow: 'var(--md-elevation-1)' }}
                      onClick={() => onPreview(file)}
                      onContextMenu={(e) => handleContextMenu(e, file)}
                    >
                      {/* Thumbnail Container */}
                      <div className="relative aspect-[4/3] bg-md-surface-container flex items-center justify-center overflow-hidden shrink-0">
                        <FileCardThumbnail
                          file={file}
                          client={client}
                          driveConfig={driveConfig}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                        
                        {/* Floating Checkbox */}
                        <div 
                          className={`absolute top-2.5 left-2.5 z-10 transition-opacity duration-200 ${
                            isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                          }`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => onToggleSelect?.(file.id)}
                            className={`${checkBtnSize} rounded-full border flex items-center justify-center transition-all duration-200 ${
                              isSelected 
                                ? "bg-md-primary border-md-primary text-md-on-primary shadow-md scale-100" 
                                : "border-md-outline-variant bg-white/70 dark:bg-md-surface-container/70 hover:scale-110 active:scale-95"
                            }`}
                          >
                            {isSelected && (
                              <svg className={checkIconSize} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </button>
                        </div>

                        {/* File Extension tag */}
                        <div className={`absolute top-2.5 right-2.5 bg-md-inverse-surface/70 backdrop-blur-[6px] py-0.5 rounded-[6px] font-semibold uppercase text-md-inverse-on-surface tracking-wider select-none border border-white/5 shadow-sm ${extTagTextSize}`}>
                          {file.name.split(".").pop()?.toLowerCase() || "file"}
                        </div>

                        {/* Floating Favorite Button */}
                        <div
                          className={`absolute bottom-2.5 right-2.5 z-10 transition-opacity duration-200 ${
                            isLiked ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                          }`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => onToggleLike?.(file)}
                            className={`${likeBtnSize} rounded-full border flex items-center justify-center transition-all duration-200 ${
                              isLiked 
                                ? "bg-md-error border-md-error text-md-on-error shadow-md scale-100" 
                                : "border-md-outline-variant bg-white/70 dark:bg-md-surface-container/70 hover:scale-110 active:scale-95 text-md-on-surface-variant"
                            }`}
                          >
                            <svg className={likeIconSize} fill={isLiked ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={isLiked ? 0 : 2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                            </svg>
                          </button>
                        </div>
                      </div>

                      {/* Title & Metadata */}
                      <div className={`${cardPadding} select-none flex flex-col justify-between flex-grow min-w-0`}>
                        <p className={`${titleTextSize} text-md-on-surface truncate tracking-tight group-hover:text-md-primary transition-colors`} title={file.name}>
                          {file.name}
                        </p>

                        {/* Subtitle / Action Row */}
                        <div className={metaRowClass}>
                          {/* Default State: File size */}
                          <span className="group-hover:opacity-0 transition-opacity duration-150 shrink-0">
                            {formatBytes(file.size)}
                          </span>
                          
                          {/* Hover State: Actions bar */}
                          <div
                            className="absolute bottom-0 right-0 opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity duration-200"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              onClick={() => onDownload(file)}
                              className="p-1 rounded-md hover:bg-md-surface-container-high text-md-on-surface-variant hover:text-md-primary active:scale-90 transition-all cursor-pointer"
                              title="Download"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                              </svg>
                            </button>
                            <button
                              onClick={(e) => {
                                const rect = e.currentTarget.getBoundingClientRect();
                                handleContextMenu(e, file, rect);
                              }}
                              className="p-1 rounded-md hover:bg-md-surface-container-high text-md-on-surface-variant hover:text-md-primary active:scale-90 transition-all cursor-pointer"
                              title="More options"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.75a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm0 6.75a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm0 6.75a1.5 1.5 0 110-3 1.5 1.5 0 010 3z" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {contextMenu.visible && contextMenu.file && (
        <div
          className="fixed z-[100] bg-md-surface-container backdrop-blur-xl border border-md-outline-variant/30 rounded-[12px] py-2 min-w-[170px] animate-scale-in select-none text-left"
          style={{
            top: `${contextMenu.y}px`,
            left: `${contextMenu.x}px`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              if (contextMenu.file) onPreview(contextMenu.file);
              setContextMenu((prev) => ({ ...prev, visible: false }));
            }}
            className="w-full text-left px-3.5 py-2.5 text-xs font-medium text-md-on-surface hover:bg-md-surface-container-high flex items-center gap-2 cursor-pointer transition-colors min-h-[40px]"
          >
            <svg className="w-4 h-4 text-md-on-surface-variant" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            Open / View
          </button>

          {onOpenDetails && (
            <button
              onClick={() => {
                if (contextMenu.file) onOpenDetails(contextMenu.file);
                setContextMenu((prev) => ({ ...prev, visible: false }));
              }}
              className="w-full text-left px-3.5 py-2.5 text-xs font-medium text-md-on-surface hover:bg-md-surface-container-high flex items-center gap-2 cursor-pointer transition-colors min-h-[40px]"
            >
              <svg className="w-4 h-4 text-md-on-surface-variant" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Details
            </button>
          )}
          
          <button
            onClick={() => {
              if (contextMenu.file) onDownload(contextMenu.file);
              setContextMenu((prev) => ({ ...prev, visible: false }));
            }}
            className="w-full text-left px-3.5 py-2.5 text-xs font-bold text-surface-700 dark:text-surface-600 hover:bg-brand-500/10 hover:text-brand-500 flex items-center gap-2 cursor-pointer transition-colors"
          >
            <svg className="w-4 h-4 text-surface-450 dark:text-surface-550" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download
          </button>

          {onShare && (
            <button
              onClick={() => {
                if (contextMenu.file) onShare(contextMenu.file);
                setContextMenu((prev) => ({ ...prev, visible: false }));
              }}
              className="w-full text-left px-3.5 py-2.5 text-xs font-bold text-surface-700 dark:text-surface-600 hover:bg-brand-500/10 hover:text-brand-500 flex items-center gap-2 cursor-pointer transition-colors"
            >
              <svg className="w-4 h-4 text-surface-450 dark:text-surface-550" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
              </svg>
              Share File
            </button>
          )}

          {onToggleSelect && (
            <button
              onClick={() => {
                if (contextMenu.file) onToggleSelect(contextMenu.file.id);
                setContextMenu((prev) => ({ ...prev, visible: false }));
              }}
              className="w-full text-left px-3.5 py-2.5 text-xs font-bold text-surface-700 dark:text-surface-600 hover:bg-brand-500/10 hover:text-brand-500 flex items-center gap-2 cursor-pointer transition-colors"
            >
              <svg className="w-4 h-4 text-surface-450 dark:text-surface-550" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              {selectedFileIds.has(contextMenu.file.id) ? "Deselect" : "Select"}
            </button>
          )}

          {onOpenMoveCopy && (
            <button
              onClick={() => {
                if (contextMenu.file) onOpenMoveCopy([contextMenu.file]);
                setContextMenu((prev) => ({ ...prev, visible: false }));
              }}
              className="w-full text-left px-3.5 py-2.5 text-xs font-bold text-surface-700 dark:text-surface-600 hover:bg-brand-500/10 hover:text-brand-500 flex items-center gap-2 cursor-pointer transition-colors"
            >
              <svg className="w-4 h-4 text-surface-450 dark:text-surface-550" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
              Move / Copy
            </button>
          )}

          {(onRename || onDelete || onOpenMoveCopy) && <div className="h-[1px] bg-md-outline-variant/30 my-1" />}

          {onRename && (
            <button
              onClick={() => {
                if (contextMenu.file) onRename(contextMenu.file);
                setContextMenu((prev) => ({ ...prev, visible: false }));
              }}
              className="w-full text-left px-3.5 py-2.5 text-xs font-bold text-surface-700 dark:text-surface-600 hover:bg-brand-500/10 hover:text-brand-500 flex items-center gap-2 cursor-pointer transition-colors"
            >
              <svg className="w-4 h-4 text-surface-450 dark:text-surface-550" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
              </svg>
              Rename
            </button>
          )}

          {onDelete && (
            <button
              onClick={() => {
                if (contextMenu.file) onDelete(contextMenu.file);
                setContextMenu((prev) => ({ ...prev, visible: false }));
              }}
              className="w-full text-left px-3.5 py-2.5 text-xs font-medium text-md-error hover:bg-md-error-container/30 flex items-center gap-2 cursor-pointer transition-colors min-h-[40px]"
            >
              <svg className="w-4 h-4 text-md-error" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}
