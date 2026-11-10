/** Filename/size BPM lookup against public/matched-tempo.json (catalog first; onset remains the fallback). */

export interface MatchedTempoHit { bpm: number; title?: string; source: 'matched-json' }

type CatalogEntry = {
  video_file?: string
  desktop_original_name?: string
  video_size_bytes?: number
  match?: { title?: string | null }
  bpm?: { value?: number | null }
}

let cache: CatalogEntry[] | null | undefined

/** Test helper: drop the in-memory catalog so the next lookup refetches. */
export function resetMatchedTempoCache() { cache = undefined }

function baseName(name: string): string {
  const trimmed = name.trim().replace(/\\/g, '/')
  const leaf = trimmed.includes('/') ? trimmed.slice(trimmed.lastIndexOf('/') + 1) : trimmed
  return leaf.toLowerCase()
}

async function loadCatalog(): Promise<CatalogEntry[]> {
  if (cache) return cache
  if (cache === null) return []
  try {
    const response = await fetch('/matched-tempo.json')
    if (!response.ok) { cache = null; return [] }
    const data = await response.json() as { matches?: CatalogEntry[] }
    cache = Array.isArray(data?.matches) ? data.matches : []
    return cache
  } catch {
    cache = null
    return []
  }
}

function namesOf(entry: CatalogEntry): string[] {
  return [entry.video_file, entry.desktop_original_name]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .map(baseName)
}

function toHit(entry: CatalogEntry): MatchedTempoHit | null {
  const value = entry.bpm?.value
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 40 || value > 240) return null
  const title = entry.match?.title
  return {
    bpm: Math.round(value * 10) / 10,
    title: typeof title === 'string' && title.trim() ? title.trim() : undefined,
    source: 'matched-json',
  }
}

/** Match imported video by basename and/or byte size against matched-tempo.json. */
export async function lookupMatchedTempo(file: { name: string; size: number }): Promise<MatchedTempoHit | null> {
  const entries = await loadCatalog()
  if (!entries.length) return null
  const name = baseName(file.name)
  const size = file.size
  const nameSize = entries.find(entry => namesOf(entry).includes(name) && entry.video_size_bytes === size)
  if (nameSize) return toHit(nameSize)
  const nameOnly = entries.find(entry => namesOf(entry).includes(name))
  if (nameOnly) return toHit(nameOnly)
  return null
}
