import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { getApiCredentials, LS_SESSION, DEVICE_MODEL, SYSTEM_VERSION, APP_VERSION } from "../config/telegram";

let _client: TelegramClient | null = null;
let _monitorInterval: ReturnType<typeof setInterval> | null = null;
let _reconnecting = false;
const _connectionListeners = new Set<(connected: boolean) => void>();

/**
 * Register an active client singleton instance.
 */
export function setClient(client: TelegramClient): void {
  stopConnectionMonitor();
  _client = client;
}

/**
 * Build (or return existing) TelegramClient with the saved session string.
 * Callers must await `.connect()` themselves if the client isn't live yet.
 */
export function getClient(): TelegramClient {
  if (_client) return _client;

  const saved = localStorage.getItem(LS_SESSION) ?? "";
  const session = new StringSession(saved);
  const { apiId, apiHash } = getApiCredentials();

  _client = new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 10,
    useWSS: true,
    autoReconnect: true,
    floodSleepThreshold: 300,
    maxConcurrentDownloads: 128,
    deviceModel: DEVICE_MODEL,
    systemVersion: SYSTEM_VERSION,
    appVersion: APP_VERSION,
  });

  return _client;
}

export function createClientFromSession(
  sessionString = "",
  apiId?: number,
  apiHash?: string
): TelegramClient {
  const creds = getApiCredentials();
  const id = apiId ?? creds.apiId;
  const hash = apiHash ?? creds.apiHash;
  return new TelegramClient(new StringSession(sessionString), id, hash, {
    connectionRetries: 10,
    useWSS: true,
    autoReconnect: true,
    floodSleepThreshold: 300,
    maxConcurrentDownloads: 128,
    deviceModel: DEVICE_MODEL,
    systemVersion: SYSTEM_VERSION,
    appVersion: APP_VERSION,
  });
}

/**
 * Persist the current session token so next page-load skips login.
 */
export function persistSession(): void {
  if (!_client) return;
  const token = (_client.session as StringSession).save();
  localStorage.setItem(LS_SESSION, token);
}

export function getCurrentSessionString(): string {
  if (!_client) return localStorage.getItem(LS_SESSION) ?? "";
  return (_client.session as StringSession).save();
}

/**
 * Destroy session, disconnect, and wipe the singleton.
 */
export async function destroyClient(): Promise<void> {
  stopConnectionMonitor();
  if (_client) {
    await _client.disconnect();
    _client = null;
  }
  localStorage.removeItem(LS_SESSION);
}

/**
 * True when a session string already exists in storage.
 */
export function hasPersistedSession(): boolean {
  const s = localStorage.getItem(LS_SESSION);
  return !!s && s.length > 0;
}

/**
 * Subscribe to connection health changes.
 * Listener receives `true` when the connection is restored, `false` when lost.
 */
export function onConnectionChange(listener: (connected: boolean) => void): () => void {
  _connectionListeners.add(listener);
  return () => { _connectionListeners.delete(listener); };
}

function notifyConnectionListeners(connected: boolean) {
  _connectionListeners.forEach((fn) => {
    try { fn(connected); } catch { /* ignore */ }
  });
}

/**
 * Check if the client's underlying connection is alive.
 * Uses the internal `connected` property from GramJS.
 */
export function isClientConnected(): boolean {
  if (!_client) return false;
  try {
    // GramJS exposes `connected` on the client
    return !!(_client as unknown as { connected?: boolean }).connected;
  } catch {
    return false;
  }
}

/**
 * Ensure the client is connected. If disconnected, attempt reconnection.
 * Safe to call before any API operation.
 */
export async function ensureConnected(): Promise<boolean> {
  if (!_client) return false;
  if (isClientConnected()) return true;
  if (_reconnecting) {
    // Wait for the ongoing reconnection attempt
    await new Promise((r) => setTimeout(r, 2000));
    return isClientConnected();
  }

  _reconnecting = true;
  try {
    console.warn("[tgcd] Client disconnected, attempting reconnect...");
    await _client.connect();
    console.log("[tgcd] Reconnected successfully.");
    notifyConnectionListeners(true);
    return true;
  } catch (err) {
    console.error("[tgcd] Reconnection failed:", err);
    notifyConnectionListeners(false);
    return false;
  } finally {
    _reconnecting = false;
  }
}

/**
 * Start a background monitor that periodically checks the connection
 * and reconnects if needed. Should be called once after successful auth.
 */
export function startConnectionMonitor(): void {
  stopConnectionMonitor();
  // Check every 15 seconds
  _monitorInterval = setInterval(async () => {
    if (!_client || _reconnecting) return;
    if (!isClientConnected()) {
      console.warn("[tgcd] Connection monitor detected disconnect.");
      await ensureConnected();
    }
  }, 15_000);
}

/**
 * Stop the connection health monitor.
 */
export function stopConnectionMonitor(): void {
  if (_monitorInterval) {
    clearInterval(_monitorInterval);
    _monitorInterval = null;
  }
}
