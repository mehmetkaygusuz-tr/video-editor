const memoryFallback = new Map<string, File>();

let isOPFSAvailable: boolean | null = null;

async function checkOPFS(): Promise<boolean> {
  if (isOPFSAvailable !== null) return isOPFSAvailable;
  try {
    await navigator.storage.getDirectory();
    isOPFSAvailable = true;
  } catch (error) {
    isOPFSAvailable = false;
  }
  return isOPFSAvailable;
}

export function sanitizeFilename(filename: string): string {
  if (!filename) return `file_${Date.now()}`;
  const clean = filename.replace(/[/\\?%*:|"<>]/g, '_').trim();
  return clean.replace(/^(\.\.[\/\\])+/, '') || `file_${Date.now()}`;
}

export async function saveFileToOPFS(file: File, filename: string): Promise<FileSystemFileHandle | null> {
  const safeName = sanitizeFilename(filename);
  const available = await checkOPFS();
  if (available) {
    try {
      const opfsRoot = await navigator.storage.getDirectory();
      const fileHandle = await opfsRoot.getFileHandle(safeName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(file);
      await writable.close();
      // File persisted safely in OPFS disk; release from memory fallback
      memoryFallback.delete(safeName);
      return fileHandle;
    } catch (error) {
      console.warn("[OPFS] Write failed, falling back to memory:", error);
      memoryFallback.set(safeName, file);
      return null;
    }
  } else {
    memoryFallback.set(safeName, file);
    return null;
  }
}

export async function getFileFromOPFS(filename: string): Promise<File | null> {
  const safeName = sanitizeFilename(filename);
  const available = await checkOPFS();
  if (available) {
    try {
      const opfsRoot = await navigator.storage.getDirectory();
      const fileHandle = await opfsRoot.getFileHandle(safeName);
      return await fileHandle.getFile();
    } catch (error) {
      // Not found in OPFS, fallback to memory
    }
  }

  if (memoryFallback.has(safeName)) {
    return memoryFallback.get(safeName)!;
  }
  
  return null;
}

export async function deleteFileFromOPFS(filename: string): Promise<boolean> {
  const safeName = sanitizeFilename(filename);
  memoryFallback.delete(safeName);
  const available = await checkOPFS();
  if (available) {
    try {
      const opfsRoot = await navigator.storage.getDirectory();
      await opfsRoot.removeEntry(safeName, { recursive: false });
      return true;
    } catch (error: any) {
      if (error?.name === 'NotFoundError') {
        return true; // Already removed
      }
      console.warn("[OPFS] Failed to remove entry:", safeName, error);
      return false;
    }
  }
  return true;
}

/**
 * STANDARD #6 (WHATWG OPFS): 
 * To be used EXCLUSIVELY inside Web Workers (like demuxer.worker.ts)
 * Provides synchronous, lock-free, zero-RAM read/write access to large video files.
 */
export async function getSyncAccessHandleInWorker(filename: string): Promise<any | null> {
  try {
    const opfsRoot = await navigator.storage.getDirectory();
    const fileHandle = await opfsRoot.getFileHandle(filename);
    // @ts-ignore - createSyncAccessHandle is only available in Worker context
    return await fileHandle.createSyncAccessHandle();
  } catch (error) {
    console.error("[OPFS] Failed to create SyncAccessHandle", error);
    return null;
  }
}


