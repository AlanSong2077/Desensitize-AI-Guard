/**
 * src/plugins/tool/formats/XlsxFormat.js — XLSX 文件格式处理器
 *
 * 支持 Office Open XML（.xlsx）格式，纯 Node.js 实现，零外部依赖。
 * 内部使用 ZIP + XML 解析，完整支持多 Sheet、共享字符串、内联字符串。
 * 序列化时输出为 CSV（多 Sheet 用分隔符区分）。
 */

import { inflateRawSync } from 'zlib'
import { FileFormat } from './FileFormat.js'

export class XlsxFormat extends FileFormat {
  get extensions()      { return ['.xlsx', '.xlsm'] }
  get outputExtension() { return '.csv' }

  /**
   * 解析 XLSX 文件
   * @param {Buffer} buffer
   * @returns {ParsedFile}
   */
  parse(buffer) {
    return parseXlsx(buffer)
  }
}

// ── ZIP 解析 ──────────────────────────────────────────────────────────────────

/**
 * 极简 ZIP 解析，返回 Map<filename, Buffer>
 * @param {Buffer} buf
 * @returns {Map<string, Buffer>}
 */
function parseZip(buf) {
  const files = new Map()
  let i = 0
  while (i + 30 < buf.length) {
    if (buf.readUInt32LE(i) !== 0x04034b50) { i++; continue }
    const compression = buf.readUInt16LE(i + 8)
    const compSize    = buf.readUInt32LE(i + 18)
    const uncompSize  = buf.readUInt32LE(i + 22)
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

// ── XML 工具 ──────────────────────────────────────────────────────────────────

function decodeXml(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

function parseSharedStrings(xml) {
  const strings = []
  const siRe = /<si>([\s\S]*?)<\/si>/g
  let m
  while ((m = siRe.exec(xml)) !== null) {
    const parts = []
    const tRe = /<t(?:\s[^>]*)?>([^<]*)<\/t>/g
    let tm
    while ((tm = tRe.exec(m[1])) !== null) parts.push(decodeXml(tm[1]))
    strings.push(parts.join(''))
  }
  return strings
}

function colRefToIndex(ref) {
  let n = 0
  for (const ch of ref) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

function parseSheet(xml, sharedStrings) {
  const rows = []
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g
  let rowM
  while ((rowM = rowRe.exec(xml)) !== null) {
    const cells = []
    const cellRe = /<c\s([^>]*)>([\s\S]*?)<\/c>/g
    let cellM
    while ((cellM = cellRe.exec(rowM[1])) !== null) {
      const attrs = cellM[1], inner = cellM[2]
      const rM = attrs.match(/\br="([A-Z]+)\d+"/)
      const colIdx = rM ? colRefToIndex(rM[1]) : cells.length
      const tM = attrs.match(/\bt="([^"]*)"/)
      const cellType = tM ? tM[1] : ''
      const vM = inner.match(/<v>([^<]*)<\/v>/)
      const vRaw = vM ? vM[1] : ''
      const isM = inner.match(/<is>[\s\S]*?<t>([^<]*)<\/t>[\s\S]*?<\/is>/)
      let value = ''
      if (isM) value = decodeXml(isM[1])
      else if (cellType === 's') value = sharedStrings[+vRaw] ?? vRaw
      else value = decodeXml(vRaw)
      while (cells.length < colIdx) cells.push('')
      cells[colIdx] = value
    }
    if (cells.length) rows.push(cells)
  }
  return rows
}

function parseWorkbookSheetNames(xml) {
  const names = []
  const re = /<sheet\s[^>]*name="([^"]*)"[^/]*\/>/g
  let m
  while ((m = re.exec(xml)) !== null) names.push(decodeXml(m[1]))
  return names
}

// ── XLSX 主解析函数 ───────────────────────────────────────────────────────────

function parseXlsx(buf) {
  const files = parseZip(buf)
  const ssXml = files.get('xl/sharedStrings.xml')
  const sharedStrings = ssXml ? parseSharedStrings(ssXml.toString('utf8')) : []
  const wbXml = files.get('xl/workbook.xml')
  const sheetNames = wbXml ? parseWorkbookSheetNames(wbXml.toString('utf8')) : []
  const sheets = []
  for (let idx = 1; ; idx++) {
    const sheetBuf = files.get(`xl/worksheets/sheet${idx}.xml`)
    if (!sheetBuf) break
    sheets.push({
      name: sheetNames[idx - 1] ?? `Sheet${idx}`,
      rows: parseSheet(sheetBuf.toString('utf8'), sharedStrings),
    })
  }
  return { sheets }
}
