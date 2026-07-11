/**
 * Telegram MTProto API credentials.
 * Using the official Telegram Web K application keys—safe for client-side use.
 */
export const API_ID = 2496;
export const API_HASH = "8da85b0d5bfe62527e5b244c209159c3";

/**
 * Client Identification for Telegram Active Sessions screen
 */
export const DEVICE_MODEL = "ClashDrive";
export const APP_VERSION = "2.0.0";
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
