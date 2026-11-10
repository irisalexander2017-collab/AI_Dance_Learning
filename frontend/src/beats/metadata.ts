/** Reads a tempo that the file itself declares: MP4/M4A `tmpo` (and iTunes `----` BPM) atoms or an ID3 `TBPM` frame. */

export interface ByteSource { size: number; read(offset: number, length: number): Promise<Uint8Array> }
export interface MetadataTempo { bpm: number; source: 'mp4-tmpo' | 'mp4-freeform' | 'id3-tbpm' }

const MAX_META_BYTES = 48 * 1024 * 1024
const text = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end))
const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0
export const validBpm = (value: number) => Number.isFinite(value) && value >= 40 && value <= 240

export function blobSource(blob: Blob): ByteSource {
  return { size: blob.size, read: async (offset, length) => new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer()) }
}
export function bufferSource(bytes: Uint8Array): ByteSource {
  return { size: bytes.length, read: async (offset, length) => bytes.subarray(offset, offset + length) }
}

interface Box { type: string; start: number; end: number; bodyStart: number }
function* boxes(b: Uint8Array, start: number, end: number): Generator<Box> {
  let pos = start
  while (pos + 8 <= end) {
    let size = u32(b, pos), header = 8
    const type = text(b, pos + 4, pos + 8)
    if (size === 1) { if (pos + 16 > end) return; size = u32(b, pos + 8) * 4294967296 + u32(b, pos + 12); header = 16 }
    else if (size === 0) size = end - pos
    if (size < header || pos + size > end) return
    yield { type, start: pos, end: pos + size, bodyStart: pos + header }
    pos += size
  }
}
const find = (b: Uint8Array, parent: { bodyStart: number; end: number }, type: string) => {
  for (const box of boxes(b, parent.bodyStart, parent.end)) if (box.type === type) return box
}

/** The first `data` atom payload of an ilst item, with its well-known type flag. */
function itemData(b: Uint8Array, item: Box): { type: number; bytes: Uint8Array } | undefined {
  const data = find(b, item, 'data')
  if (!data || data.end - data.bodyStart < 8) return
  return { type: u32(b, data.bodyStart) & 0xffffff, bytes: b.subarray(data.bodyStart + 8, data.end) }
}

function parseIlst(b: Uint8Array, ilst: Box): MetadataTempo | undefined {
  for (const item of boxes(b, ilst.bodyStart, ilst.end)) {
    if (item.type === 'tmpo') {
      const data = itemData(b, item)
      if (data && data.bytes.length >= 2) {
        const bpm = data.bytes.length >= 4 && data.type === 21 ? u32(data.bytes, 0) : (data.bytes[0] << 8) | data.bytes[1]
        if (validBpm(bpm)) return { bpm, source: 'mp4-tmpo' }
      }
    } else if (item.type === '----') {
      const name = find(b, item, 'name')
      const data = itemData(b, item)
      if (name && data && /^bpm$|^tempo$/i.test(text(b, name.bodyStart + 4, name.end).trim())) {
        const bpm = parseFloat(new TextDecoder().decode(data.bytes))
        if (validBpm(bpm)) return { bpm: Math.round(bpm * 100) / 100, source: 'mp4-freeform' }
      }
    }
  }
}

/** Parses the bytes of a `moov` box body-inclusive buffer. */
export function parseMp4Moov(b: Uint8Array, moov: { bodyStart: number; end: number }): MetadataTempo | undefined {
  const searchMeta = (parent: { bodyStart: number; end: number }) => {
    const meta = find(b, parent, 'meta')
    if (!meta) return
    // `meta` is a full box in ISO files (4 version/flag bytes) but a plain container in old QuickTime files.
    const offset = meta.bodyStart + 8 <= meta.end && /^[a-z]{4}$/i.test(text(b, meta.bodyStart + 4, meta.bodyStart + 8)) ? 0 : 4
    const ilst = find(b, { bodyStart: meta.bodyStart + offset, end: meta.end }, 'ilst')
    return ilst ? parseIlst(b, ilst) : undefined
  }
  const udta = find(b, moov, 'udta')
  return (udta && searchMeta(udta)) || searchMeta(moov)
}

async function readMp4(source: ByteSource): Promise<MetadataTempo | undefined> {
  let pos = 0
  while (pos + 8 <= source.size) {
    const head = await source.read(pos, 16)
    if (head.length < 8) return
    let size = u32(head, 0), header = 8
    const type = text(head, 4, 8)
    if (size === 1) { size = u32(head, 8) * 4294967296 + u32(head, 12); header = 16 } else if (size === 0) size = source.size - pos
    if (size < header) return
    if (type === 'moov' && size <= MAX_META_BYTES) {
      const bytes = await source.read(pos, size)
      return parseMp4Moov(bytes, { bodyStart: header, end: bytes.length })
    }
    pos += size
  }
}

const synchsafe = (b: Uint8Array, o: number) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f)

function decodeId3Text(bytes: Uint8Array): string {
  if (!bytes.length) return ''
  const body = bytes.subarray(1)
  const label = bytes[0] === 1 ? ((body[0] === 0xfe && body[1] === 0xff) ? 'utf-16be' : 'utf-16le') : bytes[0] === 2 ? 'utf-16be' : bytes[0] === 3 ? 'utf-8' : 'latin1'
  return new TextDecoder(label).decode(body).replace(/^\ufeff/, '').replace(/\0.*$/s, '').trim()
}

export function parseId3(b: Uint8Array): MetadataTempo | undefined {
  if (b.length < 10 || text(b, 0, 3) !== 'ID3') return
  const version = b[3]
  const end = Math.min(b.length, 10 + synchsafe(b, 6))
  let pos = 10
  if (b[5] & 0x40 && version >= 3) pos += version === 4 ? synchsafe(b, pos) : u32(b, pos) + 4 // extended header
  const idLen = version === 2 ? 3 : 4, headLen = version === 2 ? 6 : 10
  while (pos + headLen <= end && b[pos] !== 0) {
    const id = text(b, pos, pos + idLen)
    const size = version === 2 ? (b[pos + 3] << 16) | (b[pos + 4] << 8) | b[pos + 5] : version === 4 ? synchsafe(b, pos + 4) : u32(b, pos + 4)
    const body = pos + headLen
    if (size < 0 || body + size > end) return
    if (id === 'TBPM' || id === 'TBP') {
      const bpm = parseFloat(decodeId3Text(b.subarray(body, body + size)))
      if (validBpm(bpm)) return { bpm, source: 'id3-tbpm' }
    }
    pos = body + size
  }
}

async function readId3(source: ByteSource): Promise<MetadataTempo | undefined> {
  const head = await source.read(0, 10)
  if (head.length < 10 || text(head, 0, 3) !== 'ID3') return
  const length = Math.min(synchsafe(head, 6) + 10, MAX_META_BYTES, source.size)
  return parseId3(await source.read(0, length))
}

/** Never throws: a file without (or with a broken) tag simply has no embedded tempo. */
export async function readEmbeddedTempo(source: ByteSource): Promise<MetadataTempo | undefined> {
  try {
    const head = await source.read(0, 12)
    if (head.length >= 10 && text(head, 0, 3) === 'ID3') return await readId3(source)
    return await readMp4(source)
  } catch { return undefined }
}
