import { POSE_MODEL, POSE_VERSION, type PoseTrack } from './types.ts'

const DB_NAME = 'frametune-pose'
const STORE = 'tracks'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('indexeddb-unavailable')); return }
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE) }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('indexeddb-failed'))
  })
}

/** The trailing file-modified time is dropped so the same video re-picked on a phone still hits the cache. */
export const poseCacheKey = (videoKey: string, fps: number) => `${videoKey.replace(/:\d+$/, '')}|${POSE_MODEL}|v${POSE_VERSION}|${fps}fps`

export async function loadPoseTrack(key: string): Promise<PoseTrack | null> {
  try {
    const db = await open()
    return await new Promise<PoseTrack | null>((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(key)
      request.onsuccess = () => { const value = request.result as PoseTrack | undefined; resolve(value && value.version === POSE_VERSION ? value : null) }
      request.onerror = () => reject(request.error)
    }).finally(() => db.close())
  } catch { return null }
}

export async function savePoseTrack(key: string, track: PoseTrack): Promise<void> {
  try {
    const db = await open()
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite')
      transaction.objectStore(STORE).put(track, key)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    }).finally(() => db.close())
  } catch { /* Pose data is a cache; failing to store it only means re-analysis next time. */ }
}

export async function deletePoseTrack(key: string): Promise<void> {
  try {
    const db = await open()
    await new Promise<void>((resolve) => {
      const transaction = db.transaction(STORE, 'readwrite')
      transaction.objectStore(STORE).delete(key)
      transaction.oncomplete = () => resolve(); transaction.onerror = () => resolve()
    }).finally(() => db.close())
  } catch { /* nothing cached */ }
}

/** Removes every cached pose track whose key starts with `prefix` (one video, any model version). */
export async function deletePoseTracksFor(prefix: string): Promise<void> {
  try {
    const db = await open()
    await new Promise<void>((resolve) => {
      const transaction = db.transaction(STORE, 'readwrite')
      const request = transaction.objectStore(STORE).openKeyCursor()
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) return
        if (typeof cursor.key === 'string' && cursor.key.startsWith(`${prefix}|`)) transaction.objectStore(STORE).delete(cursor.key)
        cursor.continue()
      }
      transaction.oncomplete = () => resolve(); transaction.onerror = () => resolve(); transaction.onabort = () => resolve()
    }).finally(() => db.close())
  } catch { /* nothing cached */ }
}
