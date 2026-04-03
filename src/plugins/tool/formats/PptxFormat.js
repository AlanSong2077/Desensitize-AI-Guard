/**
 * src/plugins/tool/formats/PptxFormat.js — PPTX / POTX file format handler
 *
 * Supports Office Open XML Presentation files (.pptx, .potx).
 * Pure Node.js implementation, zero external dependencies.
 *
 * Strategy:
 *   parse()     — unzip, extract all <a:t> text runs from each slide XML,
 *                 record their positions so serialize() can patch them back.
 *   serialize() — replace each <a:t> value in the original XML with the
 *                 (possibly desensitized) text, then repack the ZIP.
 *
 * ParsedFile mapping:
 *   sheet name  → slide filename, e.g. "slide1"
 *   rows        → [[paragraph_text], [paragraph_text], ...]
 *
 * Internal _raw field on ParsedFile (not part of the public contract):
 *   _raw: {
 *     zipFiles: Map<string, Buffer>,   // all ZIP entries (raw bytes)
 *     slideRuns: Map<string, Run[]>,   // per slide: ordered list of text runs
 *   }
 *
 *   Run: { start: number, end: number, text: string }
 *     start/end are byte offsets of the content inside <a:t>…</a:t> in the
 *     UTF-8 string of that slide's XML.
 */

import { inflateRawSync, deflateRawSync } from 'zlib'
import { FileFormat } from './FileFormat.js'

export class PptxFormat extends FileFormat {
  get extensions() { return ['.pptx', '.potx'] }

  /** @param {Buffer} buffer @returns {ParsedFile} */
  parse(buffer) {
    return parsePptx(buffer)
  }

  /**
   * Serialize back to a valid PPTX buffer with desensitized text.
   * @param {ParsedFile} parsedFile
   * @returns {Buffer}
   */
  serialize(parsedFile) {
    const raw = parsedFile._raw
    if (!raw) {
      // Fallback: plain text (should not happen in normal flow)
      const parts = parsedFile.sheets.map(sheet =>
        sheet.rows.map(r => r[0] ?? '').join('\n')
      )
      return Buffer.from(parts.join('\n\n'), 'utf8')
    }

    const { zipFiles, slideRuns } = raw

    // For each slide, patch the XML with desensitized text then store back
    for (const sheet of parsedFile.sheets) {
      const slideKey = `ppt/slides/${sheet.name}.xml`
      const runs = slideRuns.get(sheet.name)
      if (!runs || !zipFiles.has(slideKey)) continue

      // Flatten the sheet rows back to an ordered list of cell strings
      const cellTexts = sheet.rows.map(r => r[0] ?? '')

      // Patch XML: walk runs in order, replace text content
      let xml = zipFiles.get(slideKey).toString('utf8')
      // We need to rebuild the XML by replacing run texts in reverse order
      // (to keep offsets valid) using the original run positions.
      // But since desensitization may change string length, we rebuild from
      // scratch using the stored run list and the new cell texts.
      xml = patchXml(xml, runs, cellTexts)
      zipFiles.set(slideKey, Buffer.from(xml, 'utf8'))
    }

    return packZip(zipFiles)
  }
}

// ── ZIP parser ────────────────────────────────────────────────────────────────

/**
 * Parse a ZIP buffer into a Map<filename, Buffer>.
 * Only reads local file headers (sufficient for PPTX).
 */
function parseZip(buf) {
  const files = new Map()
  // Also store metadata needed for repacking
  const entries = []
  let i = 0
  while (i + 30 <= buf.length) {
    if (buf.readUInt32LE(i) !== 0x04034b50) { i++; continue }
    const flags       = buf.readUInt16LE(i + 6)
    const compression = buf.readUInt16LE(i + 8)
    const crc32       = buf.readUInt32LE(i + 14)
    const compSize    = buf.readUInt32LE(i + 18)
    const uncompSize  = buf.readUInt32LE(i + 22)
    const fnLen       = buf.readUInt16LE(i + 26)
    const extraLen    = buf.readUInt16LE(i + 28)
    const filename    = buf.slice(i + 30, i + 30 + fnLen).toString('utf8')
    const dataStart   = i + 30 + fnLen + extraLen
    const compData    = buf.slice(dataStart, dataStart + compSize)

    let uncompData
    try {
      uncompData = compression === 0 ? compData : inflateRawSync(compData)
    } catch {
      uncompData = compData
    }

    files.set(filename, uncompData)
    entries.push({ filename, compression, flags, crc32, compSize, uncompSize, fnLen, extraLen, dataStart, compData })
    i = dataStart + compSize
  }
  return { files, entries }
}

// ── ZIP packer ────────────────────────────────────────────────────────────────

function crc32Table() {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    t[i] = c
  }
  return t
}
const CRC_TABLE = crc32Table()

function crc32(buf) {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8)
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

/**
 * Repack a Map<filename, Buffer> into a valid ZIP buffer.
 * Uses deflate compression for XML files, store for others.
 */
function packZip(files) {
  const localHeaders = []
  const centralDirs  = []
  let offset = 0

  for (const [filename, data] of files) {
    const fnBuf = Buffer.from(filename, 'utf8')
    const isXml = filename.endsWith('.xml') || filename.endsWith('.rels')
    let compData, compression
    if (isXml && data.length > 0) {
      const deflated = deflateRawSync(data, { level: 6 })
      if (deflated.length < data.length) {
        compData = deflated
        compression = 8
      } else {
        compData = data
        compression = 0
      }
    } else {
      compData = data
      compression = 0
    }

    const crc    = crc32(data)
    const local  = Buffer.alloc(30 + fnBuf.length)
    local.writeUInt32LE(0x04034b50, 0)  // signature
    local.writeUInt16LE(20,          4)  // version needed
    local.writeUInt16LE(0,           6)  // flags
    local.writeUInt16LE(compression, 8)
    local.writeUInt16LE(0,          10)  // mod time
    local.writeUInt16LE(0,          12)  // mod date
    local.writeUInt32LE(crc,        14)
    local.writeUInt32LE(compData.length,  18)
    local.writeUInt32LE(data.length,      22)
    local.writeUInt16LE(fnBuf.length,     26)
    local.writeUInt16LE(0,               28)  // extra length
    fnBuf.copy(local, 30)

    const central = Buffer.alloc(46 + fnBuf.length)
    central.writeUInt32LE(0x02014b50, 0)  // signature
    central.writeUInt16LE(20,          4)  // version made by
    central.writeUInt16LE(20,          6)  // version needed
    central.writeUInt16LE(0,           8)  // flags
    central.writeUInt16LE(compression,10)
    central.writeUInt16LE(0,          12)  // mod time
    central.writeUInt16LE(0,          14)  // mod date
    central.writeUInt32LE(crc,        16)
    central.writeUInt32LE(compData.length, 20)
    central.writeUInt32LE(data.length,     24)
    central.writeUInt16LE(fnBuf.length,    28)
    central.writeUInt16LE(0,              30)  // extra length
    central.writeUInt16LE(0,              32)  // comment length
    central.writeUInt16LE(0,              34)  // disk start
    central.writeUInt16LE(0,              36)  // internal attr
    central.writeUInt32LE(0,              38)  // external attr
    central.writeUInt32LE(offset,         42)  // local header offset
    fnBuf.copy(central, 46)

    localHeaders.push(local, compData)
    centralDirs.push(central)
    offset += local.length + compData.length
  }

  const centralBuf = Buffer.concat(centralDirs)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0,           4)  // disk number
  eocd.writeUInt16LE(0,           6)  // disk with central dir
  eocd.writeUInt16LE(centralDirs.length, 8)
  eocd.writeUInt16LE(centralDirs.length,10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(offset,            16)
  eocd.writeUInt16LE(0,                 20)  // comment length

  return Buffer.concat([...localHeaders, centralBuf, eocd])
}

// ── XML helpers ───────────────────────────────────────────────────────────────

function decodeXml(s) {
  return s
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g,           (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

function encodeXml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * A Run records one <a:t> text node in the XML.
 * @typedef {{ paraIdx: number, runIdx: number, text: string, xmlStart: number, xmlEnd: number }} Run
 *   xmlStart/xmlEnd: character offsets of the text content (between > and <) in the XML string
 */

/**
 * Extract all <a:t> runs from a slide XML string.
 * Returns { paragraphs: string[], runs: Run[] }
 *   paragraphs: one entry per <a:p>, text of all runs concatenated
 *   runs: flat list of every <a:t> node with its position in the XML
 */
function extractRuns(xml) {
  const runs = []
  const paragraphs = []
  let paraIdx = 0

  const paraRe = /<a:p[\s>]/g
  const paraEndRe = /<\/a:p>/g
  const runRe = /<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/g

  // We need to find each <a:p>…</a:p> block and within it each <a:t>
  // Use a simple state machine over the XML string
  let searchFrom = 0
  while (true) {
    paraRe.lastIndex = searchFrom
    const paraMatch = paraRe.exec(xml)
    if (!paraMatch) break

    paraEndRe.lastIndex = paraMatch.index
    const paraEndMatch = paraEndRe.exec(xml)
    if (!paraEndMatch) break

    const paraXml = xml.slice(paraMatch.index, paraEndMatch.index + 6)
    const paraOffset = paraMatch.index

    const parts = []
    let runIdx = 0
    runRe.lastIndex = 0
    let rm
    while ((rm = runRe.exec(paraXml)) !== null) {
      const text = decodeXml(rm[1])
      // Absolute position of the text content in the full XML string
      // rm.index is offset of <a:t in paraXml; rm[0] is the full tag
      // The content starts after the closing > of the opening tag
      const openTagEnd = paraOffset + rm.index + rm[0].indexOf('>') + 1
      const closeTagStart = openTagEnd + rm[1].length  // rm[1] is raw (encoded) content
      runs.push({ paraIdx, runIdx, text, xmlStart: openTagEnd, xmlEnd: closeTagStart })
      parts.push(text)
      runIdx++
    }

    const paraText = parts.join('').trim()
    if (paraText) paragraphs.push(paraText)
    paraIdx++
    searchFrom = paraEndMatch.index + 6
  }

  return { paragraphs, runs }
}

/**
 * Patch the XML string: replace each <a:t> content with the desensitized text.
 * cellTexts is the flat list of paragraph strings (one per non-empty paragraph).
 * We map paragraph index → desensitized text, then for each run in that paragraph
 * we need to distribute the new text across the runs.
 *
 * Simple strategy: put the full desensitized paragraph text into the FIRST run
 * of each paragraph, and clear the remaining runs. This preserves formatting
 * of the first run while correctly replacing the content.
 */
function patchXml(xml, runs, cellTexts) {
  if (!runs.length) return xml

  // Build a map: paraIdx → desensitized text
  // cellTexts corresponds to non-empty paragraphs in order.
  // We need to know which paraIdx values had non-empty text.
  // Re-derive that from the runs themselves.
  const paraIdxWithText = []
  const seen = new Set()
  for (const run of runs) {
    if (!seen.has(run.paraIdx)) {
      seen.add(run.paraIdx)
      // Check if this paragraph has any non-empty text
      const paraRuns = runs.filter(r => r.paraIdx === run.paraIdx)
      const paraText = paraRuns.map(r => r.text).join('').trim()
      if (paraText) paraIdxWithText.push(run.paraIdx)
    }
  }

  // Map paraIdx → new text
  const paraNewText = new Map()
  for (let i = 0; i < paraIdxWithText.length; i++) {
    paraNewText.set(paraIdxWithText[i], cellTexts[i] ?? '')
  }

  // Group runs by paraIdx
  const runsByPara = new Map()
  for (const run of runs) {
    if (!runsByPara.has(run.paraIdx)) runsByPara.set(run.paraIdx, [])
    runsByPara.get(run.paraIdx).push(run)
  }

  // Apply patches in reverse order of xmlStart to keep offsets valid
  const allRuns = [...runs].sort((a, b) => b.xmlStart - a.xmlStart)
  let result = xml
  for (const run of allRuns) {
    const newText = paraNewText.has(run.paraIdx)
      ? (run.runIdx === 0 ? encodeXml(paraNewText.get(run.paraIdx)) : '')
      : encodeXml(run.text)  // paragraph had no text mapping, keep original
    result = result.slice(0, run.xmlStart) + newText + result.slice(run.xmlEnd)
  }
  return result
}

// ── Main parser ───────────────────────────────────────────────────────────────

function parsePptx(buf) {
  const { files } = parseZip(buf)

  // Collect slide keys in order
  const slideKeys = []
  for (const key of files.keys()) {
    if (/^ppt\/slides\/slide\d+\.xml$/.test(key)) slideKeys.push(key)
  }
  slideKeys.sort((a, b) => {
    const na = parseInt(a.match(/(\d+)/)[1])
    const nb = parseInt(b.match(/(\d+)/)[1])
    return na - nb
  })

  const sheets = []
  const slideRuns = new Map()

  for (const key of slideKeys) {
    const data = files.get(key)
    if (!data) continue
    const slideName = key.replace('ppt/slides/', '').replace('.xml', '')
    const xml = data.toString('utf8')
    const { paragraphs, runs } = extractRuns(xml)
    const rows = paragraphs.map(p => [p])
    if (rows.length > 0) {
      sheets.push({ name: slideName, rows })
      slideRuns.set(slideName, runs)
    }
  }

  return {
    sheets,
    _raw: { zipFiles: files, slideRuns },
  }
}
