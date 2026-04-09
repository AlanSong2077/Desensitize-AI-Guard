/**
 * src/input/FileReader.js — 输入层：文件读取与脱敏处理
 *
 * 职责：
 *   1. 读取原始文件字节
 *   2. 调用对应的 FileFormat 解析器解析为 ParsedFile
 *   3. 调用脱敏引擎对 ParsedFile 中的数据进行脱敏
 *   4. 将脱敏后的 ParsedFile 序列化并写入临时文件
 *   5. 返回临时文件路径和脱敏统计
 *
 * 此层不关心"谁在调用"（工具调用 or 其他），只负责文件的读取和脱敏。
 * 调用方（ToolPlugin）负责决定何时调用、如何替换路径。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { extname, basename }                                   from 'path'
import { createHash }                                          from 'crypto'
import { registry }                                            from '../plugins/tool/formats/index.js'
import { makeCtx, hit, findColRule, desensitize } from '../core/desensitize.js'

// ── 临时目录管理 ──────────────────────────────────────────────────────────────

/**
 * 确保临时目录存在
 * @param {string} tempDir
 */
export function ensureTempDir(tempDir) {
  try { mkdirSync(tempDir, { recursive: true }) } catch {}
}

/**
 * 生成临时文件路径（基于原始路径 hash，避免冲突）
 * 扩展名由 format.outputExtension 决定，确保与 serialize() 输出内容一致。
 * @param {string} originalPath
 * @param {string} tempDir
 * @param {FileFormat} [format]  - 若提供则用 format.outputExtension，否则保留原始扩展名
 * @returns {string}
 */
export function makeTempPath(originalPath, tempDir, format) {
  const hash = createHash('sha256').update(originalPath + Date.now() + Math.random()).digest('hex').slice(0, 8)
  const ext  = format?.outputExtension ?? (extname(originalPath).toLowerCase() || '.csv')
  return `${tempDir}/dg_${hash}${ext}`
}

// ── 表格方向识别 ──────────────────────────────────────────────────────────────

/**
 * 判断一个 sheet 是否是纵表（转置表）
 *
 * 纵表特征：
 *   - 第一列是"字段名"列，每行第一个单元格是列名（如"姓名"、"手机"）
 *   - 第二列（及后续列）是对应的值
 *
 * 判断策略：
 *   扫描第一列，若其中 >= 40% 的单元格能匹配到列名规则，则认为是纵表。
 *   同时要求第一列至少有 3 行有内容，避免误判极小表格。
 *
 * @param {Array<Array<string>>} rows
 * @returns {boolean}
 */
function isVerticalTable(rows) {
  if (rows.length < 3) return false
  const firstCol = rows.map(r => String(r[0] ?? '').trim()).filter(Boolean)
  if (firstCol.length < 3) return false
  const matchCount = firstCol.filter(h => findColRule(h) !== null).length
  return matchCount / firstCol.length >= 0.4
}

// ── 列级脱敏（精准模式）──────────────────────────────────────────────────────

/**
 * 横表脱敏：第一行为表头，后续行为数据行
 */
function desensitizeHorizontal(sheet, ctx, byType) {
  let totalHits = 0
  const headers = sheet.rows[0]
  const rules   = headers.map(h => findColRule(String(h ?? '').trim()))

  const newRows = sheet.rows.map((row, rowIdx) => {
    if (rowIdx === 0) return row  // 保留表头
    return row.map((cell, colIdx) => {
      const val = String(cell ?? '')
      if (!val.trim()) return cell

      const rule = rules[colIdx]
      if (rule) {
        const result = rule.fn(ctx, val)
        if (result !== val) {
          totalHits++
          byType['文件列脱敏'] = (byType['文件列脱敏'] ?? 0) + 1
        }
        return result
      }

      // 无列名规则：正则兜底脱敏
      const { result, stats } = desensitize(val)
      const hits = Object.values(stats).reduce((a, b) => a + b, 0)
      if (hits > 0) {
        totalHits += hits
        for (const [k, v] of Object.entries(stats)) {
          byType[k] = (byType[k] ?? 0) + v
        }
        return result
      }
      return cell
    })
  })

  return { rows: newRows, hits: totalHits }
}

/**
 * 纵表脱敏：第一列为字段名，后续列为对应值
 *
 * 例：
 *   姓名   | 张三   | 李四
 *   手机   | 138... | 139...
 *   地址   | 北京...| 上海...
 *
 * 处理方式：按行遍历，用第一列的字段名查规则，对同行其余列的值脱敏。
 */
function desensitizeVertical(sheet, ctx, byType) {
  let totalHits = 0

  const newRows = sheet.rows.map(row => {
    const keyCell = String(row[0] ?? '').trim()
    const rule    = findColRule(keyCell)

    return row.map((cell, colIdx) => {
      if (colIdx === 0) return cell  // 保留字段名列
      const val = String(cell ?? '')
      if (!val.trim()) return cell

      if (rule) {
        const result = rule.fn(ctx, val)
        if (result !== val) {
          totalHits++
          byType['文件列脱敏(纵表)'] = (byType['文件列脱敏(纵表)'] ?? 0) + 1
        }
        return result
      }

      // 无规则：正则兜底
      const { result, stats } = desensitize(val)
      const hits = Object.values(stats).reduce((a, b) => a + b, 0)
      if (hits > 0) {
        totalHits += hits
        for (const [k, v] of Object.entries(stats)) {
          byType[k] = (byType[k] ?? 0) + v
        }
        return result
      }
      return cell
    })
  })

  return { rows: newRows, hits: totalHits }
}

/**
 * 对 ParsedFile 中的所有 Sheet 执行脱敏
 * 自动识别横表 / 纵表，分别处理
 *
 * @param {ParsedFile} parsed
 * @returns {{ sheets: ParsedFile, stats: { total: number, byType: Record<string,number> } }}
 */
export function desensitizeSheets(parsed) {
  let totalHits = 0
  const byType = {}
  const ctx = makeCtx()

  const sheets = parsed.sheets.map(sheet => {
    if (sheet.rows.length === 0) return sheet

    const vertical = isVerticalTable(sheet.rows)
    const { rows: newRows, hits } = vertical
      ? desensitizeVertical(sheet, ctx, byType)
      : desensitizeHorizontal(sheet, ctx, byType)

    totalHits += hits
    return { ...sheet, rows: newRows }
  })

  return {
    sheets: { sheets },
    stats:  { total: totalHits, byType },
  }
}

// ── 主入口 ────────────────────────────────────────────────────────────────────

/**
 * 读取文件并执行脱敏，返回临时文件路径
 *
 * @param {string} filePath   - 原始文件路径
 * @param {string} tempDir    - 临时文件目录
 * @returns {{
 *   outputPath: string,
 *   stats: { total: number, byType: Record<string,number> },
 *   changed: boolean,
 *   error?: string
 * }}
 */
export function readAndDesensitize(filePath, tempDir) {
  const ext = extname(filePath).toLowerCase()

  // 检查是否支持此格式
  const format = registry.find(ext)
  if (!format) {
    return { outputPath: filePath, stats: {}, changed: false }
  }

  try {
    const buf    = readFileSync(filePath)
    const parsed = format.parse(buf)

    // 空文件直接返回
    if (parsed.sheets.length === 0 || parsed.sheets.every(s => s.rows.length === 0)) {
      return { outputPath: filePath, stats: {}, changed: false }
    }

    // 执行脱敏
    const { sheets: desensitized, stats } = desensitizeSheets(parsed)

    // 无敏感数据，不生成临时文件
    if (stats.total === 0) {
      return { outputPath: filePath, stats, changed: false }
    }

    // 将脱敏后的 sheets 合并回原始 parsed 对象（保留 _raw 等格式私有字段）
    const mergedParsed = { ...parsed, sheets: desensitized.sheets }

    // 序列化并写入临时文件
    ensureTempDir(tempDir)
    const outPath = makeTempPath(filePath, tempDir, format)
    const outBuf  = format.serialize(mergedParsed)
    writeFileSync(outPath, outBuf)

    return { outputPath: outPath, stats, changed: true }
  } catch (err) {
    return { outputPath: filePath, stats: {}, changed: false, error: err.message }
  }
}
