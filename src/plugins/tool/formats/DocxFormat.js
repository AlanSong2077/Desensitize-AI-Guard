/**
 * src/plugins/tool/formats/DocxFormat.js — DOCX / DOTX file format handler
 *
 * Supports Office Open XML Word documents (.docx, .dotx).
 * Pure Node.js implementation, zero external dependencies.
 * Extracts paragraph text from word/document.xml and all word/header*.xml /
 * word/footer*.xml parts. Each paragraph becomes one row in the ParsedFile.
 * Serializes back to plain text (UTF-8).
 *
 * ParsedFile mapping:
 *   sheet name  → "Document"
 *   rows        → [[paragraph_text], [paragraph_text], ...]
 *   (single-column rows; header row is omitted — no column semantics)
 */

import { inflateRawSync } from 'zlib'
import { FileFormat }     from './FileFormat.js'

export class DocxFormat extends FileFormat {
  get extensions() { return ['.docx', '.dotx'] }

  /**
   * @param {Buffer} buffer
   * @returns {ParsedFile}
   */
  parse(buffer) {
    return parseDocx(buffer)
  }

  /**
   * Serialize back to plain text — one paragraph per line.
   * @param {ParsedFile} parsedFile
   * @returns {Buffer}
   */
  serialize(parsedFile) {
    const lines = []
    for (const sheet of parsedFile.sheets) {
      for (const row of sheet.rows) {
        lines.push(row[0] ?? '')
      }
    }
    return Buffer.from(lines.join('\n'), 'utf8')
  }
}

// ── ZIP parser (shared pattern with XlsxFormat) ───────────────────────────────

function parseZip(buf) {
  const files = new Map()
  let i = 0
  while (i + 30 < buf.length) {
    if (buf.readUInt32LE(i) !== 0x04034b50) { i++; continue }
    const compression = buf.readUInt16LE(i + 8)
    const compSize    = buf.readUInt32LE(i + 18)
    const fnLen       = buf.readUInt16LE(i + 26)
    const extraLen    = buf.readUInt16LE(i + 28)
    const filename    = buf.slice(i + 30, i + 30 + fnLen).toString('utf8')
    const dataStart   = i + 30 + fnLen + extraLen
    const compData    = buf.slice(dataStart, dataStart + compSize)
    try {
      files.set(filename, compression === 0 ? compData : inflateRawSync(compData))
    } catch {}
    i = dataStart + compSize
  }
  return files
}

// ── XML helpers ───────────────────────────────────────────────────────────────

function decodeXml(s) {
  return s
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g,        (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

/**
 * Extract paragraph text from a Word XML part.
 * Each <w:p> element becomes one string; <w:t> runs are concatenated.
 * @param {string} xml
 * @returns {string[]}
 */
function extractParagraphs(xml) {
  const paragraphs = []
  const paraRe = /<w:p[\s>][\s\S]*?<\/w:p>/g
  let pm
  while ((pm = paraRe.exec(xml)) !== null) {
    const runRe = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g
    const parts = []
    let rm
    while ((rm = runRe.exec(pm[0])) !== null) {
      parts.push(decodeXml(rm[1]))
    }
    const text = parts.join('').trim()
    if (text) paragraphs.push(text)
  }
  return paragraphs
}

// ── Main parser ───────────────────────────────────────────────────────────────

function parseDocx(buf) {
  const files = parseZip(buf)

  // Parts to extract text from, in order
  const partNames = ['word/document.xml']
  for (const key of files.keys()) {
    if (/^word\/(header|footer)\d*\.xml$/.test(key)) partNames.push(key)
  }

  const rows = []
  for (const part of partNames) {
    const data = files.get(part)
    if (!data) continue
    for (const para of extractParagraphs(data.toString('utf8'))) {
      rows.push([para])
    }
  }

  return { sheets: [{ name: 'Document', rows }] }
}
