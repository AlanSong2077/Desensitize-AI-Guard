/**
 * src/plugins/exec/PythonExecPlugin.js — Python exec 调用脱敏插件
 *
 * 拦截 exec / process 工具调用，检测其中的 Python 文件读取操作，
 * 在 Python 脚本执行前将目标文件替换为脱敏后的临时副本。
 *
 * 覆盖场景：
 *   - pd.read_csv('/path/to/file.csv')
 *   - pd.read_excel('/path/to/file.xlsx')
 *   - open('/path/to/file.csv')
 *   - pandas.read_csv(...)
 *   - pl.read_csv(...)  (polars)
 *   - csv.reader(open(...))
 *   - python3 script.py --input /path/to/file.csv
 *   - python -c "import pandas; ..."
 *
 * 工作原理：
 *   1. 从命令字符串中提取所有文件路径（支持格式：csv/xlsx/xls 等）
 *   2. 对每个路径调用 readAndDesensitize() 生成脱敏临时文件
 *   3. 将命令字符串中的原始路径替换为临时文件路径
 *   4. 执行替换后的命令，Python 读到的就是脱敏数据
 */

import { ToolPlugin }     from '../base/ToolPlugin.js'
import { TempFileManager } from '../../output/TempFileManager.js'
import { desensitizePaths } from './execUtils.js'

// ── Python 命令检测 ───────────────────────────────────────────────────────────

/**
 * 判断命令是否是 Python 调用
 * @param {string} cmd
 * @returns {boolean}
 */
function isPythonCommand(cmd) {
  if (typeof cmd !== 'string') return false
  return /(?:^|\s|;|&&|\|)python3?(?:\s|$)/.test(cmd) ||
         /(?:^|\s|;|&&|\|)py(?:\s|$)/.test(cmd) ||
         // exec 工具直接传 Python 代码片段（无 python 前缀）
         /(?:import\s+pandas|import\s+csv|import\s+polars|pd\.read_|pl\.read_|open\s*\()/.test(cmd)
}

// ── PythonExecPlugin ──────────────────────────────────────────────────────────

export class PythonExecPlugin extends ToolPlugin {
  /**
   * @param {string} tempDir - 临时文件目录
   */
  constructor(tempDir) {
    super()
    this.tempDir     = tempDir
    this.tempManager = new TempFileManager(tempDir)
  }

  get id()   { return 'python-exec-desensitize' }
  get name() { return 'Python Exec Desensitization' }
  get description() {
    return '拦截 exec/process 工具中的 Python 文件读取操作，在执行前将目标文件替换为脱敏临时副本。'
  }

  get supportedTools() {
    return ['exec', 'process']
  }

  handleToolCall(toolName, params, config, logger) {
    const cmd = params?.command ?? params?.cmd ?? params?.script ?? ''
    if (!cmd || typeof cmd !== 'string') return
    if (!isPythonCommand(cmd)) return

    const { newCmd, totalHits, replaced } = desensitizePaths(
      cmd, this.tempDir, this.tempManager, logger, 'Python exec'
    )
    if (totalHits === 0) return

    const newParams = { ...params }
    if ('command' in params)     newParams.command = newCmd
    else if ('cmd' in params)    newParams.cmd     = newCmd
    else if ('script' in params) newParams.script  = newCmd

    logger?.info(`[python-exec-desensitize] 脱敏完成，共替换 ${replaced.length} 个文件: ${replaced.join(', ')}`)
    return { params: newParams }
  }

  register(api, config, logger) {
    const stale = this.tempManager.cleanupStale()
    if (stale > 0) logger?.info(`[python-exec-desensitize] 清理了 ${stale} 个过期临时文件`)
    super.register(api, config, logger)
  }
}
