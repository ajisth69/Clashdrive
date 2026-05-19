/**
 * Telegram MTProto API credentials.
 * Using the official Telegram Web K application keys—safe for client-side use.
 */
export const API_ID = 2496;
export const API_HASH = "8da85b0d5bfe62527e5b244c209159c3";

/**
 * Signature embedded in the group description so
 * the radar can discover the drive across devices.
 */
export const DRIVE_SIGNATURE = "#TgCloudDrive_v1";

/**
 * Default supergroup title when auto-creating.
 */
export const DEFAULT_DRIVE_TITLE = "TG Cloud Drive";

/**
 * Chunk size for file splitting (50 MB).
 */
export const CHUNK_SIZE = 50 * 1024 * 1024;

/**
 * Concurrent upload workers — stay conservative to avoid FloodWait.
 */
export const UPLOAD_WORKERS = 6;

/**
 * sessionStorage keys
 */
export const LS_SESSION = "tgcd_session";
export const LS_PHONE = "tgcd_phone";
export const LS_DRIVE = "tgcd_drive";
