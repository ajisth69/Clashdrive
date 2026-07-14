/**
 * Retrieve Telegram MTProto API credentials dynamically from localStorage.
 */
export function getApiCredentials(): { apiId: number; apiHash: string } {
  const idStr = localStorage.getItem("tgcd_api_id") || "";
  const hash = localStorage.getItem("tgcd_api_hash") || "";
  return {
    apiId: idStr ? parseInt(idStr, 10) : 0,
    apiHash: hash,
  };
}

/**
 * Client Identification for Telegram Active Sessions screen
 */
export const DEVICE_MODEL = "ClashDrive";
export const APP_VERSION = "1.0";
export const SYSTEM_VERSION = typeof navigator !== "undefined" && navigator.userAgent
  ? (navigator.userAgent.includes("Windows") ? "Windows" : navigator.userAgent.includes("Mac") ? "macOS" : navigator.userAgent.includes("Linux") ? "Linux" : "Web")
  : "Web";

/**
 * Signature embedded in the group description so
 * the radar can discover the drive across devices.
 */
export const DRIVE_SIGNATURE = "#TgCloudDrive_v1";

/**
 * Default supergroup title when auto-creating.
 */
export const DEFAULT_DRIVE_TITLE = "Clash Drive";

/**
 * Chunk size for file splitting (50 MB).
 */
export const CHUNK_SIZE = 50 * 1024 * 1024;

/**
 * Concurrent upload workers — stay conservative to avoid FloodWait.
 */
export const UPLOAD_WORKERS = 8;

/**
 * localStorage keys
 */
export const LS_SESSION = "tgcd_session";
export const LS_PHONE = "tgcd_phone";
export const LS_DRIVE = "tgcd_drive";
