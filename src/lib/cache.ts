/**
 * Persistent IndexedDB cache for preview chunks.
 * Provides instant loading on repeat visits without any network requests.
 */

const DB_NAME = "clashdrive_cache";
const DB_VERSION = 2;
const CHUNK_STORE = "chunks";
const MAX_CHUNK_ENTRIES = 100;
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const KEY_SEPARATOR = "\0"; // Null char - cannot appear in fileId or chunkIndex

let _db: IDBDatabase | null = null;
let _dbPromise: Promise<IDBDatabase | null> | null = null;

function openDB(): Promise<IDBDatabase | null> {
  if (_db) return Promise.resolve(_db);
  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(CHUNK_STORE)) {
          const store = db.createObjectStore(CHUNK_STORE, { keyPath: "key" });
          store.createIndex("timestamp", "timestamp", { unique: false });
        }
      };

      request.onsuccess = () => {
        _db = request.result;
        _db.onclose = () => {
          _db = null;
          _dbPromise = null;
        };
        resolve(_db);
      };

      request.onerror = () => {
        console.warn("[Cache] IndexedDB open failed:", request.error);
        _dbPromise = null;
        resolve(null);
      };
    } catch {
      _dbPromise = null;
      resolve(null);
    }
  });

  return _dbPromise;
}

// ─── Chunk Cache (for preview chunk 0) ─────────────────────

export async function getCachedChunk(
  fileId: string,
  chunkIndex: number
): Promise<Uint8Array | null> {
  const db = await openDB();
  if (!db) return null;

  const key = `${fileId}${KEY_SEPARATOR}${chunkIndex}`;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(CHUNK_STORE, "readonly");
      const req = tx.objectStore(CHUNK_STORE).get(key);

      req.onsuccess = () => {
        const entry = req.result;
        if (!entry) {
          resolve(null);
          return;
        }
        if (Date.now() - entry.timestamp > EXPIRY_MS) {
          deleteCachedChunk(key);
          resolve(null);
          return;
        }
        resolve(new Uint8Array(entry.data));
      };

      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function setCachedChunk(
  fileId: string,
  chunkIndex: number,
  data: Uint8Array
): Promise<void> {
  const db = await openDB();
  if (!db) return;

  const key = `${fileId}${KEY_SEPARATOR}${chunkIndex}`;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(CHUNK_STORE, "readwrite");
      const store = tx.objectStore(CHUNK_STORE);
      store.put({
        key,
        data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
        timestamp: Date.now(),
      });
      tx.oncomplete = () => {
        evictOldChunks();
        resolve();
      };
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function deleteCachedChunk(key: string): Promise<void> {
  const db = await openDB();
  if (!db) return;

  try {
    const tx = db.transaction(CHUNK_STORE, "readwrite");
    tx.objectStore(CHUNK_STORE).delete(key);
  } catch {
    // ignore
  }
}

/**
 * Evict oldest chunk entries if count exceeds MAX_CHUNK_ENTRIES.
 */
async function evictOldChunks(): Promise<void> {
  const db = await openDB();
  if (!db) return;

  try {
    const tx = db.transaction(CHUNK_STORE, "readwrite");
    const store = tx.objectStore(CHUNK_STORE);
    const countReq = store.count();

    countReq.onsuccess = () => {
      if (countReq.result <= MAX_CHUNK_ENTRIES) return;

      const toDelete = countReq.result - MAX_CHUNK_ENTRIES;
      const index = store.index("timestamp");
      const cursor = index.openCursor();
      let deleted = 0;

      cursor.onsuccess = () => {
        const c = cursor.result;
        if (c && deleted < toDelete) {
          c.delete();
          deleted++;
          c.continue();
        }
      };
    };
  } catch {
    // ignore eviction errors
  }
}
