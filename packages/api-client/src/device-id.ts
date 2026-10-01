const STORAGE_KEY = 'compass.deviceId';
let memoryId: string | undefined;

const newId = (): string => globalThis.crypto.randomUUID();

/**
 * The id this browser sends as x-device-id. Kept in localStorage; falls back to memory when
 * storage is missing or blocked. The offline outbox (src/offline) will move it to IndexedDB.
 */
export const getDeviceId = (): string => {
  try {
    const storage = globalThis.localStorage as Storage | undefined;
    if (storage) {
      const stored = storage.getItem(STORAGE_KEY);
      if (stored) return stored;
      const id = newId();
      storage.setItem(STORAGE_KEY, id);
      return id;
    }
  } catch {
    // Storage is blocked (private mode, sandboxed frame): keep the id for this session only.
  }
  memoryId ??= newId();
  return memoryId;
};
