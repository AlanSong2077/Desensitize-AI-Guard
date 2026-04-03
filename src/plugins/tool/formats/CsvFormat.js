/**
 * src/plugins/tool/formats/CsvFormat.js — CSV 文件格式处理器
 *
 * 支持标准 CSV（RFC 4180），含引号转义。
 * 序列化时保持 CSV 格式输出。
 */

import { FileFormat } from './FileFormat.js'

export class CsvFormat extends FileFormat {
  get extensions()      { return ['.csv'] }
  get outputExtension() { return '.csv'  }

  /**
   * 解析 CSV 文件内容
   * @param {Buffer} buffer
   * @returns {ParsedFile}
   */
  parse(buffer) {
    const text = buffer.toString('utf8')
    const rows = []
    for (const line of text.split(/\r?\n/)) {
      if (line.trim()) rows.push(parseCsvLine(line))
    }
    return { sheets: [{ name: 'Sheet1', rows }] }
  }

  /**
   * 序列化回 CSV（保持原格式）
   * @param {ParsedFile} parsedFile
   * @returns {Buffer}
   */
  serialize(parsedFile) {
    // CSV 只有一个 sheet，直接序列化
    const sheet = parsedFile.sheets[0]
    if (!sheet) return Buffer.alloc(0)
    const text = sheet.rows.map(row =>
      row.map(cell => toCsvField(String(cell ?? ''))).join(',')
    ).join('\n')
    return Buffer.from(text, 'utf8')
  }
}

// ── CSV 解析工具函数（可被其他模块复用）──────────────────────────────────────

/**
 * 解析单行 CSV（支持引号转义）
 * @param {string} line
 * @returns {string[]}
 */
export function parseCsvLine(line) {
  const fields = []
  let cur = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (ch === '"') inQ = false
      else cur += ch
    } else {
      if (ch === '"') inQ = true
      else if (ch === ',') { fields.push(cur); cur = '' }
      else cur += ch
    }
  }
  fields.push(cur)
  return fields
}

/**
 * 将单元格值转义为 CSV 字段
 * @param {string} v
 * @returns {string}
 */
export function toCsvField(v) {
  if (v.includes(',') || v.includes('"') || v.includes('\n'))
    return '"' + v.replace(/"/g, '""') + '"'
  return v
}
