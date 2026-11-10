import { analyzeVideoAudio } from './tempoAnalysis.ts'
import type { AudioAnalysis } from '../beats/audioAnalysis.ts'
import { deletePoseTracksFor } from '../pose/poseCache.ts'

/**
 * Saved alignment data per video, in IndexedDB. Only numbers are stored (BPM, first beat, level, manual
 * fixes, custom cuts, the audio-analysis result); the video file itself is never kept, so it has to be
 * picked again. The id is name + size, stable across re-picks (the file's modified time is not always).
 */
const DB_NAME = 'frametune-dances'
const STORE = 'dances'
const PRACTICE_PREFIX = 'adl-practice:'
const COUNT_PREFIX = 'adl-count:'

export interface DanceRecord {
  id: string; name: string; size: number; duration: number; savedAt: number
  practice: string | null; count: string | null; analysis: AudioAnalysis | null
}

export interface DanceStats { analysisRuns: number; analysisFromCache: number; poseRuns: number }
export const danceStats = (): DanceStats => {
  const scope = globalThis as unknown as { __adlStats?: DanceStats }
  return scope.__adlStats ??= { analysisRuns: 0, analysisFromCache: 0, poseRuns: 0 }
}

/** `adl-practice:name:size:lastModified` -> `name:size`. */
export const danceId = (practiceKey: string) => practiceKey.replace(PRACTICE_PREFIX, '').replace(/:\d+$/, '')
export const countKeyOf = (practiceKey: string) => `${COUNT_PREFIX}${practiceKey}`

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('indexeddb-unavailable')); return }
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE, { keyPath: 'id' }) }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('indexeddb-failed'))
  })
}
async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  try {
    const db = await open()
    return await new Promise<T | null>((resolve) => {
      const transaction = db.transaction(STORE, mode)
      const request = run(transaction.objectStore(STORE))
      transaction.oncomplete = () => resolve(request.result ?? null)
      transaction.onerror = () => resolve(null); transaction.onabort = () => resolve(null)
    }).finally(() => db.close())
  } catch { return null }
}

export const getDance = (id: string) => withStore<DanceRecord | undefined>('readonly', store => store.get(id) as IDBRequest<DanceRecord | undefined>).then(value => value ?? null)
export const listDances = async () => ((await withStore<DanceRecord[]>('readonly', store => store.getAll())) ?? []).sort((a, b) => b.savedAt - a.savedAt)

/** Merge-writes part of a record (keeps what is already saved). Chained per id so quick successive saves never overwrite each other. */
const queue = new Map<string, Promise<unknown>>()
export function patchDance(id: string, patch: Partial<Omit<DanceRecord, 'id'>>, base: Pick<DanceRecord, 'name' | 'size'>): Promise<void> {
  const previous = queue.get(id) ?? Promise.resolve()
  const next = previous.then(async () => {
    const current = await getDance(id)
    const merged: DanceRecord = { id, name: base.name, size: base.size, duration: 0, practice: null, count: null, analysis: null, ...current, ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)), savedAt: Date.now() }
    await withStore('readwrite', store => store.put(merged))
  }).catch(() => undefined)
  queue.set(id, next)
  return next.then(() => undefined)
}

function removeLocal(id: string) {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(`${PRACTICE_PREFIX}${id}:`) || key.startsWith(`${COUNT_PREFIX}${PRACTICE_PREFIX}${id}:`)) localStorage.removeItem(key)
  } catch { /* storage disabled */ }
}
export async function deleteDance(id: string): Promise<void> {
  await (queue.get(id) ?? Promise.resolve())
  await withStore('readwrite', store => store.delete(id))
  removeLocal(id)
  await deletePoseTracksFor(`${PRACTICE_PREFIX}${id}`)
}
export async function clearDances(): Promise<void> {
  for (const dance of await listDances()) await deleteDance(dance.id)
}

/** If this device lost the localStorage copy (for example the file's modified time changed), restore it from IndexedDB. */
export async function hydrateFromDance(practiceKey: string): Promise<DanceRecord | null> {
  const dance = await getDance(danceId(practiceKey))
  if (!dance) return null
  try {
    if (dance.practice && localStorage.getItem(practiceKey) === null) localStorage.setItem(practiceKey, dance.practice)
    if (dance.count && localStorage.getItem(countKeyOf(practiceKey)) === null) localStorage.setItem(countKeyOf(practiceKey), dance.count)
  } catch { /* storage disabled */ }
  return dance
}

/** Bump when the detector changes so old IndexedDB analyses are not reused. */
export const ANALYSIS_CACHE_VERSION = 3

type CachedAnalysis = AudioAnalysis & { cacheVersion?: number }

/** Only reuse a prior run that actually produced a usable tempo (null-tempo caches poisoned retries). */
export function isUsableCachedAnalysis(cached: AudioAnalysis | null | undefined): cached is AudioAnalysis {
  if (!cached || !Array.isArray(cached.onsets)) return false
  const version = (cached as CachedAnalysis).cacheVersion
  // Legacy rows (no version) with a good tempo stay usable; null-tempo or low-confidence never.
  if (version !== undefined && version !== ANALYSIS_CACHE_VERSION) return false
  if (!cached.tempo || !(cached.tempo.confidence >= 0.08)) return false
  return true
}

/** Audio analysis (tempo candidates and onsets): reused for the same video instead of decoding the track again. */
export async function analyzeVideoAudioCached(file: File, signal: AbortSignal, opts?: { force?: boolean }): Promise<AudioAnalysis> {
  const id = `${file.name}:${file.size}`
  if (!opts?.force) {
    const cached = (await getDance(id))?.analysis
    if (isUsableCachedAnalysis(cached)) { danceStats().analysisFromCache++; return cached }
  }
  danceStats().analysisRuns++
  const result = await analyzeVideoAudio(file, signal)
  if (!signal.aborted && result.tempo && result.tempo.confidence >= 0.08) {
    const stored: CachedAnalysis = { ...result, cacheVersion: ANALYSIS_CACHE_VERSION }
    void patchDance(id, { analysis: stored }, { name: file.name, size: file.size })
  }
  return result
}
