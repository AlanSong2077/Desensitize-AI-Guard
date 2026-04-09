/**
 * src/plugins/exec/execUtils.js — exec 插件公共工具函数
 *
 * 供 PythonExecPlugin 和 ShellExecPlugin 共享：
 *   - extractFilePaths()  从命令字符串中提取支持格式的文件路径
 *   - replacePath()       将命令字符串中的原始路径替换为新路径
 *   - desensitizePaths()  批量脱敏路径并返回替换后的命令
 */

import { existsSync }        from 'fs'
import { extname, basename } from 'path'
import { readAndDesensitize } from '../../input/FileReader.js'
import { TempFileManager }   from '../../output/TempFileManager.js'
import { registry }          from '../tool/formats/index.js'

// ── 路径提取 ──────────────────────────────────────────────────────────────────

/**
 * 从命令字符串中提取所有支持格式的文件路径
 *
 * 覆盖模式：
 *   1. 单引号包裹：'path'
 *   2. 双引号包裹："path"
 *   3. 无引号绝对/相对路径：/Users/.../file.csv  ./data/file.xlsx
 *
 * @param {string}      cmd
 * @param {Set<string>} supportedExts
 * @returns {string[]}  去重后的文件路径列表
 */
export function extractFilePaths(cmd, supportedExts) {
  const paths = new Set()

  // 模式 1：单引号包裹
  for (const m of cmd.matchAll(/'([^']+)'/g)) {
    const p = m[1]
    if (supportedExts.has(extname(p).toLowerCase())) paths.add(p)
  }

  // 模式 2：双引号包裹
  for (const m of cmd.matchAll(/"([^"]+)"/g)) {
    const p = m[1]
    if (supportedExts.has(extname(p).toLowerCase())) paths.add(p)
  }

  // 模式 3：无引号绝对/相对路径
  for (const m of cmd.matchAll(/(?:^|[\s,=(])(\/?(?:[\w.\-]+\/)+[\w.\-]+)/g)) {
    const p = m[1]
    if (supportedExts.has(extname(p).toLowerCase())) paths.add(p)
  }

  return [...paths]
}

// ── 路径替换 ──────────────────────────────────────────────────────────────────

/**
 * 将命令字符串中所有出现的 originalPath 替换为 newPath
 * 同时处理单引号、双引号、无引号三种情况
 *
 * @param {string} cmd
 * @param {string} originalPath
 * @param {string} newPath
 * @returns {string}
 */
export function replacePath(cmd, originalPath, newPath) {
  const escaped = originalPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return cmd.replace(new RegExp(escaped, 'g'), newPath)
}

// ── 批量脱敏 ──────────────────────────────────────────────────────────────────

/**
 * 从命令中提取文件路径，逐一脱敏，返回替换后的命令和统计信息
 *
 * @param {string}   cmd        - 原始命令字符串
 * @param {string}   tempDir    - 临时文件目录
 * @param {object}   tempManager - TempFileManager 实例
 * @param {object}   logger
 * @param {string}   pluginTag  - 日志前缀（如 "Python exec" / "Shell exec"）
 * @returns {{ newCmd: string, totalHits: number, replaced: string[] }}
 */
export function desensitizePaths(cmd, tempDir, tempManager, logger, pluginTag) {
  const supportedExts = registry.supportedExtensions
  const filePaths     = extractFilePaths(cmd, supportedExts)

  let newCmd    = cmd
  let totalHits = 0
  const replaced = []

  for (const filePath of filePaths) {
    if (!existsSync(filePath)) continue

    const { outputPath, stats, changed, error } = readAndDesensitize(filePath, tempDir)

    if (error) {
      logger?.warn(`[${pluginTag}] 文件脱敏失败 ${basename(filePath)}: ${error}`)
      continue
    }

    if (changed) {
      totalHits += stats.total
      tempManager.track(outputPath)
      newCmd = replacePath(newCmd, filePath, outputPath)

      const typesSummary = Object.entries(stats.byType).map(([k, v]) => `${k}×${v}`).join(', ')
      replaced.push(`${basename(filePath)} [${typesSummary}]`)
      logger?.info(`[${pluginTag}] 拦截: ${basename(filePath)} 已脱敏 ${stats.total} 处 [${typesSummary}]`)
    }
  }

  return { newCmd, totalHits, replaced }
}
