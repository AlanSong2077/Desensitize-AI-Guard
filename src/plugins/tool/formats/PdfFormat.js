/**
 * src/plugins/tool/formats/PdfFormat.js — PDF file format handler
 *
 * Supports PDF documents (.pdf).
 * Pure Node.js implementation, zero external dependencies.
 *
 * Extraction strategy:
 *   1. Locate all content stream objects in the PDF byte stream.
 *   2. Decompress FlateDecode streams (zlib deflate).
 *   3. Parse PDF text operators: Tj, TJ, ', " — extract string arguments.
 *   4. Decode PDF string literals (hex <...> and parenthesised (...)).
 *   5. Each non-empty line of extracted text becomes one row.
 *
 * Limitations (inherent to zero-dependency PDF parsing):
 *   - Encrypted PDFs are not supported.
 *   - PDFs with embedded fonts using custom encoding maps may produce garbled
 *     text for non-ASCII characters.
 *   - Complex layout (multi-column, rotated text) is extracted as a flat
 *     sequence without spatial ordering.
 *
 * Serializes back to plain text (UTF-8).
 *
 * ParsedFile mapping:
 *   sheet name  → "PDF"
 *   rows        → [[line_text], [line_text], ...]
 */

import { inflateSync } from 'zlib'
import { FileFormat }  from './FileFormat.js'

export class PdfFormat extends FileFormat {
  get extensions() { return ['.pdf'] }

  /**
   * @param {Buffer} buffer
   * @returns {ParsedFile}
   */
  parse(buffer) {
    return parsePdf(buffer)
  }

  /**
   * Serialize to plain text — one line per row.
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

// ── PDF string decoders ───────────────────────────────────────────────────────

/**
 * Decode a PDF hex string: <4865 6c6c 6f>  →  "Hello"
 * @param {string} hex
 * @returns {string}
 */
function decodeHexString(hex) {
  const clean = hex.replace(/\s/g, '')
  // Pad to even length
  const padded = clean.length % 2 === 0 ? clean : clean + '0'
  const bytes = []
  for (let i = 0; i < padded.length; i += 2) {
    bytes.push(parseInt(padded.slice(i, i + 2), 16))
  }
  // Attempt UTF-16BE detection (BOM FEFF)
  if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
    const buf = Buffer.from(bytes)
    return buf.slice(2).toString('utf16le').split('').map((c, i, a) =>
      i % 2 === 0 ? String.fromCharCode((a[i].charCodeAt(0) << 8) | a[i + 1]?.charCodeAt(0)) : ''
    ).join('') || buf.slice(2).swap16().toString('utf16le')
  }
  try { return Buffer.from(bytes).toString('latin1') } catch { return '' }
}

/**
 * Decode a PDF literal string with escape sequences.
 * @param {string} s  — content between outer parentheses (not including them)
 * @returns {string}
 */
function decodeLiteralString(s) {
  let result = ''
  let i = 0
  while (i < s.length) {
    if (s[i] === '\\') {
      i++
      switch (s[i]) {
        case 'n':  result += '\n'; break
        case 'r':  result += '\r'; break
        case 't':  result += '\t'; break
        case 'b':  result += '\b'; break
        case 'f':  result += '\f'; break
        case '(':  result += '(';  break
        case ')':  result += ')';  break
        case '\\': result += '\\'; break
        default: {
          // Octal escape \ddd
          const oct = s.slice(i, i + 3).match(/^[0-7]{1,3}/)
          if (oct) {
            result += String.fromCharCode(parseInt(oct[0], 8))
            i += oct[0].length - 1
          } else {
            result += s[i]
          }
        }
      }
    } else {
      result += s[i]
    }
    i++
  }
  return result
}

/**
 * Extract the next PDF string token starting at pos in the content stream.
 * Returns { value: string, end: number } or null.
 * @param {string} stream
 * @param {number} pos
 * @returns {{ value: string, end: number } | null}
 */
function readPdfString(stream, pos) {
  if (stream[pos] === '<' && stream[pos + 1] !== '<') {
    // Hex string
    const end = stream.indexOf('>', pos + 1)
    if (end === -1) return null
    return { value: decodeHexString(stream.slice(pos + 1, end)), end: end + 1 }
  }
  if (stream[pos] === '(') {
    // Literal string — must track nested parentheses
    let depth = 1, i = pos + 1
    let content = ''
    while (i < stream.length && depth > 0) {
      if (stream[i] === '\\') {
        content += stream[i] + (stream[i + 1] ?? '')
        i += 2
        continue
      }
      if (stream[i] === '(') depth++
      else if (stream[i] === ')') { depth--; if (depth === 0) break }
      content += stream[i]
      i++
    }
    return { value: decodeLiteralString(content), end: i + 1 }
  }
  return null
}

// ── Content stream text extraction ───────────────────────────────────────────

/**
 * Extract text from a single decoded content stream string.
 * Handles: Tj, TJ, apostrophe-op, quote-op, BT/ET, Td/TD/T-star/Tm (for line breaks)
 * @param {string} stream
 * @returns {string[]}  — non-empty text fragments
 */
function extractTextFromStream(stream) {
  const fragments = []
  let i = 0
  let inText = false

  while (i < stream.length) {
    // Skip whitespace
    if (/\s/.test(stream[i])) { i++; continue }

    // BT / ET markers
    if (stream.slice(i, i + 2) === 'BT') { inText = true;  i += 2; continue }
    if (stream.slice(i, i + 2) === 'ET') { inText = false; i += 2; continue }

    // Text positioning operators that imply a line break
    if (inText) {
      const op2 = stream.slice(i, i + 2)
      if (op2 === 'Td' || op2 === 'TD' || op2 === 'T*' || op2 === 'Tm') {
        fragments.push('\n')
        i += 2
        continue
      }
    }

    // String tokens
    const str = readPdfString(stream, i)
    if (str) {
      if (str.value.trim()) fragments.push(str.value)
      i = str.end

      // Peek at the operator following the string
      let j = i
      while (j < stream.length && /\s/.test(stream[j])) j++
      const op = stream.slice(j, j + 2)
      if (op === 'Tj' || op === "'" || op === '"') {
        fragments.push('\n')
        i = j + 2
      }
      continue
    }

    // Array for TJ: [(str) num (str) ...]
    if (stream[i] === '[') {
      let j = i + 1
      while (j < stream.length && stream[j] !== ']') {
        while (j < stream.length && /\s/.test(stream[j])) j++
        if (stream[j] === ']') break
        const s = readPdfString(stream, j)
        if (s) {
          if (s.value.trim()) fragments.push(s.value)
          j = s.end
        } else {
          // Skip number or other token
          while (j < stream.length && !/[\s\[\]]/.test(stream[j])) j++
        }
      }
      i = j + 1  // skip ']'
      // Peek for TJ operator
      let k = i
      while (k < stream.length && /\s/.test(stream[k])) k++
      if (stream.slice(k, k + 2) === 'TJ') {
        fragments.push('\n')
        i = k + 2
      }
      continue
    }

    // Skip any other token
    while (i < stream.length && !/[\s<(\[]/.test(stream[i])) i++
  }

  return fragments
}

// ── PDF object / stream locator ───────────────────────────────────────────────

/**
 * Find all content streams in the PDF buffer.
 * A content stream is an indirect object containing "stream ... endstream".
 * We look for the stream dictionary to detect FlateDecode, then extract bytes.
 * @param {Buffer} buf
 * @returns {string[]}  — decoded stream strings
 */
function extractContentStreams(buf) {
  const text  = buf.toString('binary')  // latin1 — preserves byte values
  const streams = []
  const streamRe = /stream\r?\n([\s\S]*?)endstream/g
  let m

  while ((m = streamRe.exec(text)) !== null) {
    const rawBytes = Buffer.from(m[1], 'binary')

    // Find the dictionary preceding this stream
    const dictEnd   = m.index
    const dictStart = text.lastIndexOf('<<', dictEnd)
    const dict      = dictStart >= 0 ? text.slice(dictStart, dictEnd) : ''

    // Check for FlateDecode / Fl
    const isFlate = /\/FlateDecode|\/Fl\b/.test(dict)

    let decoded
    if (isFlate) {
      try { decoded = inflateSync(rawBytes).toString('binary') } catch { continue }
    } else {
      decoded = m[1]
    }

    // Only keep streams that look like content streams (contain BT or text ops)
    if (/BT[\s\S]*?ET|Tj|TJ/.test(decoded)) {
      streams.push(decoded)
    }
  }

  return streams
}

// ── Main parser ───────────────────────────────────────────────────────────────

function parsePdf(buf) {
  const streams = extractContentStreams(buf)

  const allFragments = []
  for (const stream of streams) {
    allFragments.push(...extractTextFromStream(stream))
  }

  // Join fragments, split on newline markers, deduplicate blank lines
  const raw   = allFragments.join('')
  const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0)

  const rows = lines.map(l => [l])
  return { sheets: [{ name: 'PDF', rows }] }
}
