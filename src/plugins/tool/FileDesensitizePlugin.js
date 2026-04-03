/**
 * src/plugins/tool/FileDesensitizePlugin.js — file desensitization ToolPlugin
 *
 * Intercepts AI file-read tool calls (read / read_file / read_many_files).
 * Before the AI sees the file content, replaces the file path with a
 * desensitized temporary copy.
 *
 * Supported formats: CSV, XLSX, XLS, DOCX, PPTX, PDF.
 * Inherits from ToolPlugin; only business logic is needed here.
 */

import { existsSync }       from 'fs'
import { extname, basename } from 'path'
import { ToolPlugin }        from '../base/ToolPlugin.js'
import { readAndDesensitize } from '../../input/FileReader.js'
import { TempFileManager }   from '../../output/TempFileManager.js'
import { registry }          from '../tool/formats/index.js'

export class FileDesensitizePlugin extends ToolPlugin {
  /**
   * @param {string} tempDir  - 临时文件目录
   */
  constructor(tempDir) {
    super()
    this.tempDir     = tempDir
    this.tempManager = new TempFileManager(tempDir)
  }

  get id()   { return 'file-desensitize' }
  get name() { return 'File Desensitization (tool call layer)' }
  get description() {
    return 'Intercepts AI file-read tool calls and desensitizes CSV, XLSX, XLS, DOCX, PPTX, and PDF content before it reaches the model.'
  }

  get supportedTools() {
    return ['read', 'read_file', 'read_many_files']
  }

  /**
   * 处理文件读取工具调用
   *
   * @param {string} toolName
   * @param {object} params
   * @param {object} config
   * @param {object} logger
   * @returns {{ params: object } | undefined}
   */
  handleToolCall(toolName, params, config, logger) {
    const supportedExts = registry.supportedExtensions

    // 收集所有文件路径（兼容三种字段名）
    const paths = []
    if (toolName === 'read_many_files' && Array.isArray(params?.paths)) {
      paths.push(...params.paths)
    } else {
      const p = params?.file_path ?? params?.path ?? params?.filePath
      if (p) paths.push(p)
    }

    // 过滤出支持的文件格式
    const targetPaths = paths.filter(p => supportedExts.has(extname(p).toLowerCase()))
    if (targetPaths.length === 0) return

    const newParams  = { ...params }
    let   totalHits  = 0

    for (const filePath of targetPaths) {
      if (!existsSync(filePath)) continue

      const { outputPath, stats, changed, error } = readAndDesensitize(filePath, this.tempDir)

      if (error) {
        this.warn(logger, `文件脱敏失败 ${basename(filePath)}: ${error}`)
        continue
      }

      if (changed) {
        totalHits += stats.total
        this.tempManager.track(outputPath)

        // 替换参数中的文件路径
        if (toolName === 'read_many_files') {
          newParams.paths = newParams.paths.map(p => p === filePath ? outputPath : p)
        } else if ('file_path' in params) {
          newParams.file_path = outputPath
        } else if ('filePath' in params) {
          newParams.filePath = outputPath
        } else {
          newParams.path = outputPath
        }

        const typesSummary = Object.entries(stats.byType).map(([k, v]) => `${k}×${v}`).join(', ')
        this.log(logger, `${basename(filePath)} 已脱敏 ${stats.total} 处 [${typesSummary}]`)
      }
    }

    if (totalHits > 0) {
      return { params: newParams }
    }
  }

  /**
   * 注册插件（覆盖基类，额外清理过期临时文件）
   */
  register(api, config, logger) {
    // 清理上次遗留的过期临时文件
    const stale = this.tempManager.cleanupStale()
    if (stale > 0) {
      this.log(logger, `清理了 ${stale} 个过期临时文件`)
    }

    // 调用基类注册 hook
    super.register(api, config, logger)
  }
}
