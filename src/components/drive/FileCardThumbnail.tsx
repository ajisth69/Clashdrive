import React, { useState, useEffect } from "react";
import type { TelegramClient } from "telegram";
import type { DriveConfig, DriveFile } from "../../types";
import { downloadChunkToCache, downloadThumbnailById } from "../../lib/downloader";

function getPlaceholderConfig(fileName: string): { colorText: string; colorBg: string; emblem: React.ReactNode } {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";

  const c = {
    green:    { text: "#10b981", bg: "#10b9811c" },
    purple:   { text: "#8b5cf6", bg: "#8b5cf61c" },
    cyan:     { text: "#06b6d4", bg: "#06b6d41c" },
    red:      { text: "#ef4444", bg: "#ef44441c" },
    blue:     { text: "#3b82f6", bg: "#3b82f61c" },
    orange:   { text: "#f97316", bg: "#f973161c" },
    amber:    { text: "#f59e0b", bg: "#f59e0b1c" },
    slate:    { text: "#64748b", bg: "#64748b1c" },
    lime:     { text: "#84cc16", bg: "#84cc161c" },
    indigo:   { text: "#6366f1", bg: "#6366f11c" },
    grey:     { text: "#94a3b8", bg: "#94a3b81c" },
    charcoal: { text: "#4b5563", bg: "#4b55631c" },
  };

  if (["png","jpg","jpeg","gif","webp","svg","bmp","avif","heic","tiff"].includes(ext)) {
    return {
      colorText: c.green.text,
      colorBg: c.green.bg,
      emblem: <path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />,
    };
  }

  if (["mp4","mkv","avi","mov","webm","flv","3gp","ts","mts","m2ts"].includes(ext)) {
    return {
      colorText: c.purple.text,
      colorBg: c.purple.bg,
      emblem: <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />,
    };
  }

  if (["mp3","wav","m4a","flac","ogg","aac","opus","oga","caf","wma","dsf","dff","ape","alac","mka"].includes(ext)) {
    return {
      colorText: c.cyan.text,
      colorBg: c.cyan.bg,
      emblem: <path d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />,
    };
  }

  if (ext === "pdf") {
    return {
      colorText: c.red.text,
      colorBg: c.red.bg,
      emblem: <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />,
    };
  }

  if (["doc","docx","pages"].includes(ext)) {
    return {
      colorText: c.blue.text,
      colorBg: c.blue.bg,
      emblem: <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />,
    };
  }

  if (["xls","xlsx","numbers"].includes(ext)) {
    return {
      colorText: c.green.text,
      colorBg: c.green.bg,
      emblem: <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />,
    };
  }

  if (["ppt","pptx","key","keynote"].includes(ext)) {
    return {
      colorText: c.orange.text,
      colorBg: c.orange.bg,
      emblem: <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />,
    };
  }

  if (["zip","rar","7z","tar","gz","tgz"].includes(ext)) {
    return {
      colorText: c.amber.text,
      colorBg: c.amber.bg,
      emblem: <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />,
    };
  }

  if (["js","ts","jsx","tsx","py","rs","go","java","cpp","c","html","css","json","sql","db","xml","yaml","yml"].includes(ext)) {
    return {
      colorText: c.slate.text,
      colorBg: c.slate.bg,
      emblem: <path d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />,
    };
  }

  if (ext === "apk") {
    return {
      colorText: c.lime.text,
      colorBg: c.lime.bg,
      emblem: <path d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9h14M5 15h14M3 6h18v12H3z" />,
    };
  }

  if (["exe","msi","dmg","pkg","bat","cmd","sh"].includes(ext)) {
    return {
      colorText: c.indigo.text,
      colorBg: c.indigo.bg,
      emblem: <path d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9h14M5 15h14M3 6h18v12H3z" />,
    };
  }

  if (ext === "iso") {
    return {
      colorText: c.grey.text,
      colorBg: c.grey.bg,
      emblem: <circle cx="12" cy="12" r="9" />,
    };
  }

  return {
    colorText: c.charcoal.text,
    colorBg: c.charcoal.bg,
    emblem: <path d="M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />,
  };
}

const thumbnailCache = new Map<number, string>();
const loadingPromises = new Map<number, Promise<string | null>>();

class ConcurrencyQueue {
  private activeCount = 0;
  private queue: (() => void)[] = [];

  constructor(private maxConcurrency: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.activeCount >= this.maxConcurrency) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.activeCount++;
    try {
      return await fn();
    } finally {
      this.activeCount--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

const thumbnailQueue = new ConcurrencyQueue(2); // Limit concurrent thumbnail downloads to 2

async function loadThumbnail(
  file: DriveFile,
  client: TelegramClient,
  driveConfig: DriveConfig
): Promise<string | null> {
  const thumbMsgId = file.manifest.thumb;

  // 1. If there's an uploaded thumbnail stored on Telegram:
  if (thumbMsgId !== undefined) {
    if (thumbnailCache.has(thumbMsgId)) {
      return thumbnailCache.get(thumbMsgId)!;
    }

    if (loadingPromises.has(thumbMsgId)) {
      return loadingPromises.get(thumbMsgId)!;
    }

    const promise = thumbnailQueue.run(async () => {
      try {
        const data = await downloadThumbnailById(client, driveConfig, thumbMsgId);
        const blob = new Blob([Uint8Array.from(data)], { type: "image/jpeg" });
        const blobUrl = URL.createObjectURL(blob);
        thumbnailCache.set(thumbMsgId, blobUrl);
        return blobUrl;
      } catch (err) {
        console.warn("Failed to download thumbnail", thumbMsgId, err);
        return null;
      } finally {
        loadingPromises.delete(thumbMsgId);
      }
    });

    loadingPromises.set(thumbMsgId, promise);
    return promise;
  }

  // 2. Otherwise, if it is an image and <= 3MB:
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const isImage = ["png","jpg","jpeg","gif","webp","svg","bmp","avif","heic","tiff"].includes(ext);
  if (isImage && file.size <= 3 * 1024 * 1024) {
    if (thumbnailCache.has(file.id)) {
      return thumbnailCache.get(file.id)!;
    }

    if (loadingPromises.has(file.id)) {
      return loadingPromises.get(file.id)!;
    }

    const promise = thumbnailQueue.run(async () => {
      try {
        const data = await downloadChunkToCache(client, driveConfig, file.id.toString(), file.manifest, 0);
        const blob = new Blob([Uint8Array.from(data)], { type: "image/jpeg" });
        const blobUrl = URL.createObjectURL(blob);
        thumbnailCache.set(file.id, blobUrl);
        return blobUrl;
      } catch (err) {
        console.warn("Failed to download image chunk 0", file.id, err);
        return null;
      } finally {
        loadingPromises.delete(file.id);
      }
    });

    loadingPromises.set(file.id, promise);
    return promise;
  }

  return null;
}

interface FileCardThumbnailProps {
  file: DriveFile;
  client?: TelegramClient | null;
  driveConfig?: DriveConfig | null;
  className?: string;
}

export function FileCardThumbnail({
  file,
  client,
  driveConfig,
  className = "w-full h-full",
}: FileCardThumbnailProps) {
  const { id: fileId, name: fileName } = file;
  const cfg = getPlaceholderConfig(fileName);

  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const isImage = ["png","jpg","jpeg","gif","webp","svg","bmp","avif","heic","tiff"].includes(ext);
  const hasUploadedThumb = file.manifest.thumb !== undefined;
  const canLoadThumb = hasUploadedThumb || (isImage && file.size <= 3 * 1024 * 1024);

  const [thumbUrl, setThumbUrl] = useState<string | null>(() => {
    if (hasUploadedThumb) {
      return thumbnailCache.get(file.manifest.thumb!) || null;
    }
    return thumbnailCache.get(fileId) || null;
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!client || !driveConfig || !canLoadThumb) {
      return;
    }

    const cacheKey = hasUploadedThumb ? file.manifest.thumb! : fileId;
    if (thumbnailCache.has(cacheKey)) {
      setThumbUrl(thumbnailCache.get(cacheKey) || null);
      return;
    }

    let active = true;
    setLoading(true);

    loadThumbnail(file, client, driveConfig)
      .then((url) => {
        if (!active) return;
        setThumbUrl(url);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [file, client, driveConfig, fileId, canLoadThumb, hasUploadedThumb]);

  if (loading) {
    return (
      <div className="relative w-full h-full flex items-center justify-center overflow-hidden bg-transparent">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center animate-pulse"
          style={{ backgroundColor: cfg.colorBg }}
        >
          <div
            className="w-4 h-4 border-2 border-transparent rounded-full animate-spin"
            style={{ borderTopColor: cfg.colorText, borderLeftColor: cfg.colorText }}
          />
        </div>
      </div>
    );
  }

  if (thumbUrl) {
    return (
      <img
        src={thumbUrl}
        alt={fileName}
        className={className}
        loading="lazy"
      />
    );
  }

  return (
    <svg
      className={className}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="50" cy="50" r="42" fill={cfg.colorBg} />
      <g transform="translate(26, 26) scale(2.0)" stroke={cfg.colorText} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none">
        {cfg.emblem}
      </g>
    </svg>
  );
}