import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { API_ID, API_HASH, LS_SESSION } from "../config/telegram";

let _client: TelegramClient | null = null;

/**
 * Register an active client singleton instance.
 */
export function setClient(client: TelegramClient): void {
  _client = client;
}

/**
 * Build (or return existing) TelegramClient with the saved session string.
 * Callers must await `.connect()` themselves if the client isn't live yet.
 */
export function getClient(): TelegramClient {
  if (_client) return _client;

  const saved = sessionStorage.getItem(LS_SESSION) ?? "";
  const session = new StringSession(saved);

  _client = new TelegramClient(session, API_ID, API_HASH, {
    connectionRetries: 10,
    useWSS: true,
    autoReconnect: true,
    floodSleepThreshold: 300,
    maxConcurrentDownloads: 32,
  });

  return _client;
}

export function createClientFromSession(sessionString = ""): TelegramClient {
  return new TelegramClient(new StringSession(sessionString), API_ID, API_HASH, {
    connectionRetries: 10,
    useWSS: true,
    autoReconnect: true,
    floodSleepThreshold: 300,
    maxConcurrentDownloads: 32,
  });
}

/**
 * Persist the current session token so next page-load skips login.
 */
export function persistSession(): void {
  if (!_client) return;
  const token = (_client.session as StringSession).save();
  sessionStorage.setItem(LS_SESSION, token);
}

export function getCurrentSessionString(): string {
  if (!_client) return sessionStorage.getItem(LS_SESSION) ?? "";
  return (_client.session as StringSession).save();
}

/**
 * Destroy session, disconnect, and wipe the singleton.
 */
export async function destroyClient(): Promise<void> {
  if (_client) {
    await _client.disconnect();
    _client = null;
  }
  sessionStorage.removeItem(LS_SESSION);
}

/**
 * True when a session string already exists in storage.
 */
export function hasPersistedSession(): boolean {
  const s = sessionStorage.getItem(LS_SESSION);
  return !!s && s.length > 0;
}
