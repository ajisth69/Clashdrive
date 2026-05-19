import type { ChunkManifest } from "../types";

/**
 * Try to parse a message as a file manifest.
 * Returns null if the message text isn't a valid segmented_file JSON payload.
 */
export function parseManifest(text: string): ChunkManifest | null {
  try {
    const data = JSON.parse(text);
    if (
      data &&
      data.type === "segmented_file" &&
      typeof data.fileName === "string" &&
      typeof data.fileSize === "number" &&
      Array.isArray(data.chunks)
    ) {
      return data as ChunkManifest;
    }
  } catch {
    // Not JSON — regular message or a raw chunk, skip it
  }
  return null;
}

/**
 * Build the JSON string that gets sent as the final manifest message.
 */
export function buildManifest(
  fileName: string,
  fileSize: number,
  chunkMsgIds: number[]
): string {
  const manifest: ChunkManifest = {
    type: "segmented_file",
    fileName,
    fileSize,
    chunks: chunkMsgIds,
  };
  return JSON.stringify(manifest);
}

/**
 * Format bytes into a human-readable string.
 */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0 || !isFinite(bytes)) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

/**
 * Guess a file's icon based on its extension.
 */
export function getFileIcon(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    // Images
    png: "🖼️",
    jpg: "🖼️",
    jpeg: "🖼️",
    gif: "🖼️",
    webp: "🖼️",
    svg: "🖼️",
    // Video
    mp4: "🎬",
    mkv: "🎬",
    avi: "🎬",
    mov: "🎬",
    webm: "🎬",
    // Audio
    mp3: "🎵",
    wav: "🎵",
    flac: "🎵",
    ogg: "🎵",
    aac: "🎵",
    // Documents
    pdf: "📕",
    doc: "📝",
    docx: "📝",
    txt: "📄",
    md: "📄",
    // Archives
    zip: "📦",
    rar: "📦",
    "7z": "📦",
    tar: "📦",
    gz: "📦",
    // Code
    js: "💻",
    ts: "💻",
    py: "💻",
    rs: "💻",
    go: "💻",
    java: "💻",
    // Data
    json: "📊",
    csv: "📊",
    xlsx: "📊",
    // Executables
    exe: "⚙️",
    msi: "⚙️",
    apk: "📱",
    iso: "💿",
  };
  return map[ext] || "📁";
}
